import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeAtomic, readOrNull } from '../lib/fs.js';
import { runsRoot, stackPath } from './paths.js';

/**
 * One entry in a stacked-PR plan. Order matters: `ordered[0]` is always the
 * run the operator originally invoked (the "root" of the stack). Each
 * subsequent entry's `base` is the previous entry's `branch`, so the chain
 * forms a dependency line of PRs.
 *
 * `runId` is filled in by the spawn action when we create the follow-up run
 * via `harness init --base <prev>`. Until then it's absent and the entry is
 * considered "not yet materialized" — the operator can still edit it.
 */
export interface StackEntry {
  slug: string;
  base: string;
  branch: string;
  task: string;
  runId?: string;
}

export interface Stack {
  ordered: StackEntry[];
  current_index: number;
  /**
   * When true, the chain auto-fires the next entry's auto-iterate the moment
   * the previous run reaches status=completed. Defaults to false (operator
   * drives each spawned run themselves).
   */
  auto_iterate_chain: boolean;
  /**
   * Index of an entry that halted/aborted, breaking the chain. Set by the
   * orchestrator when chain mode is on; cleared on resume / spawn.
   */
  halted_at?: number;
}

export async function readStack(runId: string): Promise<Stack | null> {
  const raw = await readOrNull(stackPath(runId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stack>;
    if (!parsed || !Array.isArray(parsed.ordered)) return null;
    return {
      ordered: parsed.ordered as StackEntry[],
      current_index: typeof parsed.current_index === 'number' ? parsed.current_index : 0,
      auto_iterate_chain: !!parsed.auto_iterate_chain,
      halted_at: typeof parsed.halted_at === 'number' ? parsed.halted_at : undefined
    };
  } catch {
    return null;
  }
}

export async function writeStack(runId: string, stack: Stack): Promise<void> {
  await writeAtomic(stackPath(runId), JSON.stringify(stack, null, 2));
}

/**
 * Find the stack.json (and the index of `targetRunId` within it) across all
 * runs. Used by the chain orchestrator to look up the parent stack from a
 * spawned follow-up's runId. Cheap: stack.json files are tiny and there are
 * typically a handful of runs.
 */
export async function findStackContaining(
  targetRunId: string
): Promise<{ rootRunId: string; stack: Stack; index: number } | null> {
  const root = runsRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return null;
  }
  for (const name of entries) {
    const candidate = path.join(root, name);
    try {
      const s = await fs.stat(candidate);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }
    const stack = await readStack(name);
    if (!stack) continue;
    const idx = stack.ordered.findIndex((e) => e.runId === targetRunId);
    if (idx >= 0) {
      return { rootRunId: name, stack, index: idx };
    }
  }
  return null;
}
