import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { runDir, sprintsDir, planPath, logsDir } from '../../state/paths.js';
import { readOrNull } from '../../lib/fs.js';
import { advance } from '../../state/transitions.js';
import { parseVerdict } from '../../state/artifacts.js';
import { buildExecutorInput } from '../../roles/executor.js';
import { buildEvaluatorInput } from '../../roles/evaluator.js';
import { runSession } from '../../sdk/session.js';

async function resolveSprintDir(runId: string, sprintNum: number): Promise<string> {
  const dir = sprintsDir(runId);
  const entries = await fs.readdir(dir);
  const prefix = sprintNum.toString().padStart(2, '0') + '-';
  const match = entries.find((e) => e.startsWith(prefix));
  if (!match) throw new Error(`no sprint dir for sprint ${sprintNum} (prefix ${prefix}) in ${dir}`);
  return path.join(dir, match);
}

async function readRetryNotes(sprintDir: string): Promise<string | null> {
  const verdictMd = await readOrNull(path.join(sprintDir, 'verdict.md'));
  if (!verdictMd) return null;
  const verdict = parseVerdict(verdictMd);
  if (verdict !== 'FAIL') return null;
  const m = verdictMd.match(/## Fix-it-back notes\s*\n([\s\S]+)$/i);
  return m ? m[1].trim() : verdictMd;
}

export async function handleNext(args: { runId: string }): Promise<void> {
  const run = await loadRun(args.runId);
  const s = run.state;

  if (s.status !== 'in_progress') {
    throw new Error(`run not in progress: status=${s.status}`);
  }
  if (s.next_role === 'planner') {
    throw new Error('use `harness plan` for the planner role');
  }
  if (s.next_role === 'done') {
    throw new Error('run already done');
  }

  const sprintDir = await resolveSprintDir(s.run_id, s.current_sprint);

  if (s.next_role === 'executor') {
    const retryNotes = await readRetryNotes(sprintDir);
    const input = await buildExecutorInput({
      runId: s.run_id,
      targetRepo: s.target_repo,
      runDirAbs: runDir(s.run_id),
      sprintDirAbs: sprintDir,
      planMdAbs: planPath(s.run_id),
      transcriptPath: path.join(logsDir(s.run_id), `executor-s${s.current_sprint}-r${s.retry_count}.log`),
      retryNotes
    });
    const result = await runSession(input);
    if (!result.success) {
      throw new Error(`executor session failed: ${result.failureSubtype ?? 'unknown'}`);
    }
    const outputMd = await readOrNull(path.join(sprintDir, 'output.md'));
    if (outputMd === null) {
      throw new Error(`executor did not write output.md in ${sprintDir}`);
    }
    await saveState(advance(s, {}));
    return;
  }

  if (s.next_role === 'evaluator') {
    const input = await buildEvaluatorInput({
      runId: s.run_id,
      targetRepo: s.target_repo,
      runDirAbs: runDir(s.run_id),
      sprintDirAbs: sprintDir,
      planMdAbs: planPath(s.run_id),
      transcriptPath: path.join(logsDir(s.run_id), `evaluator-s${s.current_sprint}-r${s.retry_count}.log`)
    });
    const result = await runSession(input);
    if (!result.success) {
      throw new Error(`evaluator session failed: ${result.failureSubtype ?? 'unknown'}`);
    }
    const verdictMd = await readOrNull(path.join(sprintDir, 'verdict.md'));
    if (verdictMd === null) {
      throw new Error(`evaluator did not write verdict.md in ${sprintDir}`);
    }
    const verdict = parseVerdict(verdictMd);
    if (verdict === null) {
      throw new Error(`evaluator wrote verdict.md but no "Verdict: PASS|FAIL" header found`);
    }
    await saveState(advance(s, { verdict }));
    return;
  }
}

export function registerNext(program: Command): void {
  program
    .command('next')
    .description('Advance the run by invoking the next role')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      await handleNext({ runId: opts.run });
      console.log('advanced');
    });
}
