import { Command } from 'commander';
import { VERSION } from '../index.js';

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('harness')
    .description('Local CLI harness for long-running Claude Agent SDK sessions')
    .version(VERSION);

  const { registerInit } = await import('./commands/init.js');
  const { registerPlan } = await import('./commands/plan.js');
  const { registerNext } = await import('./commands/next.js');
  const { registerStatus } = await import('./commands/status.js');
  const { registerList } = await import('./commands/list.js');
  const { registerLogs } = await import('./commands/logs.js');
  const { registerRetry } = await import('./commands/retry.js');
  const { registerAbort } = await import('./commands/abort.js');

  registerInit(program);
  registerPlan(program);
  registerNext(program);
  registerStatus(program);
  registerList(program);
  registerLogs(program);
  registerRetry(program);
  registerAbort(program);

  await program.parseAsync(argv);
}
