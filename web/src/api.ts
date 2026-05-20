export type Verdict = 'PASS' | 'FAIL';

export interface RunState {
  run_id: string;
  target_repo: string;
  task_summary: string;
  current_sprint: number;
  total_sprints: number;
  next_role: 'planner' | 'executor' | 'evaluator' | 'done';
  retry_count: number;
  max_retries: number;
  status: 'in_progress' | 'halted' | 'completed' | 'aborted';
  created_at: string;
  updated_at: string;
  last_verdict?: Verdict;
  origin_repo?: string;
  worktree_path?: string;
  branch?: string;
  base_branch?: string;
  cost_total_usd?: number;
  dispatching?: 'planner' | 'next' | null;
}

export interface SprintSnapshot {
  dirName: string;
  num: number;
  slug: string;
  contractMd: string | null;
  outputMd: string | null;
  verdictMd: string | null;
  verdict: Verdict | null;
}

export interface RunSnapshot {
  taskMd: string | null;
  planMd: string | null;
  sprints: SprintSnapshot[];
  logFiles: string[];
}

export interface RoleCost {
  role: string;
  sprint: number | null;
  retry: number | null;
  costUsd: number;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  numTurns: number | null;
  subtype: string | null;
  logFile: string;
}

export interface RunCostSummary {
  totalUsd: number;
  perRole: Record<string, number>;
  perSprint: Record<string, number>;
  entries: RoleCost[];
}

export interface RunDetail {
  state: RunState;
  snapshot: RunSnapshot;
  sprintsInPlan: { num: number; slug: string; title: string }[];
  cost: RunCostSummary;
  dispatching: {
    role: 'planner' | 'next';
    startedAt: string;
    finished: boolean;
    error?: string;
  } | null;
}

export type PromptName = 'planner' | 'executor' | 'evaluator';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => http<{ version: string; harnessHome: string }>('/api/meta'),

  listRuns: () => http<{ runs: RunState[] }>('/api/runs'),

  getRun: (id: string) => http<RunDetail>(`/api/runs/${id}`),

  createRun: (body: { repo: string; task: string; maxRetries?: number; base?: string; branch?: string }) =>
    http<{ runId: string; worktreePath?: string; branch?: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  startPlan: (id: string) =>
    http<{ runId: string; role: string; startedAt: string }>(`/api/runs/${id}/plan`, { method: 'POST' }),

  startNext: (id: string) =>
    http<{ runId: string; role: string; startedAt: string }>(`/api/runs/${id}/next`, { method: 'POST' }),

  startAuto: (id: string) =>
    http<{ runId: string; role: string; startedAt: string }>(`/api/runs/${id}/auto`, { method: 'POST' }),

  abort: (id: string) => http<{ ok: boolean }>(`/api/runs/${id}/abort`, { method: 'POST' }),

  savePlan: (id: string, planMd: string) =>
    http<{ ok: boolean; sprints: number }>(`/api/runs/${id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ planMd })
    }),

  saveContract: (id: string, sprint: string, contractMd: string) =>
    http<{ ok: boolean }>(`/api/runs/${id}/sprints/${sprint}/contract`, {
      method: 'PUT',
      body: JSON.stringify({ contractMd })
    }),

  getTranscript: (id: string, log: string) =>
    http<{ lines: TranscriptMessage[]; raw: string }>(`/api/runs/${id}/transcripts/${log}`),

  getCost: (id: string) => http<RunCostSummary>(`/api/runs/${id}/cost`),

  getPrompts: () => http<Record<PromptName, string>>('/api/prompts'),

  savePrompt: (name: PromptName, content: string) =>
    http<{ ok: boolean }>(`/api/prompts/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    })
};

export type TranscriptMessage =
  | { type: 'system'; subtype?: string; [k: string]: unknown }
  | {
      type: 'assistant';
      message?: { content?: Array<{ type: string; text?: string; input?: unknown; name?: string }> };
      [k: string]: unknown;
    }
  | {
      type: 'user';
      message?: { content?: Array<{ type: string; text?: string; tool_use_id?: string; content?: unknown }> };
      [k: string]: unknown;
    }
  | { type: 'result'; subtype?: string; result?: unknown; total_cost_usd?: number; [k: string]: unknown }
  | { type: 'raw'; text: string };

export type ServerEvent =
  | { type: 'hello'; serverVersion: string }
  | { type: 'run_state'; runId: string; state: RunState }
  | { type: 'run_created'; runId: string; state: RunState }
  | { type: 'plan'; runId: string; planMd: string }
  | { type: 'contract'; runId: string; sprint: string; contractMd: string }
  | { type: 'output'; runId: string; sprint: string; outputMd: string }
  | { type: 'verdict'; runId: string; sprint: string; verdictMd: string }
  | { type: 'transcript_append'; runId: string; logName: string; lines: TranscriptMessage[] }
  | { type: 'transcript_reset'; runId: string; logName: string }
  | {
      type: 'dispatch';
      runId: string;
      role: 'planner' | 'next';
      status: 'started' | 'finished' | 'error';
      error?: string;
    }
  | { type: 'cost'; runId: string; perRole: Record<string, number>; total: number };

export function openEventStream(onEvent: (event: ServerEvent) => void, filterRunId?: string): EventSource {
  const url = filterRunId ? `/api/events?run=${encodeURIComponent(filterRunId)}` : '/api/events';
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as ServerEvent;
      onEvent(parsed);
    } catch {
      /* ignore malformed */
    }
  };
  return es;
}
