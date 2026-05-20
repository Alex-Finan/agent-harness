import { z } from 'zod';

export const RoleEnum = z.enum(['planner', 'executor', 'evaluator', 'done']);
export type Role = z.infer<typeof RoleEnum>;

export const StatusEnum = z.enum(['in_progress', 'halted', 'completed', 'aborted']);
export type Status = z.infer<typeof StatusEnum>;

export const StateSchema = z.object({
  run_id: z.string(),
  target_repo: z.string(),
  task_summary: z.string(),
  current_sprint: z.number().int().nonnegative(),
  total_sprints: z.number().int().nonnegative(),
  next_role: RoleEnum,
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().positive(),
  status: StatusEnum,
  created_at: z.string(),
  updated_at: z.string(),
  last_verdict: z.enum(['PASS', 'FAIL']).optional(),
  // Worktree / stacking metadata. Present when the run was initialized with
  // --base; absent for legacy single-checkout runs. target_repo points at
  // worktree_path in that case, while origin_repo is the canonical checkout
  // where `git worktree add/remove` operate.
  origin_repo: z.string().optional(),
  worktree_path: z.string().optional(),
  branch: z.string().optional(),
  base_branch: z.string().optional()
});

export type State = z.infer<typeof StateSchema>;
