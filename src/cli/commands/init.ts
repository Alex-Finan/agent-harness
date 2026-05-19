import type { Command } from 'commander';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a new run')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
