import * as crypto from 'node:crypto';
import { StateSchema, type State } from './schema.js';
import { runDir, statePath, taskPath, sprintsDir, logsDir } from './paths.js';
import { writeAtomic, readOrNull, ensureDir } from '../lib/fs.js';

export interface Run {
  state: State;
}

export function generateRunId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const timePart =
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${datePart}-${timePart}-${suffix}`;
}

export interface CreateRunInput {
  targetRepo: string;
  task: string;
  maxRetries: number;
}

export async function createRun(input: CreateRunInput): Promise<Run> {
  const runId = generateRunId();
  const now = new Date().toISOString();

  const state: State = {
    run_id: runId,
    target_repo: input.targetRepo,
    task_summary: input.task.split('\n')[0].slice(0, 120),
    current_sprint: 0,
    total_sprints: 0,
    next_role: 'planner',
    retry_count: 0,
    max_retries: input.maxRetries,
    status: 'in_progress',
    created_at: now,
    updated_at: now
  };

  await ensureDir(runDir(runId));
  await ensureDir(sprintsDir(runId));
  await ensureDir(logsDir(runId));

  const taskBody = [
    `# Task`,
    ``,
    `**Target repo:** ${input.targetRepo}`,
    `**Created:** ${now}`,
    `**Run ID:** ${runId}`,
    ``,
    `## Prompt`,
    ``,
    input.task
  ].join('\n');

  await writeAtomic(taskPath(runId), taskBody);
  await writeAtomic(statePath(runId), JSON.stringify(state, null, 2) + '\n');

  return { state };
}

export async function loadRun(runId: string): Promise<Run> {
  const raw = await readOrNull(statePath(runId));
  if (raw === null) {
    throw new Error(`Run not found: ${runId}`);
  }
  const parsed = StateSchema.parse(JSON.parse(raw));
  return { state: parsed };
}

export async function saveState(state: State): Promise<void> {
  StateSchema.parse(state);
  await writeAtomic(statePath(state.run_id), JSON.stringify(state, null, 2) + '\n');
}
