import type { Command } from 'commander';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List all runs')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
