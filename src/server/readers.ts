import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readOrNull } from '../lib/fs.js';
import {
  planPath,
  overviewPath,
  runDir,
  sprintsDir,
  taskPath,
  logsDir
} from '../state/paths.js';
import { parseVerdict } from '../state/artifacts.js';

export interface SprintSnapshot {
  dirName: string;
  num: number;
  slug: string;
  contractMd: string | null;
  outputMd: string | null;
  verdictMd: string | null;
  verdict: 'PASS' | 'FAIL' | null;
  contractAt: string | null;
  outputAt: string | null;
  verdictAt: string | null;
}

export interface RunSnapshot {
  taskMd: string | null;
  overviewMd: string | null;
  planMd: string | null;
  sprints: SprintSnapshot[];
  logFiles: string[];
}

/**
 * Compact per-sprint summary suitable for inclusion in the runs-list payload.
 * Skips reading full markdown — just enough to color a progress pip.
 *
 * mtimes (ISO strings) come from the underlying file stat; they let the UI
 * answer "when did sprint 2 actually finish" without a separate event log.
 */
export interface SprintPip {
  num: number;
  verdict: 'PASS' | 'FAIL' | null;
  hasContract: boolean;
  hasOutput: boolean;
  contractAt: string | null;
  outputAt: string | null;
  verdictAt: string | null;
}

const SPRINT_DIR_RE = /^(\d+)-(.+)$/;

export async function readSprints(runId: string): Promise<SprintSnapshot[]> {
  const dir = sprintsDir(runId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const sprints: SprintSnapshot[] = [];
  for (const name of entries.sort()) {
    const m = name.match(SPRINT_DIR_RE);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const slug = m[2];
    const sprintDir = path.join(dir, name);
    const [contractMd, outputMd, verdictMd, contractStat, outputStat, verdictStat] =
      await Promise.all([
        readOrNull(path.join(sprintDir, 'contract.md')),
        readOrNull(path.join(sprintDir, 'output.md')),
        readOrNull(path.join(sprintDir, 'verdict.md')),
        statOrNull(path.join(sprintDir, 'contract.md')),
        statOrNull(path.join(sprintDir, 'output.md')),
        statOrNull(path.join(sprintDir, 'verdict.md'))
      ]);
    const verdict = verdictMd ? parseVerdict(verdictMd) : null;
    sprints.push({
      dirName: name,
      num,
      slug,
      contractMd,
      outputMd,
      verdictMd,
      verdict,
      contractAt: contractStat ? contractStat.mtime.toISOString() : null,
      outputAt: outputStat ? outputStat.mtime.toISOString() : null,
      verdictAt: verdictStat ? verdictStat.mtime.toISOString() : null
    });
  }
  return sprints;
}

/**
 * Cheap version of readSprints: just stats verdict/contract/output presence
 * without slurping the whole markdown. Designed for the runs-list endpoint,
 * which is polled frequently and called once per run.
 */
export async function readSprintPips(runId: string): Promise<SprintPip[]> {
  const dir = sprintsDir(runId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const pips: SprintPip[] = [];
  for (const name of entries.sort()) {
    const m = name.match(SPRINT_DIR_RE);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const sprintDir = path.join(dir, name);
    const [contractStat, outputStat, verdictMd, verdictStat] = await Promise.all([
      statOrNull(path.join(sprintDir, 'contract.md')),
      statOrNull(path.join(sprintDir, 'output.md')),
      readOrNull(path.join(sprintDir, 'verdict.md')),
      statOrNull(path.join(sprintDir, 'verdict.md'))
    ]);
    pips.push({
      num,
      hasContract: contractStat !== null,
      hasOutput: outputStat !== null,
      verdict: verdictMd ? parseVerdict(verdictMd) : null,
      contractAt: contractStat ? contractStat.mtime.toISOString() : null,
      outputAt: outputStat ? outputStat.mtime.toISOString() : null,
      verdictAt: verdictStat ? verdictStat.mtime.toISOString() : null
    });
  }
  return pips;
}

async function statOrNull(p: string): Promise<{ mtime: Date } | null> {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

export async function readRunSnapshot(runId: string): Promise<RunSnapshot> {
  void runDir(runId);
  const taskMd = await readOrNull(taskPath(runId));
  const overviewMd = await readOrNull(overviewPath(runId));
  const planMd = await readOrNull(planPath(runId));
  const sprints = await readSprints(runId);
  let logFiles: string[] = [];
  try {
    logFiles = (await fs.readdir(logsDir(runId))).filter((f) => f.endsWith('.log')).sort();
  } catch {
    /* logs dir may not exist yet */
  }
  return { taskMd, overviewMd, planMd, sprints, logFiles };
}

export async function readTranscript(runId: string, logName: string): Promise<{ lines: unknown[]; raw: string }> {
  if (!/^[a-z0-9_\-.]+$/i.test(logName)) {
    throw new Error('invalid log name');
  }
  const file = path.join(logsDir(runId), logName);
  const content = await fs.readFile(file, 'utf8').catch(() => '');
  const lines: unknown[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      lines.push({ type: 'raw', text: line });
    }
  }
  return { lines, raw: content };
}
