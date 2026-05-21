/**
 * Lightweight plan.md diff at the *sprint section* level.
 *
 * Plans are conventionally structured as `## Sprint N — slug` headings with
 * prose underneath. A sprint-level diff is more meaningful to operators than
 * a line-level diff: when the planner adds a sprint, splits one, or rewrites
 * the body, the operator wants to know that at a glance — not stare at a
 * unified diff of inline word changes.
 */

export interface SprintSection {
  num: number;
  /** Heading text after the "Sprint N —" prefix, e.g. "calibration harness" */
  title: string;
  /** Full heading line as originally written */
  heading: string;
  /** Body markdown between this heading and the next */
  body: string;
}

export interface PlanDiff {
  added: SprintSection[];
  removed: SprintSection[];
  modified: { before: SprintSection; after: SprintSection }[];
  unchanged: SprintSection[];
  /** True when the prose ABOVE the first sprint heading changed (e.g. Overview rewritten) */
  preambleChanged: boolean;
  isEmpty: boolean;
}

const SPRINT_HEADING_RE = /^##+\s+sprint\s+(\d+)\s*[—\-:]\s*(.+)$/i;

/**
 * Parse a plan markdown into the prose preamble + an ordered list of sprint
 * sections. Headings that don't match the "Sprint N — title" pattern (e.g.
 * "## Overview", "## Out of scope") are kept attached to whichever section
 * they precede.
 */
export function parsePlanSections(md: string): { preamble: string; sprints: SprintSection[] } {
  const lines = md.split('\n');
  const preambleLines: string[] = [];
  const sprints: SprintSection[] = [];
  let cur: SprintSection | null = null;
  let curBodyLines: string[] = [];

  function flush() {
    if (cur) {
      cur.body = curBodyLines.join('\n').trim();
      sprints.push(cur);
    }
  }

  for (const line of lines) {
    const m = SPRINT_HEADING_RE.exec(line.trim());
    if (m) {
      flush();
      cur = { num: parseInt(m[1], 10), title: m[2].trim(), heading: line, body: '' };
      curBodyLines = [];
    } else if (cur) {
      curBodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flush();

  return { preamble: preambleLines.join('\n').trim(), sprints };
}

export function diffPlans(beforeMd: string, afterMd: string): PlanDiff {
  const before = parsePlanSections(beforeMd);
  const after = parsePlanSections(afterMd);

  const beforeByNum = new Map(before.sprints.map((s) => [s.num, s]));
  const afterByNum = new Map(after.sprints.map((s) => [s.num, s]));

  const added: SprintSection[] = [];
  const removed: SprintSection[] = [];
  const modified: { before: SprintSection; after: SprintSection }[] = [];
  const unchanged: SprintSection[] = [];

  // Walk the union of sprint numbers
  const allNums = new Set([...beforeByNum.keys(), ...afterByNum.keys()]);
  for (const n of [...allNums].sort((a, b) => a - b)) {
    const b = beforeByNum.get(n);
    const a = afterByNum.get(n);
    if (a && !b) added.push(a);
    else if (b && !a) removed.push(b);
    else if (a && b) {
      if (a.title === b.title && a.body === b.body) unchanged.push(a);
      else modified.push({ before: b, after: a });
    }
  }

  const preambleChanged = before.preamble.trim() !== after.preamble.trim();
  const isEmpty =
    added.length === 0 &&
    removed.length === 0 &&
    modified.length === 0 &&
    !preambleChanged;

  return { added, removed, modified, unchanged, preambleChanged, isEmpty };
}

/**
 * Tiny line-level diff for one sprint body — used inside the "view details"
 * expansion. Returns added/removed line counts for a quick summary; full diff
 * rendering can be layered later.
 */
export function bodyLineDelta(before: string, after: string): { added: number; removed: number } {
  const b = new Set(before.split('\n').map((l) => l.trim()).filter(Boolean));
  const a = new Set(after.split('\n').map((l) => l.trim()).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const line of a) if (!b.has(line)) added++;
  for (const line of b) if (!a.has(line)) removed++;
  return { added, removed };
}
