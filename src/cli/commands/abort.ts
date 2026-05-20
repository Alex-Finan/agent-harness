import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';
import { removeWorktree } from '../../lib/worktree.js';

export interface AbortArgs {
  runId: string;
  purge?: boolean;
}

export async function handleAbort(args: AbortArgs): Promise<{ purged: boolean }> {
  const run = await loadRun(args.runId);
  await saveState({ ...run.state, status: 'aborted', updated_at: new Date().toISOString() });

  if (args.purge && run.state.worktree_path && run.state.origin_repo) {
    await removeWorktree(run.state.origin_repo, run.state.worktree_path, run.state.branch);
    return { purged: true };
  }
  return { purged: false };
}

export function registerAbort(program: Command): void {
  program
    .command('abort')
    .description('Mark a run as aborted')
    .requiredOption('--run <id>', 'Run id')
    .option('--purge', 'Also remove the worktree and delete its branch')
    .action(async (opts) => {
      const result = await handleAbort({ runId: opts.run, purge: opts.purge });
      console.log(result.purged ? 'aborted + worktree purged' : 'aborted');
    });
}
