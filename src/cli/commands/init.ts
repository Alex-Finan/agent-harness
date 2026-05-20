import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { createRun, generateRunId } from '../../state/run.js';
import { createWorktree } from '../../lib/worktree.js';
import type { State } from '../../state/schema.js';

export interface InitArgs {
  repo: string;
  task?: string;
  taskFile?: string;
  maxRetries: number;
  /** Branch to stack on top of. When set, the run executes inside a fresh
   *  worktree branched off this ref. When omitted, the harness writes
   *  directly into the target repo on whatever branch is checked out
   *  (legacy single-checkout mode). */
  base?: string;
  /** Branch name for the worktree. Defaults to `harness/<run_id>` when
   *  --base is set; rejected when --base is omitted. */
  branch?: string;
}

export interface InitResult {
  runId: string;
  worktreePath?: string;
  branch?: string;
}

export async function handleInit(args: InitArgs): Promise<InitResult> {
  let body = args.task;
  if (!body && args.taskFile) {
    body = await fs.readFile(args.taskFile, 'utf8');
  }
  if (!body) {
    throw new Error('--task or --task-file is required');
  }
  const originRepo = path.resolve(args.repo);

  if (!args.base) {
    if (args.branch) {
      throw new Error('--branch requires --base (worktree mode)');
    }
    const run = await createRun({
      targetRepo: originRepo,
      task: body,
      maxRetries: args.maxRetries
    });
    return { runId: run.state.run_id };
  }

  // Worktree / stacking mode. Mint the run id first so the worktree dir can
  // be named after it, then create the worktree, then write state.json with
  // the worktree metadata baked in.
  const runId = generateRunId();
  const branch = args.branch ?? `harness/${runId}`;

  const wt = await createWorktree({
    originRepo,
    runId,
    baseBranch: args.base,
    newBranch: branch
  });

  const extraState: Partial<State> = {
    origin_repo: originRepo,
    worktree_path: wt.path,
    branch: wt.branch,
    base_branch: wt.baseBranch
  };

  const run = await createRun({
    runId,
    targetRepo: wt.path,
    task: body,
    maxRetries: args.maxRetries,
    extraState
  });

  return { runId: run.state.run_id, worktreePath: wt.path, branch: wt.branch };
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a new run')
    .requiredOption('--repo <path>', 'Target repository path (canonical checkout)')
    .option('--task <text>', 'Task description (inline)')
    .option('--task-file <path>', 'Task description (from file)')
    .option('--max-retries <n>', 'Max retries per sprint', (v) => parseInt(v, 10), 3)
    .option('--base <branch>', 'Base branch to stack on. Enables worktree mode.')
    .option('--branch <name>', 'Branch name for the worktree (default: harness/<run_id>)')
    .action(async (opts) => {
      const result = await handleInit({
        repo: opts.repo,
        task: opts.task,
        taskFile: opts.taskFile,
        maxRetries: opts.maxRetries,
        base: opts.base,
        branch: opts.branch
      });
      if (result.worktreePath) {
        console.log(`run_id:    ${result.runId}`);
        console.log(`worktree:  ${result.worktreePath}`);
        console.log(`branch:    ${result.branch}`);
      } else {
        console.log(result.runId);
      }
    });
}
