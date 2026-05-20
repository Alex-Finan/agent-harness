import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { removeWorktree } from '../../lib/worktree.js';

export interface FinishArgs {
  runId: string;
  purge?: boolean;
}

/**
 * Mark a run completed and optionally tear down its worktree. This is the
 * success-path counterpart to `abort` — used after the PR has merged (or
 * been abandoned cleanly) to close out the run and reclaim the worktree.
 */
export async function handleFinish(args: FinishArgs): Promise<{ purged: boolean }> {
  const run = await loadRun(args.runId);
  await saveState({
    ...run.state,
    status: 'completed',
    next_role: 'done',
    updated_at: new Date().toISOString()
  });

  if (args.purge && run.state.worktree_path && run.state.origin_repo) {
    await removeWorktree(run.state.origin_repo, run.state.worktree_path, run.state.branch);
    return { purged: true };
  }
  return { purged: false };
}

export function registerFinish(program: Command): void {
  program
    .command('finish')
    .description("Mark a run completed (success-path counterpart to 'abort')")
    .requiredOption('--run <id>', 'Run id')
    .option('--purge', 'Also remove the worktree and delete its branch')
    .action(async (opts) => {
      const result = await handleFinish({ runId: opts.run, purge: opts.purge });
      console.log(result.purged ? 'completed + worktree purged' : 'completed');
    });
}
