import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { createRun } from '../../state/run.js';

export interface InitArgs {
  repo: string;
  task?: string;
  taskFile?: string;
  maxRetries: number;
}

export interface InitResult {
  runId: string;
}

export async function handleInit(args: InitArgs): Promise<InitResult> {
  let body = args.task;
  if (!body && args.taskFile) {
    body = await fs.readFile(args.taskFile, 'utf8');
  }
  if (!body) {
    throw new Error('--task or --task-file is required');
  }
  const repoAbs = path.resolve(args.repo);
  const run = await createRun({
    targetRepo: repoAbs,
    task: body,
    maxRetries: args.maxRetries
  });
  return { runId: run.state.run_id };
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a new run')
    .requiredOption('--repo <path>', 'Target repository path')
    .option('--task <text>', 'Task description (inline)')
    .option('--task-file <path>', 'Task description (from file)')
    .option('--max-retries <n>', 'Max retries per sprint', (v) => parseInt(v, 10), 3)
    .action(async (opts) => {
      const result = await handleInit({
        repo: opts.repo,
        task: opts.task,
        taskFile: opts.taskFile,
        maxRetries: opts.maxRetries
      });
      console.log(result.runId);
    });
}
