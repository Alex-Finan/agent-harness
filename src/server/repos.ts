import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const run = promisify(execFile);

export interface Repo {
  /** owner/name */
  slug: string;
  description: string | null;
  /** Absolute path to a local clone of this repo, if one was found in the
   *  configured search roots. Null when the repo is not cloned locally. */
  localPath: string | null;
  /** Where this entry came from. Useful for the UI to differentiate. */
  source: 'gh' | 'local-only';
}

export interface ListReposResult {
  repos: Repo[];
  cachedAt: string;
  ghAvailable: boolean;
  searchRoots: string[];
}

let cache: { result: ListReposResult; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Search roots for local clones. Override with AGENT_HARNESS_REPO_ROOTS
 *  (colon-separated list of absolute paths). */
function searchRoots(): string[] {
  const env = process.env.AGENT_HARNESS_REPO_ROOTS;
  if (env) {
    return env.split(':').filter((p) => p.length > 0);
  }
  const home = os.homedir();
  return [path.join(home, 'Developer'), path.join(home, 'Code'), path.join(home, 'src'), path.join(home, 'projects')];
}

/** Parse `owner/name` out of a git remote URL.
 *  Handles https://github.com/owner/name(.git), git@github.com:owner/name(.git),
 *  and ssh://git@github.com/owner/name(.git). */
export function parseRepoSlug(url: string): string | null {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const m = cleaned.match(/(?:github\.com[/:])([^/]+\/[^/]+)$/);
  return m ? m[1] : null;
}

/** Walk each search root one level deep, looking for clones. Returns a map
 *  from `owner/name` → absolute path of the first clone found for that slug. */
async function findLocalClones(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const root of searchRoots()) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue; // root doesn't exist
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const gitDir = path.join(dir, '.git');
      const isGit = await fs
        .stat(gitDir)
        .then(() => true)
        .catch(() => false);
      if (!isGit) continue;
      const url = await run('git', ['-C', dir, 'config', '--get', 'remote.origin.url'])
        .then((r) => r.stdout.trim())
        .catch(() => '');
      if (!url) continue;
      const slug = parseRepoSlug(url);
      if (!slug) continue;
      if (!map.has(slug)) {
        map.set(slug, dir);
      }
    }
  }
  return map;
}

interface GhRepo {
  nameWithOwner: string;
  description?: string;
}

/** Shell out to `gh repo list` for repos owned by the user, then for each
 *  org they belong to. Tolerates `gh` missing or unauthed (returns []). */
async function listGithubRepos(): Promise<{ repos: GhRepo[]; available: boolean }> {
  const out: GhRepo[] = [];
  let available = true;

  const personal = await run('gh', [
    'repo',
    'list',
    '--limit',
    '200',
    '--json',
    'nameWithOwner,description'
  ]).catch(() => null);
  if (!personal) {
    return { repos: [], available: false };
  }
  try {
    out.push(...(JSON.parse(personal.stdout) as GhRepo[]));
  } catch {
    available = false;
  }

  const orgsRaw = await run('gh', ['api', 'user/orgs', '--jq', '.[].login']).catch(() => null);
  if (orgsRaw) {
    const orgs = orgsRaw.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const org of orgs) {
      const orgRepos = await run('gh', [
        'repo',
        'list',
        org,
        '--limit',
        '200',
        '--json',
        'nameWithOwner,description'
      ]).catch(() => null);
      if (!orgRepos) continue;
      try {
        out.push(...(JSON.parse(orgRepos.stdout) as GhRepo[]));
      } catch {
        /* ignore malformed gh output for this org */
      }
    }
  }

  // De-dupe — gh can list the same repo across user + org if the user is
  // a member of the owning org.
  const seen = new Set<string>();
  const deduped = out.filter((r) => {
    if (seen.has(r.nameWithOwner)) return false;
    seen.add(r.nameWithOwner);
    return true;
  });

  return { repos: deduped, available };
}

export async function listRepos(opts: { force?: boolean } = {}): Promise<ListReposResult> {
  if (!opts.force && cache && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  const [ghResult, localMap] = await Promise.all([listGithubRepos(), findLocalClones()]);

  const repos: Repo[] = [];
  const seen = new Set<string>();

  for (const gh of ghResult.repos) {
    seen.add(gh.nameWithOwner);
    repos.push({
      slug: gh.nameWithOwner,
      description: gh.description ?? null,
      localPath: localMap.get(gh.nameWithOwner) ?? null,
      source: 'gh'
    });
  }

  // Surface local clones whose origin we recognized but that didn't come
  // back from `gh repo list` (e.g. user lost access, repo was renamed, or
  // gh wasn't available). The user has them on disk — they should be
  // selectable.
  for (const [slug, localPath] of localMap.entries()) {
    if (seen.has(slug)) continue;
    repos.push({
      slug,
      description: null,
      localPath,
      source: 'local-only'
    });
  }

  // Sort: local clones first (they're what the user can actually run
  // against), then alphabetically by slug.
  repos.sort((a, b) => {
    const aLocal = a.localPath ? 0 : 1;
    const bLocal = b.localPath ? 0 : 1;
    if (aLocal !== bLocal) return aLocal - bLocal;
    return a.slug.localeCompare(b.slug);
  });

  const result: ListReposResult = {
    repos,
    cachedAt: new Date().toISOString(),
    ghAvailable: ghResult.available,
    searchRoots: searchRoots()
  };
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

/** Test-only: clear the in-memory cache. */
export function _clearRepoCacheForTests(): void {
  cache = null;
}
