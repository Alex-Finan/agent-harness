import type { RunState, SprintPip } from '../api';
import { formatDuration, formatRelative } from '../lib/format';

/**
 * Compact horizontal strip of dots — one per sprint — that shows phase status
 * at a glance: PASS / FAIL / running / contract-ready / pending. Used in the
 * sidebar so an operator can scan run progress without clicking through.
 */

type PipPhase = 'pass' | 'fail' | 'running' | 'output' | 'contract' | 'pending';

function computePhase(
  pip: SprintPip,
  currentSprint: number,
  nextRole: RunState['next_role'],
  dispatching: boolean
): PipPhase {
  if (pip.verdict === 'PASS') return 'pass';
  if (pip.verdict === 'FAIL') return 'fail';
  const isCurrent = pip.num === currentSprint && nextRole !== 'done';
  if (isCurrent && dispatching) return 'running';
  if (pip.hasOutput) return 'output';
  if (pip.hasContract) return 'contract';
  return 'pending';
}

const PHASE_CLASS: Record<PipPhase, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-rose-500',
  running: 'bg-amber-400 animate-pulse ring-1 ring-amber-300',
  output: 'bg-amber-500/70',
  contract: 'bg-indigo-500/70',
  pending: 'bg-slate-200'
};

const PHASE_LABEL: Record<PipPhase, string> = {
  pass: 'passed',
  fail: 'failed',
  running: 'running',
  output: 'output ready',
  contract: 'contract ready',
  pending: 'pending'
};

export function SprintPips({
  pips,
  totalSprints,
  currentSprint,
  nextRole,
  dispatching = false
}: {
  pips: SprintPip[];
  totalSprints: number;
  currentSprint: number;
  nextRole: RunState['next_role'];
  dispatching?: boolean;
}) {
  // Always render exactly totalSprints pips so the strip's length communicates
  // "how big is this plan." If pips are missing (executor hasn't started a
  // sprint dir yet) fill with pending placeholders.
  const total = Math.max(totalSprints, pips.length);
  if (total === 0) {
    // Planning phase — no sprint structure yet. Show a thin dashed placeholder
    // so the row still has a sense of vertical rhythm.
    return (
      <span className="inline-flex items-center text-[10px] uppercase tracking-wide text-slate-600">
        planning
      </span>
    );
  }

  const pipsByNum = new Map(pips.map((p) => [p.num, p]));
  const cells: JSX.Element[] = [];
  for (let n = 1; n <= total; n++) {
    const pip = pipsByNum.get(n);
    const phase = pip
      ? computePhase(pip, currentSprint, nextRole, dispatching)
      : ('pending' as PipPhase);
    cells.push(
      <span
        key={n}
        title={tooltip(n, phase, pip)}
        className={`h-2 w-2 shrink-0 rounded-full ${PHASE_CLASS[phase]}`}
        aria-label={`sprint ${n} ${PHASE_LABEL[phase]}`}
      />
    );
  }
  return <span className="inline-flex items-center gap-1">{cells}</span>;
}

/**
 * Tooltip text combining phase + timing. Format:
 *   "Sprint 2: passed · 8m ago · took 4m"
 * Timing fields come from sprint_pips in the runs-list payload, which now
 * includes file mtimes for contract/output/verdict.
 */
function tooltip(n: number, phase: PipPhase, pip: SprintPip | undefined): string {
  const base = `Sprint ${n}: ${PHASE_LABEL[phase]}`;
  if (!pip) return base;
  const parts: string[] = [base];
  const lastAt = pip.verdictAt ?? pip.outputAt ?? pip.contractAt;
  if (lastAt) parts.push(formatRelative(lastAt));
  const startMs = pip.contractAt ? Date.parse(pip.contractAt) : null;
  const endMs = pip.verdictAt
    ? Date.parse(pip.verdictAt)
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
