import type { Command } from 'commander';

export function registerNext(program: Command): void {
  program
    .command('next')
    .description('Advance the run by invoking the next role')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
