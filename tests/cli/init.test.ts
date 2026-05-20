import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { handleInit } from '../../src/cli/commands/init.js';
import { handleFinish } from '../../src/cli/commands/finish.js';
import { handleAbort } from '../../src/cli/commands/abort.js';

const exec = promisify(execFile);

async function initTestRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await exec('git', ['-C', dir, 'init', '--initial-branch=develop', '--quiet']);
  await exec('git', ['-C', dir, 'config', 'user.email', 't@e.com']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'T']);
  await fs.writeFile(path.join(dir, 'README.md'), '# t\n');
  await exec('git', ['-C', dir, 'add', '.']);
  await exec('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
}

describe('harness init', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-init-'));
    process.env.AGENT_HARNESS_HOME = tmp;
  });
  afterEach(async () => {
    delete process.env.AGENT_HARNESS_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('inline task creates run dir with task.md and state.json', async () => {
    const result = await handleInit({
      repo: '/some/repo',
      task: 'do the thing',
      maxRetries: 3
    });
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    const runDir = path.join(tmp, 'runs', result.runId);
    expect((await fs.readFile(path.join(runDir, 'task.md'), 'utf8'))).toContain('do the thing');
    const state = JSON.parse(await fs.readFile(path.join(runDir, 'state.json'), 'utf8'));
    expect(state.next_role).toBe('planner');
    expect(state.target_repo).toBe('/some/repo');
  });

  test('file task loads contents from file', async () => {
    const taskFile = path.join(tmp, 'task.txt');
    await fs.writeFile(taskFile, 'task from file');
    const result = await handleInit({
      repo: '/r',
      taskFile,
      maxRetries: 2
    });
    const task = await fs.readFile(path.join(tmp, 'runs', result.runId, 'task.md'), 'utf8');
    expect(task).toContain('task from file');
  });

  test('requires either task or taskFile', async () => {
    await expect(handleInit({ repo: '/r', maxRetries: 3 })).rejects.toThrow(/task/);
  });

  test('--branch without --base is rejected', async () => {
    await expect(
      handleInit({ repo: '/r', task: 't', maxRetries: 3, branch: 'feat/x' })
    ).rejects.toThrow(/--base/);
  });

  describe('worktree mode (--base)', () => {
    let originRepo: string;
    let worktreeRoots: string[];

    beforeEach(async () => {
      originRepo = path.join(tmp, 'origin');
      worktreeRoots = [];
      await initTestRepo(originRepo);
      // Force the helper to put worktrees under tmp so cleanup is contained.
      process.env.AGENT_HARNESS_HOME = tmp;
    });

    test('creates a worktree on a fresh branch and persists metadata', async () => {
      // Point the default-worktree-path helper at tmp via HOME override.
      const realHome = process.env.HOME;
      process.env.HOME = tmp;
      try {
        const result = await handleInit({
          repo: originRepo,
          task: 'stacked task',
          maxRetries: 3,
          base: 'develop',
          branch: 'feat/from-test'
        });
        expect(result.worktreePath).toBeDefined();
        expect(result.branch).toBe('feat/from-test');
        worktreeRoots.push(result.worktreePath!);

        const state = JSON.parse(
          await fs.readFile(path.join(tmp, 'runs', result.runId, 'state.json'), 'utf8')
        );
        expect(state.target_repo).toBe(result.worktreePath);
        expect(state.origin_repo).toBe(originRepo);
        expect(state.base_branch).toBe('develop');
        expect(state.branch).toBe('feat/from-test');

        // The worktree dir should be a real git working tree.
        const readme = await fs.readFile(path.join(result.worktreePath!, 'README.md'), 'utf8');
        expect(readme).toMatch(/# t/);

        // finish --purge tears it down.
        const finRes = await handleFinish({ runId: result.runId, purge: true });
        expect(finRes.purged).toBe(true);
        await expect(fs.access(result.worktreePath!)).rejects.toThrow();
      } finally {
        process.env.HOME = realHome;
      }
    });

    test('abort --purge also tears down the worktree', async () => {
      const realHome = process.env.HOME;
      process.env.HOME = tmp;
      try {
        const result = await handleInit({
          repo: originRepo,
          task: 'will abort',
          maxRetries: 3,
          base: 'develop',
          branch: 'feat/abort-me'
        });
        const abortRes = await handleAbort({ runId: result.runId, purge: true });
        expect(abortRes.purged).toBe(true);
        await expect(fs.access(result.worktreePath!)).rejects.toThrow();
      } finally {
        process.env.HOME = realHome;
      }
    });
  });
});
