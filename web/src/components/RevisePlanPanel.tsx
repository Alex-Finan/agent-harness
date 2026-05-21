import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { diffPlans, bodyLineDelta, type PlanDiff } from '../lib/plan-diff';

/**
 * Operator-facing affordance to ask the planner to revise the current plan.
 *
 * Improvements over the original one-line input:
 *   1. Multi-line textarea so paragraph-length feedback fits comfortably.
 *   2. Cmd/Ctrl+Enter to submit; plain Enter adds a newline.
 *   3. After the planner replies, render a sprint-level diff of what changed
 *      so the operator can see whether their feedback was actually applied
 *      without scrolling through the whole plan.
 */
export function RevisePlanPanel({
  runId,
  planMd,
  busy,
  pendingCommentCount = 0
}: {
  runId: string;
  planMd: string | null;
  busy: boolean;
  pendingCommentCount?: number;
}) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<PlanDiff | null>(null);
  const [showDiffDetails, setShowDiffDetails] = useState(false);
  /** Snapshot of plan.md taken right before submitting; used as the "before"
   *  side of the diff once the planner writes the new plan.md. */
  const beforePlanRef = useRef<string | null>(null);
  const lastSeenPlanRef = useRef<string | null>(planMd);

  // When plan.md changes after we've snapshotted a before, compute the diff.
  useEffect(() => {
    if (planMd === lastSeenPlanRef.current) return;
    lastSeenPlanRef.current = planMd;
    if (beforePlanRef.current !== null && planMd !== null) {
      const d = diffPlans(beforePlanRef.current, planMd);
      // Only show if there's something worth showing
      if (!d.isEmpty) {
        setDiff(d);
        setShowDiffDetails(false);
      }
      beforePlanRef.current = null;
    }
  }, [planMd]);

  async function submit() {
    if (loading) return;
    if (!message.trim() && pendingCommentCount === 0) return;
    setLoading(true);
    setError(null);
    beforePlanRef.current = planMd ?? '';
    try {
      await api.revisePlan(runId, message.trim());
      setMessage('');
    } catch (e) {
      setError((e as Error).message);
      beforePlanRef.current = null;
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  const disabled = busy || loading;

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Revise plan
        </div>
        {diff ? (
          <button
            className="text-xs text-slate-500 hover:text-slate-700"
            onClick={() => setDiff(null)}
            title="Dismiss diff summary"
          >
            dismiss ×
          </button>
        ) : null}
      </div>

      {diff ? <DiffSummary diff={diff} expanded={showDiffDetails} onToggle={() => setShowDiffDetails((x) => !x)} /> : null}

      <textarea
        className="block w-full min-h-[80px] resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-600 disabled:opacity-50 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-700/40"
        placeholder="Ask the planner to revise — e.g. &quot;combine sprints 2 and 3, add a rollback sprint at the end.&quot;"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />

      {pendingCommentCount > 0 ? (
        <div className="mt-1 text-[11px] text-amber-700">
          {pendingCommentCount} pending comment{pendingCommentCount === 1 ? '' : 's'} will be sent with this revision
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          ⌘/Ctrl + Enter to send · Enter for newline
        </span>
        <button
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={disabled || (!message.trim() && pendingCommentCount === 0)}
        >
          {loading ? 'Revising…' : 'Revise plan'}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-rose-500">{error}</p> : null}
    </div>
  );
}

function DiffSummary({
  diff,
  expanded,
  onToggle
}: {
  diff: PlanDiff;
  expanded: boolean;
  onToggle: () => void;
}) {
  const counts: string[] = [];
  if (diff.added.length) counts.push(`+${diff.added.length} added`);
  if (diff.removed.length) counts.push(`−${diff.removed.length} removed`);
  if (diff.modified.length) counts.push(`~${diff.modified.length} modified`);
  if (diff.preambleChanged) counts.push('preamble updated');

  return (
    <div className="mb-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
      <button
        className="flex w-full items-center gap-2 text-left text-xs font-semibold text-emerald-700 hover:text-emerald-800"
        onClick={onToggle}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Planner revised the plan</span>
        <span className="ml-auto font-normal text-emerald-700/80">{counts.join(' · ')}</span>
      </button>
      {expanded ? (
        <div className="mt-2 space-y-1 text-xs">
          {diff.added.map((s) => (
            <div key={`a-${s.num}`} className="flex items-baseline gap-2 text-emerald-700">
              <span className="font-mono text-[10px]">+ NEW</span>
              <span className="font-medium">
                Sprint {s.num} — {s.title}
              </span>
            </div>
          ))}
          {diff.removed.map((s) => (
            <div key={`r-${s.num}`} className="flex items-baseline gap-2 text-rose-600">
              <span className="font-mono text-[10px]">− DEL</span>
              <span className="font-medium line-through">
                Sprint {s.num} — {s.title}
              </span>
            </div>
          ))}
          {diff.modified.map(({ before, after }) => {
            const titleChanged = before.title !== after.title;
            const delta = bodyLineDelta(before.body, after.body);
            return (
              <div key={`m-${after.num}`} className="flex items-baseline gap-2 text-amber-700">
                <span className="font-mono text-[10px]">~ MOD</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Sprint {after.num} — {after.title}</span>
                  {titleChanged ? (
                    <span className="ml-2 text-slate-600 line-through">{before.title}</span>
                  ) : null}
                  <span className="ml-2 text-[11px] text-slate-500">
                    {delta.added > 0 ? `+${delta.added} ` : ''}
                    {delta.removed > 0 ? `−${delta.removed} ` : ''}
                    lines
                  </span>
                </span>
              </div>
            );
          })}
          {diff.preambleChanged ? (
            <div className="flex items-baseline gap-2 text-slate-600">
              <span className="font-mono text-[10px]">~ INTRO</span>
              <span>Overview / preamble rewritten</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
