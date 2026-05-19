import type { Command } from 'commander';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Print state of a run')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
