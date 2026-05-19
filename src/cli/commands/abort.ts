import type { Command } from 'commander';

export function registerAbort(program: Command): void {
  program
    .command('abort')
    .description('Mark a run as aborted')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
