import * as path from 'node:path';
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { runDir, planPath, taskPath, logsDir } from '../../state/paths.js';
import { readOrNull } from '../../lib/fs.js';
import { parseSprintsFromPlan } from '../../state/artifacts.js';
import { buildPlannerInput } from '../../roles/planner.js';
import { runSession } from '../../sdk/session.js';
import { advance } from '../../state/transitions.js';

export async function handlePlan(args: { runId: string }): Promise<void> {
  const run = await loadRun(args.runId);
  if (run.state.next_role !== 'planner') {
    throw new Error(`Cannot plan: next_role is ${run.state.next_role}`);
  }

  const input = await buildPlannerInput({
    runId: run.state.run_id,
    targetRepo: run.state.target_repo,
    runDirAbs: runDir(run.state.run_id),
    taskMdAbs: taskPath(run.state.run_id),
    transcriptPath: path.join(logsDir(run.state.run_id), 'planner.log')
  });

  const result = await runSession(input);
  if (!result.success) {
    throw new Error(`planner session failed: ${result.failureSubtype ?? 'unknown'}`);
  }

  const planMd = await readOrNull(planPath(run.state.run_id));
  if (planMd === null) {
    throw new Error(`planner did not write plan.md at ${planPath(run.state.run_id)}`);
  }

  const sprints = parseSprintsFromPlan(planMd);
  if (sprints.length === 0) {
    throw new Error('planner produced plan.md but no ## Sprint N: headers were found');
  }

  const nextState = advance(run.state, { totalSprints: sprints.length });
  await saveState(nextState);
}

export function registerPlan(program: Command): void {
  program
    .command('plan')
    .description('Invoke the planner role for a run')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      await handlePlan({ runId: opts.run });
      console.log(`planner complete`);
    });
}
