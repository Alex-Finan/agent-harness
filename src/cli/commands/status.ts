import type { Command } from 'commander';
import { loadRun } from '../../state/run.js';
import type { State } from '../../state/schema.js';

export async function handleStatus(args: { runId: string }): Promise<{ state: State }> {
  const run = await loadRun(args.runId);
  return { state: run.state };
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Print state of a run')
    .requiredOption('--run <id>', 'Run id')
    .action(async (opts) => {
      const { state } = await handleStatus({ runId: opts.run });
      console.log(JSON.stringify(state, null, 2));
    });
}
