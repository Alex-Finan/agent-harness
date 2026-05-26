import type { RunState, SprintPip } from '../api';
import {
  computeEvalPhase,
  computeExecPhase,
  computePlannerPhase,
  PIP_PHASE_CLASS,
  PIP_PHASE_LABEL,
  type PipPhase
} from './SprintPips';

/**
 * Detail-view progress visualisation: a horizontal "rail" with one numbered
 * node per sprint, each carrying an execution dot above and an evaluation dot
 * below. Bigger than the sidebar pips and connected by a visible line so
 * progress along the path is obvious at a glance.
 */

type Dispatch = RunState['dispatching'];

const NODE_BASE =
  'flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold leading-none';

/**
 * Aggregate per-sprint phase used for the central numbered node and the rail
 * segment leading into it. PASS/FAIL win; running/contract/pending fall back
 * to the underlying exec/eval state.
 */
function nodePhase(exec: PipPhase, evalPhase: PipPhase): PipPhase {
  if (evalPhase === 'pass') return 'pass';
  if (evalPhase === 'fail') return 'fail';
  if (exec === 'running' || evalPhase === 'running') return 'running';
  if (exec === 'done') return 'done';
  if (exec === 'contract') return 'contract';
  return 'pending';
}

function nodeClass(phase: PipPhase): string {
  switch (phase) {
    case 'pass':
      return `${NODE_BASE} border-emerald-500 bg-emerald-500 text-white`;
    case 'fail':
      return `${NODE_BASE} border-rose-500 bg-rose-500 text-white`;
    case 'running':
      return `${NODE_BASE} border-amber-400 bg-amber-400 text-white ring-2 ring-amber-200 animate-pulse`;
    case 'done':
      return `${NODE_BASE} border-slate-500 bg-slate-500 text-white`;
    case 'contract':
      return `${NODE_BASE} border-indigo-400 bg-white text-indigo-600`;
    case 'pending':
    default:
      return `${NODE_BASE} border-slate-300 bg-white text-slate-400`;
  }
}

function railClass(phase: PipPhase): string {
  switch (phase) {
    case 'pass':
      return 'bg-emerald-400';
    case 'fail':
      return 'bg-rose-400';
    case 'running':
      return 'bg-gradient-to-r from-emerald-400 to-amber-300';
    case 'done':
      return 'bg-slate-400';
    case 'contract':
      return 'bg-indigo-300';
    case 'pending':
    default:
      return 'bg-slate-200';
  }
}

function nodeGlyph(phase: PipPhase, n: number): string {
  if (phase === 'pass') return '✓';
  if (phase === 'fail') return '✗';
  return String(n);
}

/**
 * Labelled execution / evaluation indicator. `E` = executor turn, `V` =
 * verdict (evaluator). The letter inside makes the role obvious without
 * hovering for a tooltip; the surrounding color carries the phase.
 *
 * Background-color comes from PIP_PHASE_CLASS; we add a contrasting text
 * color so the letter remains readable on both filled and pending states.
 */
function rolePipTextClass(phase: PipPhase): string {
  switch (phase) {
    case 'pass':
    case 'fail':
    case 'done':
    case 'running':
      return 'text-white';
    case 'contract':
      return 'text-white';
    case 'pending':
    default:
      return 'text-slate-500';
  }
}

function RolePip({
  letter,
  phase,
  ariaLabel
}: {
  letter: 'E' | 'V';
  phase: PipPhase;
  ariaLabel: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none ${PIP_PHASE_CLASS[phase]} ${rolePipTextClass(phase)}`}
    >
      {letter}
    </span>
  );
}

export function SprintPath({
  pips,
  totalSprints,
  currentSprint,
  nextRole,
  dispatching = null
}: {
  pips: SprintPip[];
  totalSprints: number;
  currentSprint: number;
  nextRole: RunState['next_role'];
  dispatching?: Dispatch;
}) {
  const total = Math.max(totalSprints, pips.length);
  const plannerPhase = computePlannerPhase(pips, dispatching, nextRole);
  const inPlanning = total === 0 || nextRole === 'planner';

  // Planner pill — always present on the left of the path. Reads as the entry
  // node into the rail. Reserved spacers below the pill keep it aligned with
  // the per-sprint columns (which have exec on top + node + eval on bottom).
  const plannerNode = (
    <div className="flex flex-col items-center gap-1">
      <span className="h-4 w-4 opacity-0" aria-hidden />
      <span
        title={`Planner: ${PIP_PHASE_LABEL[plannerPhase]}`}
        aria-label={`planner ${PIP_PHASE_LABEL[plannerPhase]}`}
        className={`${nodeClass(plannerPhase)} px-1 text-[9px] uppercase tracking-wide`}
        style={{ width: 'auto', minWidth: '2.5rem' }}
      >
        plan
      </span>
      <span className="h-4 w-4 opacity-0" aria-hidden />
    </div>
  );

  if (inPlanning) {
    // No sprint structure yet — show just the planner pill so the strip still
    // sits in its slot without collapsing the row.
    return <div className="flex items-center">{plannerNode}</div>;
  }

  const pipsByNum = new Map(pips.map((p) => [p.num, p]));
  const segments: JSX.Element[] = [];

  // Rail segment from planner → sprint 1. Fixed-width so the whole path packs
  // to the left side of the card rather than stretching to fill it.
  segments.push(
    <span
      key="rail-0"
      className={`h-0.5 w-4 shrink-0 self-center ${railClass(plannerPhase)}`}
      aria-hidden
    />
  );

  for (let n = 1; n <= total; n++) {
    const pip = pipsByNum.get(n);
    const isCurrent = n === currentSprint && nextRole !== 'done';
    const exec = computeExecPhase(pip, isCurrent, dispatching, nextRole);
    const evalPhase = computeEvalPhase(pip, isCurrent, dispatching, nextRole);
    const node = nodePhase(exec, evalPhase);
    const tip = `Sprint ${n}: exec ${PIP_PHASE_LABEL[exec]} · eval ${PIP_PHASE_LABEL[evalPhase]}`;

    segments.push(
      <div
        key={`sprint-${n}`}
        className="flex shrink-0 flex-col items-center gap-1"
        title={tip}
      >
        <RolePip
          letter="E"
          phase={exec}
          ariaLabel={`sprint ${n} execution ${PIP_PHASE_LABEL[exec]}`}
        />
        <span className={nodeClass(node)} aria-label={`sprint ${n} ${PIP_PHASE_LABEL[node]}`}>
          {nodeGlyph(node, n)}
        </span>
        <RolePip
          letter="V"
          phase={evalPhase}
          ariaLabel={`sprint ${n} evaluation ${PIP_PHASE_LABEL[evalPhase]}`}
        />
      </div>
    );

    if (n < total) {
      // Rail between sprint N and N+1 picks up the colour of the sprint it's
      // leaving — green once a sprint has passed, etc.
      segments.push(
        <span
          key={`rail-${n}`}
          className={`h-0.5 w-4 shrink-0 self-center ${railClass(node)}`}
          aria-hidden
        />
      );
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0">{plannerNode}</span>
      {segments}
    </div>
  );
}
