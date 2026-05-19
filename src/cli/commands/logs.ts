import type { Command } from 'commander';

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Print logs for a run')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
