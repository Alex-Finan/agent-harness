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

function RunRow({
  r,
  selected,
  onSelect
}: {
  r: RunState;
  selected: boolean;
  onSelect: () => void;
}) {
  const isIdle =
    r.status === 'in_progress' &&
    r.next_role !== 'done' &&
    !r.dispatching;

  return (
    <li
      className={`cursor-pointer px-4 py-3 transition ${selected ? 'bg-slate-800/60' : 'hover:bg-slate-900'}`}
      onClick={onSelect}
    >
      <div className="mb-1 flex items-center gap-2">
        <StatusBadge status={r.status} />
        {r.status === 'halted' && (
          <span className="animate-pulse rounded border border-red-700 bg-red-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
            FAIL
          </span>
        )}
        {r.dispatching ? (
          <span className="badge badge-running animate-pulse">{r.dispatching}…</span>
        ) : null}
        {isIdle && (
          <span className="rounded border border-yellow-700 bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-400">
            needs action
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">{formatCost(r.cost_total_usd)}</span>
      </div>
      <div className="truncate text-sm font-medium text-slate-100" title={r.task_summary}>
        {r.task_summary || '(no task summary)'}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          sprint {r.current_sprint}/{r.total_sprints || '?'}
        </span>
        <span>·</span>
        <span>{r.next_role}</span>
        <span>·</span>
        <span>{formatRelative(r.updated_at)}</span>
        {r.base_branch && (
          <>
            <span>·</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              ⎇ {r.base_branch}
            </span>
          </>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-slate-600" title={r.run_id}>
        {r.run_id}
      </div>
    </li>
  );
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

  // Group visibleRuns by base_branch. Runs without base_branch go into the
  // ungrouped bucket and are rendered with no section header.
  const groupMap = new Map<string, RunState[]>();
  const ungrouped: RunState[] = [];

  for (const r of visibleRuns) {
    if (r.base_branch) {
      if (!groupMap.has(r.base_branch)) {
        groupMap.set(r.base_branch, []);
      }
      groupMap.get(r.base_branch)!.push(r);
    } else {
      ungrouped.push(r);
    }
  }

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
          <div>
            {/* Named groups — each gets a subtle section header */}
            {Array.from(groupMap.entries()).map(([branch, groupRuns]) => (
              <div key={branch}>
                <header className="border-b border-t border-slate-800 bg-slate-900/60 px-4 py-1.5 text-[10px] font-semibold text-slate-400">
                  ⎇ {branch}
                </header>
                <ul className="divide-y divide-slate-800">
                  {groupRuns.map((r) => (
                    <RunRow
                      key={r.run_id}
                      r={r}
                      selected={r.run_id === selectedId}
                      onSelect={() => onSelect(r.run_id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {/* Ungrouped runs — no section header */}
            {ungrouped.length > 0 && (
              <ul className="divide-y divide-slate-800">
                {ungrouped.map((r) => (
                  <RunRow
                    key={r.run_id}
                    r={r}
                    selected={r.run_id === selectedId}
                    onSelect={() => onSelect(r.run_id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
