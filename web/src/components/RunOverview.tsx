import type { RunState } from '../api';
import { formatCost, formatRelative } from '../lib/format';
import { SprintPips } from './SprintPips';
import { RunStatusChip, computeChipState, type ChipState } from './RunStatusChip';

/**
 * Multi-run dashboard, shown in the main pane when no run is selected.
 * Designed for the side-monitor use case: glance at the page and answer
 * "what is every agent doing, where is it stuck, what's done."
 *
 * Layout: a grid of run tiles, grouped by activity. Halted/idle first
 * (they need the operator), live runs second, finished last.
 */
export function RunOverview({
  runs,
  onSelect
}: {
  runs: RunState[];
  onSelect: (id: string) => void;
}) {
  // Order runs so the things that need attention show up first.
  const ordered = [...runs].sort((a, b) => bucketWeight(a) - bucketWeight(b));

  const halted = ordered.filter((r) => r.status === 'halted');
  const idle = ordered.filter(
    (r) => r.status === 'in_progress' && r.next_role !== 'done' && !r.dispatching
  );
  const live = ordered.filter((r) => r.status === 'in_progress' && r.dispatching);
  const done = ordered.filter((r) => r.status === 'completed' || r.next_role === 'done');
  const aborted = ordered.filter((r) => r.status === 'aborted');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-blue-950">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          {runs.length === 0
            ? 'No runs yet. Click + New in the sidebar to start one.'
            : `Tracking ${runs.length} run${runs.length === 1 ? '' : 's'} across this harness.`}
        </p>
      </header>

      {runs.length === 0 ? null : (
        <>
          <Section title="Needs you" runs={byRecency([...halted, ...idle])} onSelect={onSelect} emptyHint="Nothing waiting on you." />
          <Section title="Live" runs={byRecency(live)} onSelect={onSelect} />
          <Section title="Done" runs={byRecency(done)} onSelect={onSelect} />
          {aborted.length > 0 ? (
            <Section title="Aborted" runs={byRecency(aborted)} onSelect={onSelect} muted />
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}

function bucketWeight(r: RunState): number {
  if (r.status === 'halted') return 0;
  if (r.status === 'in_progress' && !r.dispatching && r.next_role !== 'done') return 1;
  if (r.status === 'in_progress' && r.dispatching) return 2;
  if (r.status === 'completed' || r.next_role === 'done') return 3;
  return 4;
}

/** Most-recently-updated runs first — typical "what's hot right now" ordering. */
function byRecency(runs: RunState[]): RunState[] {
  return [...runs].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function Section({
  title,
  runs,
  onSelect,
  emptyHint,
  muted
}: {
  title: string;
  runs: RunState[];
  onSelect: (id: string) => void;
  /** When provided, renders a short empty-state message instead of a one-line collapsed header. */
  emptyHint?: string;
  muted?: boolean;
}) {
  // Collapsed empty state — single muted heading, no panel.
  if (runs.length === 0) {
    if (!emptyHint) {
      return (
        <h2 className="text-xs font-semibold uppercase tracking-wide text-blue-900/40">
          {title} <span className="font-normal text-blue-900/30">· 0</span>
        </h2>
      );
    }
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-800">
          {title} <span className="font-normal text-blue-700/60">· 0</span>
        </h2>
        <div className="rounded-md border border-slate-200 bg-white/30 px-4 py-3 text-sm text-slate-500">
          {emptyHint}
        </div>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-800">
        {title} <span className="font-normal text-blue-700/60">· {runs.length}</span>
      </h2>
      <div className={`grid gap-3 ${muted ? 'opacity-70' : ''} sm:grid-cols-2 xl:grid-cols-3`}>
        {runs.map((r) => (
          <RunTile key={r.run_id} run={r} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

const TILE_BORDER: Record<ChipState, string> = {
  running: 'border-amber-300 hover:border-amber-400',
  idle: 'border-yellow-300 hover:border-yellow-600/60',
  halted: 'border-rose-300 hover:border-rose-600/70',
  completed: 'border-emerald-300 hover:border-emerald-300',
  aborted: 'border-slate-300 hover:border-slate-400'
};

function RunTile({ run: r, onSelect }: { run: RunState; onSelect: (id: string) => void }) {
  const chip = computeChipState({
    status: r.status,
    nextRole: r.next_role,
    dispatchingActive: !!r.dispatching
  });
  const totalSprints = Math.max(r.total_sprints, r.sprint_pips?.length ?? 0);
  const completedSprints = r.sprint_pips?.filter((p) => p.verdict === 'PASS').length ?? 0;

  return (
    <button
      className={`flex flex-col gap-3 rounded-lg border bg-white/40 p-4 text-left transition hover:bg-white/70 ${TILE_BORDER[chip]}`}
      onClick={() => onSelect(r.run_id)}
      title={r.run_id}
    >
      <div className="flex items-start justify-between gap-2">
        <RunStatusChip
          state={chip}
          detail={chip === 'completed' || chip === 'aborted' ? undefined : `${r.dispatching ?? r.next_role}`}
        />
        <span className="shrink-0 text-[11px] text-slate-500">{formatRelative(r.updated_at)}</span>
      </div>

      <div className="min-w-0">
        <div className="line-clamp-2 text-sm font-medium text-slate-900">
          {r.task_summary || '(no task summary)'}
        </div>
        {r.branch ? (
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
            ⎇ {r.branch}
          </div>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-2 pt-1">
        <div className="flex flex-col gap-1">
          <SprintPips
            pips={r.sprint_pips ?? []}
            totalSprints={totalSprints}
            currentSprint={r.current_sprint}
            nextRole={r.next_role}
            dispatching={!!r.dispatching}
          />
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {totalSprints > 0
              ? `${completedSprints}/${totalSprints} sprint${totalSprints === 1 ? '' : 's'} passed`
              : 'planning'}
          </span>
        </div>
        {r.cost_total_usd && r.cost_total_usd > 0 ? (
          <span className="text-xs tabular-nums text-emerald-600/80">
            {formatCost(r.cost_total_usd)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

