import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { runSession } from '../sdk/session.js';
import type { RunSessionInput } from '../sdk/session.js';
import { loadRun, saveState } from '../state/run.js';
import { trialDir, trialResultPath, logsDir } from '../state/paths.js';
import { ensureDir, writeAtomic } from '../lib/fs.js';
import type { EventBus } from './events.js';

const execAsync = promisify(exec);

export interface AutoResearchConfig {
  runId: string;
  experimentDir: string;
  objective: string;
  evaluationCmd: string;
  maxTrials: number;
  budgetMinutesPerTrial?: number;
}

export interface TrialResult {
  trial: number;
  metric: number | null;
  status: 'improved' | 'regressed' | 'no_metric';
  duration_ms: number;
}

/**
 * Build the research prompt for a single trial. Claude has full read and write
 * access to all files in the repository — there are no restrictions on which
 * files may be edited.
 */
export function buildResearchPrompt(args: {
  runId: string;
  experimentDir: string;
  objective: string;
  evaluationCmd: string;
  trialNum: number;
  bestMetric: number | null;
  notesContent: string;
  budgetMinutesPerTrial?: number;
}): RunSessionInput {
  const transcriptPath = path.join(
    logsDir(args.runId),
    `trial-${String(args.trialNum).padStart(3, '0')}.jsonl`
  );

  const maxBudgetUsd = args.budgetMinutesPerTrial
    ? Math.max(1.0, args.budgetMinutesPerTrial * 0.25)
    : 10.0;

  const systemPrompt = [
    'You are an AI research assistant running iterative optimization experiments.',
    'You have full read and write access to all files in the repository.',
    'You are free to explore and modify any files you deem necessary — there are no restrictions on which files may be edited.',
    'Your task is to make changes that improve the metric defined by the objective, then measure and report it.',
  ].join('\n');

  const promptLines = [
    `# Auto-Research Trial ${args.trialNum}`,
    '',
    '## Objective',
    args.objective,
    '',
    '## Current Best Metric',
    args.bestMetric !== null
      ? `The current best metric is M = ${args.bestMetric}. Try to exceed this value.`
      : 'No prior trials have completed yet. This establishes the baseline.',
    '',
    '## Experiment Directory',
    `Working directory: ${args.experimentDir}`,
    '',
    '## Prior Research Notes',
    args.notesContent.trim() || '(No notes from prior trials yet.)',
    '',
    '## Instructions',
    '1. Read the objective carefully and understand what metric you are optimising.',
    `2. Explore the entire repository freely — you may read and modify any files in ${args.experimentDir}. ` +
      'There are no restrictions on which files you may edit.',
    '3. Decide on what change(s) to make to try to improve the metric.',
    '4. Implement those changes across any files you deem necessary.',
    `5. Run the evaluation command: \`${args.evaluationCmd}\``,
    '6. Append a brief note to `notes.md` (in the experiment directory) summarising what you tried and why.',
    '7. At the very end of your response, output the measured metric on its own line in EXACTLY this format:',
    '   RESULT|M=<value>',
    '   For example: RESULT|M=0.9234',
    '',
    'Notes:',
    '- You have full access to all files in the repository; freely explore and modify anything.',
    '- The evaluation command may also print the metric as `RESULT|M=<value>` or `METRIC=<value>` in its output.',
    '- Always report the metric on its own line at the end of your final response.',
  ];

  return {
    prompt: promptLines.join('\n'),
    systemPrompt,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
    cwd: args.experimentDir,
    maxTurns: 120,
    maxBudgetUsd,
    transcriptPath,
  };
}

/**
 * Parse the metric from session output. Finds the last line matching
 * `RESULT|M=<float>` or `METRIC=<float>` and returns the parsed float.
 * Returns null if no match is found.
 */
export function parseMetricFromOutput(sessionOutput: string): number | null {
  const lines = sessionOutput.split('\n');
  let lastMatch: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match RESULT|M=<float>
    const resultMatch = trimmed.match(
      /^RESULT\|M=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/
    );
    if (resultMatch) {
      const v = parseFloat(resultMatch[1]);
      if (!isNaN(v)) lastMatch = v;
      continue;
    }

    // Match METRIC=<float>
    const metricMatch = trimmed.match(
      /^METRIC=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/
    );
    if (metricMatch) {
      const v = parseFloat(metricMatch[1]);
      if (!isNaN(v)) lastMatch = v;
    }
  }

  return lastMatch;
}

/**
 * Apply keep logic: commit all changes in the experiment directory.
 */
async function gitKeep(experimentDir: string, message: string): Promise<void> {
  try {
    await execAsync('git add -A', { cwd: experimentDir });
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: experimentDir,
    });
  } catch {
    // Non-fatal: git may report "nothing to commit" or similar
  }
}

/**
 * Apply discard logic: revert all uncommitted changes in the experiment directory.
 */
async function gitDiscard(experimentDir: string): Promise<void> {
  try {
    await execAsync('git checkout -- .', { cwd: experimentDir });
  } catch {
    // Non-fatal
  }
}

/**
 * Run the auto-research sweep loop.
 *
 * Each trial:
 *   1. Reads notes.md from experimentDir (if present)
 *   2. Builds the research prompt (full repo access, no file restrictions)
 *   3. Invokes the harness SDK session
 *   4. Parses the metric from the session output
 *   5. Keeps (git add -A && git commit) or discards (git checkout -- .) the changes
 *   6. Writes the trial result to trials/<N>/result.json
 *   7. Updates state.json with incremented trials_completed and best_metric
 *   8. Emits a run_state SSE event
 */
export async function runAutoResearchSweep(
  config: AutoResearchConfig,
  bus: EventBus
): Promise<void> {
  const { runId, experimentDir, objective, evaluationCmd, maxTrials, budgetMinutesPerTrial } =
    config;

  // Load initial state to pick up trials_completed and best_metric from any
  // prior partial run.
  let run = await loadRun(runId);
  let trialsCompleted = run.state.trials_completed ?? 0;
  let bestMetric: number | null = run.state.best_metric ?? null;

  for (let i = trialsCompleted; i < maxTrials; i++) {
    // Re-check run status in case the run was aborted externally.
    run = await loadRun(runId);
    if (run.state.status !== 'in_progress') break;

    const trialNum = i + 1;
    const trialStart = Date.now();

    // a. Read notes.md from the experiment directory.
    let notesContent = '';
    try {
      notesContent = await fs.readFile(path.join(experimentDir, 'notes.md'), 'utf8');
    } catch {
      // notes.md may not exist yet — that's fine.
    }

    // b. Build research prompt (no file restrictions).
    const sessionInput = buildResearchPrompt({
      runId,
      experimentDir,
      objective,
      evaluationCmd,
      trialNum,
      bestMetric,
      notesContent,
      budgetMinutesPerTrial,
    });

    // Ensure trial directory exists.
    await ensureDir(trialDir(runId, trialNum));

    // c. Invoke the harness SDK session.
    let sessionResult;
    try {
      sessionResult = await runSession(sessionInput);
    } catch {
      // Session error — record no_metric and move on.
      const duration_ms = Date.now() - trialStart;
      const result: TrialResult = {
        trial: trialNum,
        metric: null,
        status: 'no_metric',
        duration_ms,
      };
      await writeAtomic(
        trialResultPath(runId, trialNum),
        JSON.stringify(result, null, 2) + '\n'
      );
      trialsCompleted++;
      run = await loadRun(runId);
      await saveState({
        ...run.state,
        trials_completed: trialsCompleted,
        updated_at: new Date().toISOString(),
      });
      bus.publish({
        type: 'run_state',
        runId,
        state: (await loadRun(runId)).state,
      });
      continue;
    }

    const duration_ms = Date.now() - trialStart;

    // d. Parse metric from output.
    const rawOutput = sessionResult.resultText ?? '';
    const metric = parseMetricFromOutput(rawOutput);

    // e. Apply keep or discard via git.
    let status: TrialResult['status'];
    if (metric === null) {
      status = 'no_metric';
      // Discard when no metric was reported — don't keep noisy changes.
      await gitDiscard(experimentDir);
    } else if (bestMetric === null || metric > bestMetric) {
      status = 'improved';
      bestMetric = metric;
      await gitKeep(experimentDir, `trial ${trialNum}: M=${metric}`);
    } else {
      status = 'regressed';
      await gitDiscard(experimentDir);
    }

    // f. Write trial result.
    const trialResult: TrialResult = { trial: trialNum, metric, status, duration_ms };
    await writeAtomic(
      trialResultPath(runId, trialNum),
      JSON.stringify(trialResult, null, 2) + '\n'
    );

    // g. Update state.json.
    trialsCompleted++;
    run = await loadRun(runId);
    const updatedState = {
      ...run.state,
      trials_completed: trialsCompleted,
      ...(bestMetric !== null && { best_metric: bestMetric }),
      updated_at: new Date().toISOString(),
    };
    await saveState(updatedState);

    // h. Emit run_state SSE event.
    bus.publish({
      type: 'run_state',
      runId,
      state: (await loadRun(runId)).state,
    });
  }

  // Mark the run as completed once the trial budget is exhausted (or already done).
  run = await loadRun(runId);
  if (run.state.status === 'in_progress') {
    await saveState({
      ...run.state,
      status: 'completed',
      updated_at: new Date().toISOString(),
    });
    bus.publish({
      type: 'run_state',
      runId,
      state: (await loadRun(runId)).state,
    });
  }
}
