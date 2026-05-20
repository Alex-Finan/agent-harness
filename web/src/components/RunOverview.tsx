import type { RunState } from '../api';
import { formatCost, formatRelative } from '../lib/format';

export function RunOverview({
  runs,
  onSelect
}: {
  runs: RunState[];
  onSelect: (id: string) => void;
}) {
  const active = runs.filter((r) => r.status === 'in_progress');
  const halted = runs.filter((r) => r.status === 'halted');
  const completed = runs.filter((r) => r.status === 'completed');

  const tableRuns = runs.filter(
    (r) => r.status === 'in_progress' || r.status === 'halted'
  );

  return (
    <div className="m-6 space-y-6">
      {/* Summary stat chips */}
      <div className="flex flex-wrap gap-3">
        <StatChip label="active" count={active.length} color="emerald" />
        <StatChip label="halted" count={halted.length} color="rose" />
        <StatChip label="completed" count={completed.length} color="slate" />
      </div>

      {/* Active + halted runs table */}
      {tableRuns.length === 0 ? (
        <div className="rounded border border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
          No active runs. Click &quot;+ New run&quot; to create one.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Sprint</th>
                <th className="px-4 py-2 font-medium">Cost</th>
                <th className="px-4 py-2 font-medium">Next role</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tableRuns.map((r) => (
                <RunOverviewRow key={r.run_id} run={r} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  count,
  color
}: {
  label: string;
  count: number;
  color: 'emerald' | 'rose' | 'slate';
}) {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-700/50 bg-emerald-900/30 text-emerald-300',
    rose: 'border-rose-700/50 bg-rose-900/30 text-rose-300',
    slate: 'border-slate-700 bg-slate-800/60 text-slate-300'
  };

  return (
    <div className={`rounded border px-3 py-2 ${colorMap[color]}`}>
      <span className="text-2xl font-bold leading-none">{count}</span>
      <span className="ml-2 text-xs font-medium opacity-80">{label}</span>
    </div>
  );
}

function RunOverviewRow({
  run: r,
  onSelect
}: {
  run: RunState;
  onSelect: (id: string) => void;
}) {
  const isHalted = r.status === 'halted';
  const isIdle =
    r.status === 'in_progress' && r.next_role !== 'done' && !r.dispatching;

  return (
    <tr
      className={`cursor-pointer transition hover:bg-slate-800/40 ${isHalted ? 'bg-rose-950/20' : ''}`}
      onClick={() => onSelect(r.run_id)}
    >
      <td className="max-w-[280px] px-4 py-2.5">
        <div className="flex items-center gap-2">
          {isHalted && (
            <span className="animate-pulse rounded border border-red-700 bg-red-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
              FAIL
            </span>
          )}
          {isIdle && (
            <span className="rounded border border-yellow-700 bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-400">
              needs action
            </span>
          )}
        </div>
        <div
          className="truncate font-medium text-slate-100"
          title={r.task_summary}
        >
          {r.task_summary || '(no task summary)'}
        </div>
        <div className="font-mono text-[10px] text-slate-600 truncate" title={r.run_id}>
          {r.run_id}
        </div>
      </td>
      <td className="px-4 py-2.5 text-slate-300">
        {r.current_sprint}/{r.total_sprints || '?'}
      </td>
      <td className="px-4 py-2.5 font-mono text-emerald-400 text-xs">
        {formatCost(r.cost_total_usd)}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            r.dispatching
              ? 'bg-amber-900/40 text-amber-300 animate-pulse'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          {r.dispatching ? `${r.dispatching}…` : r.next_role}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-500">
        {formatRelative(r.updated_at)}
      </td>
    </tr>
  );
}
