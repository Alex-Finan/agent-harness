import type { RunState } from '../api';

const STATUS_CLASS: Record<RunState['status'], string> = {
  in_progress: 'badge-running',
  halted: 'badge-halted',
  completed: 'badge-completed',
  aborted: 'badge-aborted'
};

const STATUS_LABEL: Record<RunState['status'], string> = {
  in_progress: 'in progress',
  halted: 'halted',
  completed: 'completed',
  aborted: 'aborted'
};

export function StatusBadge({ status }: { status: RunState['status'] }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function VerdictBadge({ verdict }: { verdict: 'PASS' | 'FAIL' | null }) {
  if (verdict === null) return <span className="badge border border-slate-300 bg-slate-100 text-slate-600">—</span>;
  return <span className={`badge ${verdict === 'PASS' ? 'badge-pass' : 'badge-fail'}`}>{verdict}</span>;
}
