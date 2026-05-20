import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readOrNull } from '../lib/fs.js';
import {
  planPath,
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
}

export interface RunSnapshot {
  taskMd: string | null;
  planMd: string | null;
  sprints: SprintSnapshot[];
  logFiles: string[];
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
    const contractMd = await readOrNull(path.join(sprintDir, 'contract.md'));
    const outputMd = await readOrNull(path.join(sprintDir, 'output.md'));
    const verdictMd = await readOrNull(path.join(sprintDir, 'verdict.md'));
    const verdict = verdictMd ? parseVerdict(verdictMd) : null;
    sprints.push({ dirName: name, num, slug, contractMd, outputMd, verdictMd, verdict });
  }
  return sprints;
}

export async function readRunSnapshot(runId: string): Promise<RunSnapshot> {
  void runDir(runId);
  const taskMd = await readOrNull(taskPath(runId));
  const planMd = await readOrNull(planPath(runId));
  const sprints = await readSprints(runId);
  let logFiles: string[] = [];
  try {
    logFiles = (await fs.readdir(logsDir(runId))).filter((f) => f.endsWith('.log')).sort();
  } catch {
    /* logs dir may not exist yet */
  }
  return { taskMd, planMd, sprints, logFiles };
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
