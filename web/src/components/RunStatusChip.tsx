import type { RunState } from '../api';

/**
 * One chip that combines run status + dispatching state + last verdict into a
 * single visually-loud indicator. Replaces the old stack of
 *   [in progress] [planner...] [last_verdict] [operator action needed]
 * which gave too many co-equal signals and made operators read several pills
 * to answer the dominant question: "is the agent doing something right now,
 * or is it waiting on me?"
 */

export type ChipState = 'running' | 'idle' | 'halted' | 'completed' | 'aborted';

export function computeChipState(args: {
  status: RunState['status'];
  nextRole: RunState['next_role'];
  dispatchingActive: boolean;
}): ChipState {
  if (args.status === 'halted') return 'halted';
  if (args.status === 'completed') return 'completed';
  if (args.status === 'aborted') return 'aborted';
  if (args.dispatchingActive) return 'running';
  if (args.nextRole === 'done') return 'completed';
  return 'idle';
}

const CHIP_LABEL: Record<ChipState, string> = {
  running: 'Running',
  idle: 'Waiting on you',
  halted: 'Halted · failed',
  completed: 'Done',
  aborted: 'Aborted'
};

const CHIP_CLASS: Record<ChipState, string> = {
  running:
    'border-amber-500 bg-amber-100 text-amber-800 ring-1 ring-amber-300',
  idle:
    'border-yellow-500 bg-yellow-50 text-yellow-800 ring-1 ring-yellow-300',
  halted:
    'border-rose-400 bg-rose-100 text-rose-800 ring-1 ring-rose-300',
  completed:
    'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300',
  aborted: 'border-slate-400 bg-slate-100 text-slate-700'
};

const CHIP_DOT_CLASS: Record<ChipState, string> = {
  running: 'bg-amber-300 animate-pulse',
  idle: 'bg-yellow-300',
  halted: 'bg-rose-400',
  completed: 'bg-emerald-400',
  aborted: 'bg-slate-400'
};

export function RunStatusChip({
  state,
  detail
}: {
  state: ChipState;
  /** Optional secondary line shown to the right of the chip (e.g. "executor · sprint 3/5") */
  detail?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${CHIP_CLASS[state]}`}
      >
        <span className={`h-2 w-2 rounded-full ${CHIP_DOT_CLASS[state]}`} aria-hidden />
        {CHIP_LABEL[state]}
      </span>
      {detail ? <span className="text-xs text-slate-600">{detail}</span> : null}
    </div>
  );
}
