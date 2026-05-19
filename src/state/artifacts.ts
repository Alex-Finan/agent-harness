export type Verdict = 'PASS' | 'FAIL';

export interface SprintHeader {
  num: number;
  slug: string;
  title: string;
}

const VERDICT_RE = /verdict\s*:\s*(pass|fail)/i;

export function parseVerdict(md: string): Verdict | null {
  const m = md.match(VERDICT_RE);
  if (!m) return null;
  return m[1].toUpperCase() as Verdict;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SPRINT_HEADER_RE = /^##\s+sprint\s+(\d+)\s*[:\-—]\s*(.+?)\s*$/i;

export function parseSprintsFromPlan(planMd: string): SprintHeader[] {
  const sprints: SprintHeader[] = [];
  for (const line of planMd.split('\n')) {
    const m = line.match(SPRINT_HEADER_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      const title = m[2].trim();
      sprints.push({ num, slug: slugify(title), title });
    }
  }
  return sprints;
}
