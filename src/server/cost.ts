import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logsDir } from '../state/paths.js';

export interface RoleCost {
  role: string;
  sprint: number | null;
  retry: number | null;
  costUsd: number;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  numTurns: number | null;
  subtype: string | null;
  logFile: string;
}

export interface RunCostSummary {
  totalUsd: number;
  perRole: Record<string, number>;
  perSprint: Record<string, number>;
  entries: RoleCost[];
}

const LOG_FILE_RE = /^(planner|executor|evaluator)(?:-s(\d+)-r(\d+))?\.log$/;

interface ResultMessage {
  type: 'result';
  subtype?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

async function parseLogFile(filePath: string): Promise<Partial<RoleCost> | null> {
  const content = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (content === null) return null;
  const lines = content.split('\n').filter((l) => l.trim());
  let lastResult: ResultMessage | null = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'result') {
        lastResult = parsed as ResultMessage;
      }
    } catch {
      // tolerate partial lines
    }
  }
  if (!lastResult) return null;
  const usage = lastResult.usage ?? {};
  return {
    costUsd: lastResult.total_cost_usd ?? 0,
    durationMs: lastResult.duration_ms ?? null,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    numTurns: lastResult.num_turns ?? null,
    subtype: lastResult.subtype ?? null
  };
}

export async function computeRunCost(runId: string): Promise<RunCostSummary> {
  const dir = logsDir(runId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { totalUsd: 0, perRole: {}, perSprint: {}, entries: [] };
    }
    throw err;
  }

  const entries: RoleCost[] = [];
  for (const f of files.sort()) {
    if (!f.endsWith('.log')) continue;
    const match = f.match(LOG_FILE_RE);
    if (!match) continue;
    const role = match[1];
    const sprint = match[2] !== undefined ? parseInt(match[2], 10) : null;
    const retry = match[3] !== undefined ? parseInt(match[3], 10) : null;
    const parsed = await parseLogFile(path.join(dir, f));
    if (!parsed) continue;
    entries.push({
      role,
      sprint,
      retry,
      costUsd: parsed.costUsd ?? 0,
      durationMs: parsed.durationMs ?? null,
      inputTokens: parsed.inputTokens ?? null,
      outputTokens: parsed.outputTokens ?? null,
      cacheCreationTokens: parsed.cacheCreationTokens ?? null,
      cacheReadTokens: parsed.cacheReadTokens ?? null,
      numTurns: parsed.numTurns ?? null,
      subtype: parsed.subtype ?? null,
      logFile: f
    });
  }

  const perRole: Record<string, number> = {};
  const perSprint: Record<string, number> = {};
  let totalUsd = 0;
  for (const e of entries) {
    totalUsd += e.costUsd;
    perRole[e.role] = (perRole[e.role] ?? 0) + e.costUsd;
    const key = e.sprint === null ? 'plan' : `sprint-${e.sprint}`;
    perSprint[key] = (perSprint[key] ?? 0) + e.costUsd;
  }

  return { totalUsd, perRole, perSprint, entries };
}
