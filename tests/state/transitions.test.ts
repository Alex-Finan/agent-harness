import { advance } from '../../src/state/transitions.js';
import type { State } from '../../src/state/schema.js';

const base: State = {
  run_id: 'r',
  target_repo: '/x',
  task_summary: 't',
  current_sprint: 1,
  total_sprints: 3,
  next_role: 'planner',
  retry_count: 0,
  max_retries: 3,
  status: 'in_progress',
  created_at: 'now',
  updated_at: 'now'
};

describe('advance', () => {
  test('after planner -> executor on sprint 1', () => {
    const next = advance({ ...base, next_role: 'planner', current_sprint: 0 }, { totalSprints: 3 });
    expect(next.next_role).toBe('executor');
    expect(next.current_sprint).toBe(1);
    expect(next.total_sprints).toBe(3);
  });

  test('after executor -> evaluator (same sprint)', () => {
    const next = advance({ ...base, next_role: 'executor' });
    expect(next.next_role).toBe('evaluator');
    expect(next.current_sprint).toBe(1);
  });

  test('after evaluator PASS -> executor on next sprint', () => {
    const next = advance({ ...base, next_role: 'evaluator' }, { verdict: 'PASS' });
    expect(next.next_role).toBe('executor');
    expect(next.current_sprint).toBe(2);
    expect(next.retry_count).toBe(0);
    expect(next.last_verdict).toBe('PASS');
  });

  test('after evaluator FAIL under cap -> executor same sprint, retry++', () => {
    const next = advance({ ...base, next_role: 'evaluator', retry_count: 0 }, { verdict: 'FAIL' });
    expect(next.next_role).toBe('executor');
    expect(next.current_sprint).toBe(1);
    expect(next.retry_count).toBe(1);
    expect(next.status).toBe('in_progress');
  });

  test('after evaluator FAIL at cap -> halted', () => {
    const next = advance(
      { ...base, next_role: 'evaluator', retry_count: 3, max_retries: 3 },
      { verdict: 'FAIL' }
    );
    expect(next.status).toBe('halted');
    expect(next.next_role).toBe('evaluator');
  });

  test('after evaluator PASS on last sprint -> done + completed', () => {
    const next = advance(
      { ...base, next_role: 'evaluator', current_sprint: 3, total_sprints: 3 },
      { verdict: 'PASS' }
    );
    expect(next.next_role).toBe('done');
    expect(next.status).toBe('completed');
  });
});
