import { useEffect, useState } from 'react';
import type { RunState } from '../api';
import { StatusBadge } from './StatusBadge';
import { formatCost, formatRelative } from '../lib/format';

const FILTER_STORAGE_KEY = 'harness:runlist:filters';

interface Filters {
  showCompleted: boolean;
  showAborted: boolean;
}

const DEFAULT_FILTERS: Filters = {
  // Hide terminal-state runs by default — the sidebar is for live work.
  showCompleted: false,
  showAborted: false
};

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw);
    return {
      showCompleted: Boolean(parsed.showCompleted),
      showAborted: Boolean(parsed.showAborted)
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function RunList({
  runs,
  selectedId,
  onSelect,
  onNew
}: {
  runs: RunState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(loadFilters);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* localStorage may be unavailable (private mode); ignore */
    }
  }, [filters]);

  const visibleRuns = runs.filter((r) => {
    if (r.status === 'completed' && !filters.showCompleted) return false;
    if (r.status === 'aborted' && !filters.showAborted) return false;
    return true;
  });

  const hiddenCount = runs.length - visibleRuns.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">runs</div>
          <div className="text-xs text-slate-500">
            {visibleRuns.length} of {runs.length}
            {hiddenCount > 0 ? <span className="text-slate-600"> · {hiddenCount} hidden</span> : null}
          </div>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          + New run
        </button>
      </div>
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
        <label className="flex cursor-pointer items-center gap-1.5 hover:text-slate-200">
          <input
            type="checkbox"
            className="h-3 w-3 cursor-pointer accent-emerald-500"
            checked={filters.showCompleted}
            onChange={(e) => setFilters((f) => ({ ...f, showCompleted: e.target.checked }))}
          />
          <span>completed</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 hover:text-slate-200">
          <input
            type="checkbox"
            className="h-3 w-3 cursor-pointer accent-emerald-500"
            checked={filters.showAborted}
            onChange={(e) => setFilters((f) => ({ ...f, showAborted: e.target.checked }))}
          />
          <span>aborted</span>
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visibleRuns.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">
            {runs.length === 0
              ? 'No runs yet. Click "+ New run" to create one.'
              : `All ${runs.length} runs are hidden by filters.`}
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {visibleRuns.map((r) => {
              const selected = r.run_id === selectedId;
              return (
                <li
                  key={r.run_id}
                  className={`cursor-pointer px-4 py-3 transition ${selected ? 'bg-slate-800/60' : 'hover:bg-slate-900'}`}
                  onClick={() => onSelect(r.run_id)}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    {r.dispatching ? (
                      <span className="badge badge-running animate-pulse">{r.dispatching}…</span>
                    ) : null}
                    <span className="ml-auto text-xs text-slate-500">{formatCost(r.cost_total_usd)}</span>
                  </div>
                  <div className="truncate text-sm font-medium text-slate-100" title={r.task_summary}>
                    {r.task_summary || '(no task summary)'}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>
                      sprint {r.current_sprint}/{r.total_sprints || '?'}
                    </span>
                    <span>·</span>
                    <span>{r.next_role}</span>
                    <span>·</span>
                    <span>{formatRelative(r.updated_at)}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-600" title={r.run_id}>
                    {r.run_id}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
