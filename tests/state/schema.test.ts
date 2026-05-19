import { StateSchema, RoleEnum, StatusEnum } from '../../src/state/schema.js';

describe('state schema', () => {
  test('accepts a valid state record', () => {
    const parsed = StateSchema.parse({
      run_id: '2026-05-19-093712-ace1f3',
      target_repo: '/Users/alex/repo',
      task_summary: 'add graph features',
      current_sprint: 0,
      total_sprints: 0,
      next_role: 'planner',
      retry_count: 0,
      max_retries: 3,
      status: 'in_progress',
      created_at: '2026-05-19T09:37:12.000Z',
      updated_at: '2026-05-19T09:37:12.000Z'
    });
    expect(parsed.next_role).toBe('planner');
  });

  test('rejects unknown role', () => {
    expect(() => RoleEnum.parse('hacker')).toThrow();
  });

  test('rejects unknown status', () => {
    expect(() => StatusEnum.parse('frozen')).toThrow();
  });
});
