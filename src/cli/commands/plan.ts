import * as path from 'node:path';
import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { runDir, planPath, taskPath, logsDir } from '../../state/paths.js';
import { readOrNull } from '../../lib/fs.js';
import { parseSprintsFromPlan } from '../../state/artifacts.js';
import { buildPlannerInput } from '../../roles/planner.js';
import { runSession } from '../../sdk/session.js';
import { advance } from '../../state/transitions.js';
import {
  readPendingComments,
  clearPendingComments,
  formatCommentsForPlanner
} from '../../state/pendingComments.js';

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

export async function handlePlanRevise(args: {
  runId: string;
  revisionMessage: string;
}): Promise<void> {
  const run = await loadRun(args.runId);
  if (run.state.status !== 'in_progress') {
    throw new Error(`Cannot revise plan: run status is ${run.state.status}`);
  }
  const existing = await readOrNull(planPath(run.state.run_id));
  if (existing === null) {
    throw new Error(`Cannot revise plan: no plan.md exists yet. Run plan first.`);
  }

  // Bundle any pending review comments into the planner prompt alongside the
  // operator's free-text message. Comments are one-shot: cleared as soon as
  // the planner session is dispatched so a retry doesn't double-send them.
  const pending = await readPendingComments(run.state.run_id);
  const composite =
    formatCommentsForPlanner(pending, args.revisionMessage) ?? args.revisionMessage;
  await clearPendingComments(run.state.run_id);

  const input = await buildPlannerInput({
    runId: run.state.run_id,
    targetRepo: run.state.target_repo,
    runDirAbs: runDir(run.state.run_id),
    taskMdAbs: taskPath(run.state.run_id),
    transcriptPath: path.join(logsDir(run.state.run_id), 'planner.log'),
    revisionMessage: composite
  });

  const result = await runSession(input);
  if (!result.success) {
    throw new Error(`planner revision session failed: ${result.failureSubtype ?? 'unknown'}`);
  }

  const planMd = await readOrNull(planPath(run.state.run_id));
  if (planMd === null) {
    throw new Error(`planner revision lost plan.md at ${planPath(run.state.run_id)}`);
  }

  const sprints = parseSprintsFromPlan(planMd);
  if (sprints.length === 0) {
    throw new Error('revised plan.md has no ## Sprint N: headers');
  }

  if (sprints.length !== run.state.total_sprints) {
    await saveState({
      ...run.state,
      total_sprints: sprints.length,
      updated_at: new Date().toISOString()
    });
  }
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
