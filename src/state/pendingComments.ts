import * as fs from 'node:fs/promises';
import { writeAtomic, readOrNull } from '../lib/fs.js';
import { pendingCommentsPath } from './paths.js';

export interface CommentAnchor {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  quoted_text: string;
}

export interface PendingComment {
  id: string;
  file: string;
  anchor: CommentAnchor;
  body: string;
  created_at: string;
}

interface PendingCommentsFile {
  comments: PendingComment[];
}

const SPRINT_CONTRACT_RE = /^sprints\/\d{2}-[a-z0-9][a-z0-9-]*\/contract\.md$/;

export function isValidCommentFile(file: string): boolean {
  return file === 'overview.md' || file === 'plan.md' || SPRINT_CONTRACT_RE.test(file);
}

export async function readPendingComments(runId: string): Promise<PendingComment[]> {
  const raw = await readOrNull(pendingCommentsPath(runId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingCommentsFile;
    if (parsed && Array.isArray(parsed.comments)) return parsed.comments;
  } catch {
    /* corrupt file — treat as empty so we don't wedge the UI */
  }
  return [];
}

export async function writePendingComments(
  runId: string,
  comments: PendingComment[]
): Promise<void> {
  const payload: PendingCommentsFile = { comments };
  await writeAtomic(pendingCommentsPath(runId), JSON.stringify(payload, null, 2));
}

export async function clearPendingComments(runId: string): Promise<void> {
  // unlink rather than write an empty array: the watcher's "file deleted"
  // signal is what the UI uses to clear all highlights in one tick.
  try {
    await fs.unlink(pendingCommentsPath(runId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Build the structured block sent to the planner on iterate. Returns null
 * when there are no comments AND no free-text message (caller should treat
 * that as "nothing to revise"). Otherwise returns the full composite text.
 */
export function formatCommentsForPlanner(
  comments: PendingComment[],
  freeText: string
): string | null {
  const trimmedFree = freeText.trim();
  if (comments.length === 0 && trimmedFree.length === 0) return null;

  const parts: string[] = [];
  if (comments.length > 0) {
    parts.push('## Operator review — address each item carefully');
    parts.push('');
    // Group by file so the planner reads all overview comments together,
    // then all plan comments, etc.
    const byFile = new Map<string, PendingComment[]>();
    for (const c of comments) {
      const arr = byFile.get(c.file) ?? [];
      arr.push(c);
      byFile.set(c.file, arr);
    }
    let idx = 1;
    for (const [file, list] of byFile.entries()) {
      for (const c of list) {
        const range =
          c.anchor.start_line === c.anchor.end_line
            ? `line ${c.anchor.start_line + 1}`
            : `lines ${c.anchor.start_line + 1}-${c.anchor.end_line + 1}`;
        parts.push(`### Comment ${idx} — ${file} (${range})`);
        parts.push('Quoted text:');
        for (const line of c.anchor.quoted_text.split('\n')) {
          parts.push(`> ${line}`);
        }
        parts.push('');
        parts.push('Comment:');
        parts.push(c.body);
        parts.push('');
        idx++;
      }
    }
    parts.push('');
  }

  parts.push("## Operator's overall revision message");
  parts.push(trimmedFree.length > 0 ? trimmedFree : '_(no free-text message — address the comments above)_');
  parts.push('');
  parts.push('---');
  parts.push(
    'Instructions: Address every comment above. For each one, either apply the change in the relevant file, OR — if you disagree — leave the section alone and write one short line under the affected heading explaining why. Do not silently skip a comment.'
  );

  return parts.join('\n');
}

export function newCommentId(): string {
  // Sortable + collision-resistant enough for single-operator use.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `c-${t}-${r}`;
}
