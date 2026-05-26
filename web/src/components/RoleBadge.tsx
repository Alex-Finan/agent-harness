import type { RunState } from '../api';

type ActiveRole = 'planner' | 'executor' | 'evaluator' | 'done';

function resolveActiveRole(
  nextRole: RunState['next_role'],
  dispatching: RunState['dispatching']
): ActiveRole {
  if (dispatching === 'planner') return 'planner';
  if (dispatching === 'next') {
    return nextRole === 'evaluator' ? 'evaluator' : 'executor';
  }
  if (nextRole === 'done') return 'done';
  return nextRole;
}

const ROLE_META: Record<
  ActiveRole,
  { label: string; classes: string; dotClasses: string }
> = {
  planner: {
    label: 'PLANNER',
    classes: 'border-indigo-300 bg-indigo-50 text-indigo-800',
    dotClasses: 'bg-indigo-500'
  },
  executor: {
    label: 'EXECUTOR',
    classes: 'border-amber-300 bg-amber-50 text-amber-900',
    dotClasses: 'bg-amber-500'
  },
  evaluator: {
    label: 'EVALUATOR',
    classes: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    dotClasses: 'bg-emerald-500'
  },
  done: {
    label: 'DONE',
    classes: 'border-slate-300 bg-slate-50 text-slate-700',
    dotClasses: 'bg-slate-400'
  }
};

export function RoleBadge({
  nextRole,
  dispatching
}: {
  nextRole: RunState['next_role'];
  dispatching: RunState['dispatching'];
}) {
  const role = resolveActiveRole(nextRole, dispatching);
  const meta = ROLE_META[role];
  const isLive = !!dispatching && role !== 'done';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.classes}`}
      title={isLive ? `${meta.label} actively running` : `Paused at ${meta.label}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dotClasses} ${
          isLive ? 'animate-pulse' : ''
        }`}
      />
      <span>{meta.label}</span>
      {isLive ? <span className="text-[9px] font-medium opacity-70">live</span> : null}
    </span>
  );
}
