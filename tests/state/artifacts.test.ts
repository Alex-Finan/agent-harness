import { parseVerdict, parseSprintsFromPlan } from '../../src/state/artifacts.js';

describe('parseVerdict', () => {
  test('extracts PASS from header', () => {
    const md = '# Sprint 01 — Verdict: PASS\n\n## Rubric scoring\n...';
    expect(parseVerdict(md)).toBe('PASS');
  });

  test('extracts FAIL from header', () => {
    const md = '# Sprint 02 — Verdict: FAIL\n\nFix things';
    expect(parseVerdict(md)).toBe('FAIL');
  });

  test('case-insensitive', () => {
    expect(parseVerdict('# Verdict: pass')).toBe('PASS');
  });

  test('returns null when missing', () => {
    expect(parseVerdict('# random doc')).toBeNull();
  });
});

describe('parseSprintsFromPlan', () => {
  test('extracts sprint headers and slugs', () => {
    const plan = `
# Plan

## Sprint 1: Add silver job
something

## Sprint 2: Add gold job
more

## Notes
not a sprint
`;
    const sprints = parseSprintsFromPlan(plan);
    expect(sprints).toEqual([
      { num: 1, slug: 'add-silver-job', title: 'Add silver job' },
      { num: 2, slug: 'add-gold-job', title: 'Add gold job' }
    ]);
  });

  test('returns empty array when no sprints', () => {
    expect(parseSprintsFromPlan('# Plan\nno sprints')).toEqual([]);
  });

  test('slugifies titles with punctuation', () => {
    const plan = '## Sprint 1: Build the silver/payout_graph_edges job!';
    const sprints = parseSprintsFromPlan(plan);
    expect(sprints[0].slug).toBe('build-the-silver-payout-graph-edges-job');
  });
});
