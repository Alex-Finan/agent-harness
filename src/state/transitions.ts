import type { State } from './schema.js';

export interface AdvanceContext {
  verdict?: 'PASS' | 'FAIL';
  totalSprints?: number;
}

export function advance(state: State, ctx: AdvanceContext = {}): State {
  const now = new Date().toISOString();
  const base: State = { ...state, updated_at: now };

  if (state.next_role === 'planner') {
    return {
      ...base,
      next_role: 'executor',
      current_sprint: 1,
      total_sprints: ctx.totalSprints ?? state.total_sprints,
      retry_count: 0
    };
  }

  if (state.next_role === 'executor') {
    return { ...base, next_role: 'evaluator' };
  }

  if (state.next_role === 'evaluator') {
    if (ctx.verdict === 'PASS') {
      if (state.current_sprint >= state.total_sprints) {
        return {
          ...base,
          next_role: 'done',
          status: 'completed',
          last_verdict: 'PASS'
        };
      }
      return {
        ...base,
        next_role: 'executor',
        current_sprint: state.current_sprint + 1,
        retry_count: 0,
        last_verdict: 'PASS'
      };
    }
    if (ctx.verdict === 'FAIL') {
      const next = state.retry_count + 1;
      if (next > state.max_retries) {
        return { ...base, status: 'halted', last_verdict: 'FAIL' };
      }
      return {
        ...base,
        next_role: 'executor',
        retry_count: next,
        last_verdict: 'FAIL'
      };
    }
    throw new Error('evaluator transition requires verdict in ctx');
  }

  // 'done' is terminal — just bump updated_at
  return base;
}
