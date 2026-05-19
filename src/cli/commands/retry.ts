import type { Command } from 'commander';

export function registerRetry(program: Command): void {
  program
    .command('retry')
    .description('Re-mark the current role as ready to run')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
