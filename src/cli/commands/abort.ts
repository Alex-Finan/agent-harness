import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';

export async function handleAbort(args: { runId: string }): Promise<void> {
  const run = await loadRun(args.runId);
  await saveState({ ...run.state, status: 'aborted', updated_at: new Date().toISOString() });
}

export function registerAbort(program: Command): void {
  program
    .command('abort')
    .description('Mark a run as aborted')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      await handleAbort({ runId: opts.run });
      console.log('aborted');
    });
}
