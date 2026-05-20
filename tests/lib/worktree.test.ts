import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createWorktree, removeWorktree, defaultWorktreePath } from '../../src/lib/worktree.js';

const run = promisify(execFile);

async function initRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await run('git', ['-C', dir, 'init', '--initial-branch=develop', '--quiet']);
  await run('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  await run('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'README.md'), '# test\n');
  await run('git', ['-C', dir, 'add', '.']);
  await run('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
}

describe('worktree helper', () => {
  let tmp: string;
  let originRepo: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-harness-wt-'));
    originRepo = path.join(tmp, 'origin');
    await initRepo(originRepo);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('defaultWorktreePath is under ~/.agent-harness/worktrees', () => {
    const p = defaultWorktreePath('2026-05-20-000000-abcdef');
    expect(p).toBe(path.join(os.homedir(), '.agent-harness', 'worktrees', '2026-05-20-000000-abcdef'));
  });

  test('createWorktree adds a worktree on a fresh branch off the base', async () => {
    const wtRoot = path.join(tmp, 'wt-1');
    const result = await createWorktree({
      originRepo,
      runId: 'run-1',
      baseBranch: 'develop',
      newBranch: 'feat/test-branch',
      worktreeRoot: wtRoot,
      skipFetch: true
    });

    expect(result.path).toBe(wtRoot);
    expect(result.branch).toBe('feat/test-branch');
    expect(result.baseBranch).toBe('develop');

    // worktree dir exists with the README from develop
    const readme = await fs.readFile(path.join(wtRoot, 'README.md'), 'utf8');
    expect(readme).toMatch(/# test/);

    // branch was created
    const { stdout } = await run('git', ['-C', originRepo, 'branch', '--list', 'feat/test-branch']);
    expect(stdout).toMatch(/feat\/test-branch/);
  });

  test('createWorktree throws a clear error when base branch does not exist', async () => {
    await expect(
      createWorktree({
        originRepo,
        runId: 'run-bad',
        baseBranch: 'nonexistent-branch',
        newBranch: 'feat/x',
        worktreeRoot: path.join(tmp, 'wt-bad'),
        skipFetch: true
      })
    ).rejects.toThrow(/not found locally or on origin/);
  });

  test('createWorktree can stack: branch off a local non-default branch', async () => {
    // Create a feature branch on origin to stack on top of.
    await run('git', ['-C', originRepo, 'checkout', '-q', '-b', 'feat/parent']);
    await fs.writeFile(path.join(originRepo, 'parent.txt'), 'parent\n');
    await run('git', ['-C', originRepo, 'add', '.']);
    await run('git', ['-C', originRepo, 'commit', '-q', '-m', 'parent commit']);
    await run('git', ['-C', originRepo, 'checkout', '-q', 'develop']);

    const wtRoot = path.join(tmp, 'wt-child');
    await createWorktree({
      originRepo,
      runId: 'run-child',
      baseBranch: 'feat/parent',
      newBranch: 'feat/child',
      worktreeRoot: wtRoot,
      skipFetch: true
    });

    // The worktree should see the parent.txt from feat/parent.
    const parentFile = await fs.readFile(path.join(wtRoot, 'parent.txt'), 'utf8');
    expect(parentFile).toMatch(/parent/);
  });

  test('removeWorktree tears down the worktree and deletes the branch', async () => {
    const wtRoot = path.join(tmp, 'wt-rm');
    await createWorktree({
      originRepo,
      runId: 'run-rm',
      baseBranch: 'develop',
      newBranch: 'feat/to-remove',
      worktreeRoot: wtRoot,
      skipFetch: true
    });

    await removeWorktree(originRepo, wtRoot, 'feat/to-remove');

    await expect(fs.access(wtRoot)).rejects.toThrow();
    const { stdout } = await run('git', ['-C', originRepo, 'branch', '--list', 'feat/to-remove']);
    expect(stdout.trim()).toBe('');
  });

  test('removeWorktree tolerates a worktree dir that was already deleted by hand', async () => {
    const wtRoot = path.join(tmp, 'wt-orphan');
    await createWorktree({
      originRepo,
      runId: 'run-orphan',
      baseBranch: 'develop',
      newBranch: 'feat/orphan',
      worktreeRoot: wtRoot,
      skipFetch: true
    });
    // Simulate someone rm -rf'ing the worktree dir out from under us.
    await fs.rm(wtRoot, { recursive: true, force: true });
    await expect(removeWorktree(originRepo, wtRoot, 'feat/orphan')).resolves.not.toThrow();
  });
});
