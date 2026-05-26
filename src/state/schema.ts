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
  base_branch: z.string().optional(),
  // When true the server should resume the auto-iterate loop after restart.
  // Defaults to false so old state.json files without this key parse cleanly.
  auto_iterate: z.boolean().default(false),
  // Run type discriminator. Defaults to 'standard' so old state.json files
  // without this key parse cleanly.
  run_type: z.enum(['standard', 'auto_research']).default('standard'),
  // --- Auto-research fields (all optional so legacy state files parse) ---
  /** Absolute path to the target repo / experiment directory. */
  experiment_dir: z.string().optional(),
  /** The optimization objective description (what to improve and how it is measured). */
  objective: z.string().optional(),
  /** Shell command to run to evaluate a trial (e.g. `bash run_experiment.sh`). */
  evaluation_cmd: z.string().optional(),
  /** Maximum number of trials to run. */
  max_trials: z.number().int().positive().optional(),
  /** Budget in minutes per trial. */
  budget_minutes_per_trial: z.number().int().positive().optional(),
  /** Number of trials completed so far. */
  trials_completed: z.number().int().nonnegative().default(0),
  /** Best composite metric (M) seen so far across all trials. */
  best_metric: z.number().optional()
});

export type State = z.infer<typeof StateSchema>;
