import type { RunDetail, RunState, SprintPip, SprintSnapshot } from '../api';
import { SprintPips } from './SprintPips';
import { RoleBadge } from './RoleBadge';
import { parsePlanSections } from '../lib/plan-diff';

/**
 * Best-effort: pull the sprint's plan-section title from plan.md for a
 * friendly status line ("Sprint 3 — tag transcript lines"). Falls back to
 * the sprint's dir slug if plan.md doesn't follow the `## Sprint N — title`
 * convention.
 */
interface StatusLine {
  text: string;
  showRoleBadge: boolean;
}

/**
 * Sprint count source of truth: `state.total_sprints` (parsed from plan.md by
 * the planner). Fall back to `sprints.length` only during the brief window
 * before plan.md exists / has been parsed, where total_sprints is still 0.
 * Never `Math.max` the two — orphan sprint dirs from prior plan revisions
 * would inflate the count.
 */
function resolveSprintCount(stateTotal: number, snapshotCount: number): number {
  return stateTotal > 0 ? stateTotal : snapshotCount;
}

function describeCurrent(detail: RunDetail): StatusLine {
  const { state, snapshot } = detail;
  const isDone = state.next_role === 'done' || state.status === 'completed';
  const total = resolveSprintCount(state.total_sprints, snapshot.sprints.length);

  if (isDone) {
    return {
      text:
        total === 1
          ? 'Sprint complete · ready to push'
          : `All ${total} sprints complete · ready to push`,
      showRoleBadge: false
    };
  }
  if (state.status === 'halted') {
    return { text: `Halted at sprint ${state.current_sprint} of ${total}`, showRoleBadge: true };
  }
  if (state.status === 'aborted') {
    return { text: 'Run aborted', showRoleBadge: false };
  }

  const num = state.current_sprint;
  const sprint = snapshot.sprints.find((s) => s.num === num);
  let title: string | null = null;
  if (snapshot.planMd) {
    const sections = parsePlanSections(snapshot.planMd).sprints;
    title = sections.find((s) => s.num === num)?.title ?? null;
  }
  if (!title && sprint) {
    title = sprint.slug.replace(/-/g, ' ');
  }

  const verb = state.dispatching ? '⚡' : '▸';
  const text = title
    ? `${verb} Sprint ${num} of ${total} — ${title}`
    : `${verb} Sprint ${num} of ${total}`;
  return { text, showRoleBadge: true };
}

/**
 * Detail endpoints don't pre-compute sprint_pips (that's a runs-list field).
 * Build them from the full SprintSnapshot[] we already have in the detail
 * payload so the strip shows phase colors immediately.
 */
function pipsFromSprints(sprints: SprintSnapshot[]): SprintPip[] {
  return sprints.map((s) => ({
    num: s.num,
    verdict: s.verdict,
    hasContract: s.contractMd !== null,
    hasOutput: s.outputMd !== null,
    contractAt: s.contractAt,
    outputAt: s.outputAt,
    verdictAt: s.verdictAt
  }));
}

/**
 * Compact strip that sits above the plan/overview panel once the planner has
 * produced sprint contracts. Two layouts:
 *
 * - **Single-PR** runs: just the sprint pips for this run, no chrome.
 * - **Stacked** runs: each PR in the stack is a small segment showing its
 *   sprint pips (current PR fully detailed; other PRs use the runs-list
 *   `sprint_pips` snapshot so we don't have to fetch each follow-up
 *   separately). Unspawned entries show a single placeholder pip + label.
 *   Click a segment to jump to that run.
 *
 * Returns null when planning is still in progress (no contracts yet).
 */
export function RunProgressBar({
  detail,
  allRuns,
  onSelectRun
}: {
  detail: RunDetail;
  allRuns: RunState[];
  onSelectRun?: (id: string) => void;
}) {
  const sprints = detail.snapshot.sprints;
  const hasAnyContract = sprints.some((s) => s.contractMd !== null);
  if (!hasAnyContract) return null;

  const stack = detail.snapshot.stack;
  const isStacked = !!(stack && stack.ordered.length > 1);

  const livePips = pipsFromSprints(sprints);
  const liveTotal = resolveSprintCount(detail.state.total_sprints, sprints.length);
  const livePassed = livePips.filter((p) => p.verdict === 'PASS').length;

  const statusLine = describeCurrent(detail);

  if (!isStacked) {
    return (
      <div className="mb-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Progress
          </span>
          <SprintPips
            pips={livePips}
            totalSprints={liveTotal}
            currentSprint={detail.state.current_sprint}
            nextRole={detail.state.next_role}
            dispatching={!!detail.state.dispatching}
          />
          <span className="ml-auto text-[11px] tabular-nums text-slate-500">
            {livePassed}/{liveTotal} sprint{liveTotal === 1 ? '' : 's'} passed
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <span>{statusLine.text}</span>
          {statusLine.showRoleBadge ? (
            <RoleBadge
              nextRole={detail.state.next_role}
              dispatching={detail.state.dispatching ?? null}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Stack progress
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          PR {stack!.current_index + 1} of {stack!.ordered.length}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
        <span>{statusLine.text}</span>
        {statusLine.showRoleBadge ? (
          <RoleBadge
            nextRole={detail.state.next_role}
            dispatching={detail.state.dispatching ?? null}
          />
        ) : null}
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-1.5">
        {stack!.ordered.map((entry, i) => {
          const isCurrent = entry.runId === detail.state.run_id;
          const siblingState = entry.runId
            ? allRuns.find((r) => r.run_id === entry.runId) ?? null
            : null;
          return (
            <PrSegment
              key={i}
              index={i}
              label={`PR ${i + 1}`}
              branch={entry.branch}
              isCurrent={isCurrent}
              detail={isCurrent ? detail : null}
              sibling={siblingState}
              spawned={!!entry.runId}
              onSelect={() =>
                entry.runId && !isCurrent && onSelectRun
                  ? onSelectRun(entry.runId)
                  : undefined
              }
              isLast={i === stack!.ordered.length - 1}
            />
          );
        })}
      </ol>
    </div>
  );
}

function PrSegment({
  index,
  label,
  branch,
  isCurrent,
  detail,
  sibling,
  spawned,
  isLast,
  onSelect
}: {
  index: number;
  label: string;
  branch: string;
  isCurrent: boolean;
  detail: RunDetail | null;
  sibling: RunState | null;
  spawned: boolean;
  isLast: boolean;
  onSelect: () => void;
}) {
  // Decide what to render for the pip area inside this segment.
  let inner: React.ReactNode;
  if (isCurrent && detail) {
    const sprintsHere = detail.snapshot.sprints;
    const total = Math.max(
      resolveSprintCount(detail.state.total_sprints, sprintsHere.length),
      1
    );
    inner = (
      <SprintPips
        pips={pipsFromSprints(sprintsHere)}
        totalSprints={total}
        currentSprint={detail.state.current_sprint}
        nextRole={detail.state.next_role}
        dispatching={!!detail.state.dispatching}
      />
    );
  } else if (sibling) {
    const total = Math.max(
      resolveSprintCount(sibling.total_sprints, sibling.sprint_pips?.length ?? 0),
      1
    );
    inner = (
      <SprintPips
        pips={sibling.sprint_pips ?? []}
        totalSprints={total}
        currentSprint={sibling.current_sprint}
        nextRole={sibling.next_role}
        dispatching={!!sibling.dispatching}
      />
    );
  } else if (spawned) {
    // Spawned but we don't have its state cached yet — show a neutral dot.
    inner = <span className="h-2 w-2 rounded-full bg-slate-300" />;
  } else {
    inner = (
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        not spawned
      </span>
    );
  }

  return (
    <>
      <li>
        <button
          type="button"
          onClick={onSelect}
          disabled={isCurrent || !spawned}
          className={`flex items-center gap-1.5 rounded border px-2 py-1 text-left transition disabled:cursor-default ${
            isCurrent
              ? 'border-indigo-400 bg-indigo-50'
              : spawned
              ? 'border-slate-200 bg-white hover:bg-slate-50'
              : 'border-dashed border-slate-300 bg-white opacity-70'
          }`}
          title={branch}
        >
          <span
            className={`text-[10px] font-semibold ${
              isCurrent ? 'text-indigo-800' : 'text-slate-600'
            }`}
          >
            {label}
          </span>
          {inner}
        </button>
      </li>
      {!isLast ? <span className="text-slate-400">→</span> : null}
    </>
  );
}

