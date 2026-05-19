import type { Command } from 'commander';

export function registerPlan(program: Command): void {
  program
    .command('plan')
    .description('Invoke the planner role for a run')
    .action(() => {
      console.error('not yet implemented');
      process.exit(1);
    });
}
