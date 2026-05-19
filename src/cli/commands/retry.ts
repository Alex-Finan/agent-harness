import type { Command } from 'commander';
import { loadRun, saveState } from '../../state/run.js';

export async function handleRetry(args: { runId: string; notes?: string }): Promise<void> {
  const run = await loadRun(args.runId);
  if (run.state.next_role !== 'executor' && run.state.next_role !== 'evaluator') {
    throw new Error(`cannot retry from next_role=${run.state.next_role}`);
  }
  await saveState({ ...run.state, updated_at: new Date().toISOString() });
  if (args.notes) {
    console.log(`(retry notes recorded but not yet wired into executor prompt: ${args.notes})`);
  }
}

export function registerRetry(program: Command): void {
  program
    .command('retry')
    .description('Re-mark the current role as ready to run')
    .requiredOption('--run <id>', 'Run id')
    .option('--notes <text>', 'Extra notes (V1: logged only)')
    .action(async (opts) => {
      await handleRetry({ runId: opts.run, notes: opts.notes });
      console.log('retry recorded');
    });
}
