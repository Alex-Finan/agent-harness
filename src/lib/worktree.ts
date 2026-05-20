import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';

const run = promisify(execFile);

export interface CreateWorktreeInput {
  /** Path to the canonical (non-worktree) checkout where `git worktree add` runs. */
  originRepo: string;
  /** Run id — used to derive the worktree directory name. */
  runId: string;
  /** Branch the new worktree is based on. Must exist locally or on `origin`. */
  baseBranch: string;
  /** New branch the worktree checks out. Must not already exist locally. */
  newBranch: string;
  /** Override the worktree root. Defaults to ~/.agent-harness/worktrees/<runId>. */
  worktreeRoot?: string;
  /** Skip the `git fetch origin <baseBranch>` step. Used in tests. */
  skipFetch?: boolean;
}

export interface Worktree {
  path: string;
  branch: string;
  baseBranch: string;
}

export function defaultWorktreePath(runId: string): string {
  return path.join(os.homedir(), '.agent-harness', 'worktrees', runId);
}

/**
 * Create an isolated git worktree on a fresh branch, ready for the harness
 * to write into. Fetches `origin/<baseBranch>` first so stacked runs don't
 * branch off a stale ref.
 *
 * The base ref is resolved with the same precedence `git` uses: a local
 * branch named `baseBranch` is preferred when present (so you can stack on
 * a branch that hasn't been pushed yet); otherwise `origin/<baseBranch>`.
 */
export async function createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
  const worktreePath = input.worktreeRoot ?? defaultWorktreePath(input.runId);

  if (!input.skipFetch) {
    // Best-effort fetch. If there's no `origin` remote (e.g. a tmpdir test
    // repo), we don't want to abort — the local ref check below will catch
    // a truly missing base.
    try {
      await run('git', ['-C', input.originRepo, 'fetch', '--quiet', 'origin', input.baseBranch]);
    } catch {
      // Intentional: fall through to the local base check.
    }
  }

  const base = await resolveBaseRef(input.originRepo, input.baseBranch);

  await run('git', [
    '-C',
    input.originRepo,
    'worktree',
    'add',
    '-b',
    input.newBranch,
    worktreePath,
    base
  ]);

  return { path: worktreePath, branch: input.newBranch, baseBranch: input.baseBranch };
}

/**
 * Remove a worktree and delete its branch. `--force` is used so an in-flight
 * editor or uncommitted local file in the worktree doesn't block cleanup
 * after `harness abort --purge`.
 */
export async function removeWorktree(originRepo: string, worktreePath: string, branch?: string): Promise<void> {
  await run('git', ['-C', originRepo, 'worktree', 'remove', '--force', worktreePath]).catch((err) => {
    // If the worktree dir was already deleted by hand, prune the metadata
    // and keep going rather than failing the cleanup.
    if (/is not a working tree|not a valid path/i.test(String(err?.stderr ?? err?.message ?? ''))) {
      return;
    }
    throw err;
  });
  await run('git', ['-C', originRepo, 'worktree', 'prune']).catch(() => {
    /* prune failure is non-fatal */
  });
  if (branch) {
    await run('git', ['-C', originRepo, 'branch', '-D', branch]).catch(() => {
      /* branch may already be gone; ignore */
    });
  }
}

async function resolveBaseRef(originRepo: string, baseBranch: string): Promise<string> {
  // Prefer a local branch (so you can stack on un-pushed work). Fall back
  // to origin/<baseBranch>. Throw a clear error if neither exists.
  const local = await run('git', ['-C', originRepo, 'rev-parse', '--verify', '--quiet', `refs/heads/${baseBranch}`]).catch(
    () => null
  );
  if (local) return baseBranch;

  const remote = await run('git', [
    '-C',
    originRepo,
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/origin/${baseBranch}`
  ]).catch(() => null);
  if (remote) return `origin/${baseBranch}`;

  throw new Error(
    `Base branch '${baseBranch}' not found locally or on origin in ${originRepo}. ` +
      `Fetch the branch or pass an existing one with --base.`
  );
}
