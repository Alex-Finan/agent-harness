import type { RunState } from '../api';
import { StatusBadge } from './StatusBadge';
import { formatCost, formatRelative } from '../lib/format';

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
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">runs</div>
          <div className="text-xs text-slate-500">{runs.length} total</div>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          + New run
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {runs.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">
            No runs yet. Click "+ New run" to create one.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {runs.map((r) => {
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
