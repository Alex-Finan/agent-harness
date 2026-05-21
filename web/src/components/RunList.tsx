import type { RunState } from '../api';
import { formatCost, formatRelative } from '../lib/format';
import { SprintPips } from './SprintPips';
import { computeChipState, type ChipState } from './RunStatusChip';

/**
 * Color of the left selection border when a row is active. Chip state colors
 * carry status; the selected border picks up the matching tone instead of
 * a separate status dot.
 */
const SELECTED_BORDER: Record<ChipState, string> = {
  running: 'border-amber-500',
  idle: 'border-yellow-500',
  halted: 'border-rose-500',
  completed: 'border-emerald-500',
  aborted: 'border-slate-400'
};

function RunRow({
  r,
  selected,
  onSelect
}: {
  r: RunState;
  selected: boolean;
  onSelect: () => void;
}) {
  const chip = computeChipState({
    status: r.status,
    nextRole: r.next_role,
    dispatchingActive: !!r.dispatching
  });
  const isLive = chip === 'running';
  const totalSprints = Math.max(r.total_sprints, r.sprint_pips?.length ?? 0);

  return (
    <li
      className={`group cursor-pointer border-l-[3px] px-3 py-2 transition ${
        selected
          ? 'border-blue-700 bg-blue-50/60'
          : 'border-transparent hover:bg-white'
      }`}
      onClick={onSelect}
      title={r.run_id}
    >
      {/* Row 1: task summary + age. Status comes through the row's left
          border color and the pip strip in row 2 — no separate dot. */}
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900"
          title={r.task_summary}
        >
          {r.task_summary || '(no task summary)'}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
          {formatRelative(r.updated_at)}
        </span>
      </div>
      {/* Row 2: sprint pips + role label + branch + cost. The pip strip
          carries the count; no separate "3/5". */}
      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
        <SprintPips
          pips={r.sprint_pips ?? []}
          totalSprints={totalSprints}
          currentSprint={r.current_sprint}
          nextRole={r.next_role}
          dispatching={isLive}
        />
        <span className="truncate" title={`next: ${r.next_role}`}>
          {chip === 'halted'
            ? 'failed'
            : chip === 'completed'
              ? 'done'
              : chip === 'aborted'
                ? 'aborted'
                : isLive
                  ? `${r.dispatching}…`
                  : r.next_role}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {r.base_branch ? (
            <span
              className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-600"
              title={`base branch: ${r.base_branch}`}
            >
              ⎇ {r.base_branch}
            </span>
          ) : null}
          {r.cost_total_usd && r.cost_total_usd > 0 ? (
            <span className="tabular-nums text-emerald-600/80">
              {formatCost(r.cost_total_usd)}
            </span>
          ) : null}
        </span>
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
  // Sidebar is for active work only — completed and aborted runs are
  // surfaced on the dashboard, grouped by activity. Hiding them here keeps
  // the sidebar focused on what still needs attention.
  const activeRuns = runs.filter(
    (r) => r.status !== 'completed' && r.status !== 'aborted'
  );

  // Counts at top of sidebar — quick "what needs attention" summary.
  const liveCount = activeRuns.filter((r) => r.dispatching).length;
  const idleCount = activeRuns.filter(
    (r) => r.status === 'in_progress' && r.next_role !== 'done' && !r.dispatching
  ).length;
  const haltedCount = activeRuns.filter((r) => r.status === 'halted').length;

  // Group active runs by base_branch. Runs without base_branch go into the
  // ungrouped bucket and are rendered with no section header.
  const groupMap = new Map<string, RunState[]>();
  const ungrouped: RunState[] = [];

  for (const r of activeRuns) {
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
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase tracking-wide text-blue-900">Runs</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span>{activeRuns.length} active</span>
            {liveCount > 0 ? (
              <span className="text-amber-600">
                · <span className="font-semibold">{liveCount}</span> live
              </span>
            ) : null}
            {idleCount > 0 ? (
              <span className="text-yellow-700">
                · <span className="font-semibold">{idleCount}</span> waiting
              </span>
            ) : null}
            {haltedCount > 0 ? (
              <span className="text-rose-500">
                · <span className="font-semibold">{haltedCount}</span> halted
              </span>
            ) : null}
          </div>
        </div>
        <button className="btn btn-primary shrink-0" onClick={onNew}>
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeRuns.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">
            {runs.length === 0
              ? 'No runs yet. Click "+ New" to create one.'
              : 'No active runs. Open the dashboard to see completed and aborted runs.'}
          </div>
        ) : (
          <div>
            {/* Named groups — each gets a subtle section header */}
            {Array.from(groupMap.entries()).map(([branch, groupRuns]) => (
              <div key={branch}>
                <header className="border-b border-t border-blue-200/70 bg-blue-50/60 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-800">
                  ⎇ {branch}
                </header>
                <ul className="divide-y divide-slate-200/60">
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
              <ul className="divide-y divide-slate-200/60">
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
