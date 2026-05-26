import * as fs from 'node:fs/promises';
import { plannerLogPath } from './paths.js';

/**
 * Durable record of the operator ↔ planner conversation for a run.
 *
 * Stored as JSONL (one entry per line) at <runDir>/planner-log.jsonl so that
 * appends are safe, partial-write tolerant, and survive process restarts. The
 * file is the source of truth for the right-rail PlannerRail conversation —
 * client-side state is no longer authoritative.
 */
export interface ConversationEntry {
  at: string;
  role: 'user' | 'planner';
  text: string;
  /** Pending comments that were bundled with this user turn. UI hint only. */
  comments?: number;
  /** Marks an entry recorded when the planner failed mid-run. */
  failed?: boolean;
}

export async function readPlannerLog(runId: string): Promise<ConversationEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(plannerLogPath(runId), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: ConversationEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && (parsed.role === 'user' || parsed.role === 'planner')) {
        out.push(parsed as ConversationEntry);
      }
    } catch {
      /* Skip malformed lines rather than failing the whole snapshot — the
         conversation degrades gracefully if a line was truncated. */
    }
  }
  return out;
}

async function appendEntry(runId: string, entry: ConversationEntry): Promise<void> {
  const line = JSON.stringify(entry) + '\n';
  await fs.appendFile(plannerLogPath(runId), line, 'utf8');
}

export async function appendUserEntry(
  runId: string,
  text: string,
  comments = 0
): Promise<ConversationEntry> {
  const entry: ConversationEntry = {
    at: new Date().toISOString(),
    role: 'user',
    text,
    ...(comments > 0 ? { comments } : {})
  };
  await appendEntry(runId, entry);
  return entry;
}

export async function appendPlannerEntry(
  runId: string,
  text: string,
  failed = false
): Promise<ConversationEntry> {
  const entry: ConversationEntry = {
    at: new Date().toISOString(),
    role: 'planner',
    text,
    ...(failed ? { failed: true } : {})
  };
  await appendEntry(runId, entry);
  return entry;
}
