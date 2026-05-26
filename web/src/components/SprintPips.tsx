import type { RunState, SprintPip } from '../api';
import { formatDuration, formatRelative } from '../lib/format';

/**
 * Compact progress glyph: a single planner bubble followed by one column per
 * sprint with execution stacked on top of evaluation. Lets an operator scan
 * planner status + per-sprint exec/eval state in a single glance.
 */

export type PipPhase =
  | 'pass'
  | 'fail'
  | 'running'
  | 'done'
  | 'contract'
  | 'pending';

const PHASE_CLASS: Record<PipPhase, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-rose-500',
  running: 'bg-amber-400 animate-pulse ring-1 ring-amber-300',
  done: 'bg-slate-500',
  contract: 'bg-indigo-500/70',
  pending: 'bg-slate-200'
};

const PHASE_LABEL: Record<PipPhase, string> = {
  pass: 'passed',
  fail: 'failed',
  running: 'running',
  done: 'done',
  contract: 'ready',
  pending: 'pending'
};

type Dispatch = RunState['dispatching'];

export function computeExecPhase(
  pip: SprintPip | undefined,
  isCurrent: boolean,
  dispatching: Dispatch,
  nextRole: RunState['next_role']
): PipPhase {
  if (!pip) return 'pending';
  if (pip.hasOutput) return 'done';
  if (isCurrent && dispatching === 'next' && nextRole === 'executor') return 'running';
  if (pip.hasContract) return 'contract';
  return 'pending';
}

export function computeEvalPhase(
  pip: SprintPip | undefined,
  isCurrent: boolean,
  dispatching: Dispatch,
  nextRole: RunState['next_role']
): PipPhase {
  if (!pip) return 'pending';
  if (pip.verdict === 'PASS') return 'pass';
  if (pip.verdict === 'FAIL') return 'fail';
  if (isCurrent && dispatching === 'next' && nextRole === 'evaluator') return 'running';
  return 'pending';
}

export function computePlannerPhase(
  pips: SprintPip[],
  dispatching: Dispatch,
  nextRole: RunState['next_role']
): PipPhase {
  if (dispatching === 'planner') return 'running';
  if (pips.some((p) => p.hasContract)) return 'done';
  if (nextRole === 'planner') return 'pending';
  return 'done';
}

export { PHASE_CLASS as PIP_PHASE_CLASS, PHASE_LABEL as PIP_PHASE_LABEL };

export function SprintPips({
  pips,
  totalSprints,
  currentSprint,
  nextRole,
  dispatching = null,
  variant = 'full'
}: {
  pips: SprintPip[];
  totalSprints: number;
  currentSprint: number;
  nextRole: RunState['next_role'];
  dispatching?: Dispatch;
  /**
   * 'full' renders the planner bubble + one column per sprint (used in
   * dashboards/progress bars). 'compact' renders only what's in-flight right
   * now — the planner dot during planning, otherwise just the current sprint
   * column — with larger bubbles so it reads well in the run sidebar.
   */
  variant?: 'compact' | 'full';
}) {
  const isCompact = variant === 'compact';
  const dotCls = isCompact ? 'h-2.5 w-2.5' : 'h-2 w-2';
  const colGap = isCompact ? 'gap-1' : 'gap-0.5';

  const total = Math.max(totalSprints, pips.length);
  const plannerPhase = computePlannerPhase(pips, dispatching, nextRole);
  const plannerDot = (
    <span
      title={`Planner: ${PHASE_LABEL[plannerPhase]}`}
      aria-label={`planner ${PHASE_LABEL[plannerPhase]}`}
      className={`${dotCls} shrink-0 rounded-full ${PHASE_CLASS[plannerPhase]}`}
    />
  );

  // Planning phase: no sprint structure yet, or planner is the active role.
  // Show just the planner bubble — there's nothing else in flight to convey.
  const inPlanning = total === 0 || nextRole === 'planner';
  if (inPlanning) {
    return <span className="inline-flex items-center">{plannerDot}</span>;
  }

  const pipsByNum = new Map(pips.map((p) => [p.num, p]));

  function renderCol(n: number) {
    const pip = pipsByNum.get(n);
    const isCurrent = n === currentSprint && nextRole !== 'done';
    const execPhase = computeExecPhase(pip, isCurrent, dispatching, nextRole);
    const evalPhase = computeEvalPhase(pip, isCurrent, dispatching, nextRole);
    return (
      <span key={n} className={`inline-flex flex-col ${colGap}`}>
        <span
          title={tooltip(n, 'execution', execPhase, pip)}
          aria-label={`sprint ${n} execution ${PHASE_LABEL[execPhase]}`}
          className={`${dotCls} shrink-0 rounded-full ${PHASE_CLASS[execPhase]}`}
        />
        <span
          title={tooltip(n, 'evaluation', evalPhase, pip)}
          aria-label={`sprint ${n} evaluation ${PHASE_LABEL[evalPhase]}`}
          className={`${dotCls} shrink-0 rounded-full ${PHASE_CLASS[evalPhase]}`}
        />
      </span>
    );
  }

  if (isCompact) {
    // Focus on the in-flight sprint (or the final sprint when done) and skip
    // the planner — its bubble dominates only while planning is active.
    const focusNum =
      nextRole === 'done'
        ? Math.min(Math.max(currentSprint, 1), total)
        : Math.min(Math.max(currentSprint, 1), total);
    return <span className="inline-flex items-center">{renderCol(focusNum)}</span>;
  }

  const cols: JSX.Element[] = [];
  for (let n = 1; n <= total; n++) cols.push(renderCol(n));

  return (
    <span className="inline-flex items-center gap-1.5">
      {plannerDot}
      <span className="inline-flex items-center gap-1">{cols}</span>
    </span>
  );
}

function tooltip(
  n: number,
  role: 'execution' | 'evaluation',
  phase: PipPhase,
  pip: SprintPip | undefined
): string {
  const base = `Sprint ${n} ${role}: ${PHASE_LABEL[phase]}`;
  if (!pip) return base;
  const parts: string[] = [base];
  const endAt =
    role === 'evaluation'
      ? pip.verdictAt
      : pip.outputAt ?? pip.contractAt;
  if (endAt) parts.push(formatRelative(endAt));
  const startMs = pip.contractAt ? Date.parse(pip.contractAt) : null;
  const endMs =
    role === 'evaluation'
      ? pip.verdictAt
        ? Date.parse(pip.verdictAt)
        : null
      : pip.outputAt
        ? Date.parse(pip.outputAt)
        : null;
  if (startMs !== null && endMs !== null && endMs > startMs) {
    parts.push(`took ${formatDuration(endMs - startMs)}`);
  } else if (phase === 'running' && startMs !== null) {
    parts.push(`running ${formatDuration(Date.now() - startMs)}+`);
  }
  return parts.join(' · ');
}
