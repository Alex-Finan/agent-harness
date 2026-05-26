import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api,
  openEventStream,
  type RunDetail as RunDetailT,
  type RunState,
  type ServerEvent,
  type SprintSnapshot,
  type TranscriptMessage
} from '../api';
import { PlanEditor } from './PlanEditor';
import { OverviewView } from './OverviewView';
import { ExpandablePanel } from './ExpandablePanel';
import { PendingCommentsPanel } from './PendingCommentsPanel';
import { StackPanel } from './StackPanel';
import { RunProgressBar } from './RunProgressBar';
import { useDefaultFocus } from './SprintTimeline';
import { PlannerRail } from './PlannerRail';
import { PlanChat } from './PlanChat';
import { RunStatusChip, computeChipState } from './RunStatusChip';
import { ActivityLine } from './ActivityLine';
import { FailureBanner } from './FailureBanner';
import { RevisePlanPanel } from './RevisePlanPanel';
import { InteractivePlanView } from './InteractivePlanView';
import { formatCost, formatRelative, formatTaskTitle } from '../lib/format';

/**
 * A run is in the "planning phase" until the planner writes the first contract.md.
 * As soon as any sprint has a contract, the sprint timeline becomes visible and
 * the operator can track executor/evaluator progress.
 */
function isPlanningPhase(detail: RunDetailT): boolean {
  const sprints = detail.snapshot.sprints;
  return !sprints.some((s) => s.contractMd !== null);
}

export function RunDetail({
  runId,
  onSelectRun,
  allRuns = []
}: {
  runId: string;
  onSelectRun?: (id: string) => void;
  allRuns?: RunState[];
}) {
  const [detail, setDetail] = useState<RunDetailT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appendByLog, setAppendByLog] = useState<Record<string, TranscriptMessage[]>>({});
  const [resetTick, setResetTick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setAppendByLog({});
    setResetTick({});
    setError(null);
    let cancelled = false;
    api
      .getRun(runId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });

    const es = openEventStream((event: ServerEvent) => {
      if (event.type === 'hello') return;
      if (!('runId' in event)) return;
      if (event.runId !== runId) return;

      if (event.type === 'run_state' || event.type === 'run_created') {
        setDetail((prev) => (prev ? { ...prev, state: event.state } : prev));
        // Also refresh logFiles if a new one landed.
        void refreshSnapshot(runId).then((snap) => {
          setDetail((prev) => (prev ? { ...prev, snapshot: snap } : prev));
        });
      } else if (event.type === 'plan') {
        setDetail((prev) =>
          prev ? { ...prev, snapshot: { ...prev.snapshot, planMd: event.planMd } } : prev
        );
      } else if (event.type === 'overview') {
        setDetail((prev) =>
          prev ? { ...prev, snapshot: { ...prev.snapshot, overviewMd: event.overviewMd } } : prev
        );
      } else if (event.type === 'pending_comments') {
        setDetail((prev) =>
          prev
            ? { ...prev, snapshot: { ...prev.snapshot, pendingComments: event.comments } }
            : prev
        );
      } else if (event.type === 'stack') {
        setDetail((prev) =>
          prev ? { ...prev, snapshot: { ...prev.snapshot, stack: event.stack } } : prev
        );
      } else if (event.type === 'contract') {
        updateSprint(setDetail, event.runId, event.sprint, (s) => ({
          ...s,
          contractMd: event.contractMd
        }));
      } else if (event.type === 'output') {
        updateSprint(setDetail, event.runId, event.sprint, (s) => ({
          ...s,
          outputMd: event.outputMd
        }));
      } else if (event.type === 'verdict') {
        updateSprint(setDetail, event.runId, event.sprint, (s) => {
          const verdictRe = /verdict\s*:\s*(pass|fail)/i;
          const m = event.verdictMd.match(verdictRe);
          const verdict = m ? (m[1].toUpperCase() as 'PASS' | 'FAIL') : null;
          return { ...s, verdictMd: event.verdictMd, verdict };
        });
      } else if (event.type === 'transcript_append') {
        setAppendByLog((prev) => ({
          ...prev,
          [event.logName]: [...(prev[event.logName] ?? []), ...event.lines]
        }));
        // Also ensure the log appears in logFiles even if the snapshot lagged.
        setDetail((prev) => {
          if (!prev) return prev;
          if (prev.snapshot.logFiles.includes(event.logName)) return prev;
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              logFiles: [...prev.snapshot.logFiles, event.logName].sort()
            }
          };
        });
      } else if (event.type === 'transcript_reset') {
        setAppendByLog((prev) => ({ ...prev, [event.logName]: [] }));
        setResetTick((prev) => ({ ...prev, [event.logName]: (prev[event.logName] ?? 0) + 1 }));
      } else if (event.type === 'cost') {
        setDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            state: { ...prev.state, cost_total_usd: event.total },
            cost: { ...prev.cost, totalUsd: event.total, perRole: event.perRole }
          };
        });
      } else if (event.type === 'dispatch') {
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                dispatching:
                  event.status === 'finished' || event.status === 'error'
                    ? null
                    : {
                        role: event.role,
                        startedAt: new Date().toISOString(),
                        finished: false
                      }
              }
            : prev
        );
        if (event.status === 'error' && event.error) {
          setError(event.error);
        }
        // Refresh cost detail to pick up new sessions.
        void api
          .getCost(runId)
          .then((c) => setDetail((prev) => (prev ? { ...prev, cost: c } : prev)))
          .catch(() => {});
      }
    }, runId);

    return () => {
      cancelled = true;
      es.close();
    };
  }, [runId]);

  const sprintRows = useMemo(() => detail?.snapshot.sprints ?? [], [detail]);

  if (error && !detail) {
    return (
      <div className="m-6 rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }
  if (!detail) {
    return <div className="m-6 text-sm text-slate-500">loading…</div>;
  }

  const s = detail.state;
  const dispatchingActive = detail.dispatching && !detail.dispatching.finished;
  const canPlan = s.next_role === 'planner' && s.status === 'in_progress' && !dispatchingActive;
  const canNext = (s.next_role === 'executor' || s.next_role === 'evaluator') && s.status === 'in_progress' && !dispatchingActive;
  const canAuto = s.status === 'in_progress' && !dispatchingActive && s.next_role !== 'done';

  async function startPlan() {
    setBusy(true);
    try {
      await api.startPlan(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startNext() {
    setBusy(true);
    try {
      await api.startNext(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startAuto() {
    setBusy(true);
    try {
      await api.startAuto(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function abort() {
    if (!confirm(`Abort run ${runId}?`)) return;
    setBusy(true);
    try {
      await api.abort(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chipState = computeChipState({
    status: s.status,
    nextRole: s.next_role,
    dispatchingActive: !!dispatchingActive
  });
  const roleDetail =
    s.next_role === 'done'
      ? `sprint ${s.current_sprint}/${s.total_sprints || '?'}`
      : `${s.next_role} · sprint ${s.current_sprint}/${s.total_sprints || '?'}`;
  const primaryAction = canPlan
    ? { label: 'plan', onClick: startPlan, disabled: busy }
    : canNext
      ? { label: 'next', onClick: startNext, disabled: busy }
      : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-slate-200 bg-gradient-to-r from-blue-50/60 to-transparent px-6 py-4" title={`run_id ${s.run_id}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <RunStatusChip state={chipState} detail={roleDetail} />
              <span className="text-xs text-slate-500">updated {formatRelative(s.updated_at)}</span>
            </div>
            <h1
              className="mt-2.5 truncate text-xl font-semibold text-blue-950"
              title={s.task_summary}
            >
              {formatTaskTitle(s.task_summary)}
            </h1>
            <ActivityLine
              runId={s.run_id}
              dispatching={detail.dispatching}
              logFiles={detail.snapshot.logFiles}
              appendByLog={appendByLog}
            />
            {s.status === 'halted' ? (
              <FailureBanner runId={s.run_id} sprints={detail.snapshot.sprints} />
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="truncate font-mono" title={s.target_repo}>
                {s.target_repo}
              </span>
              {s.branch ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-emerald-700">
                  ⎇ {s.branch}
                </span>
              ) : null}
              {s.retry_count > 0 ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                  retry <span className="font-mono">{s.retry_count}/{s.max_retries}</span>
                </span>
              ) : null}
              {detail.cost.totalUsd > 0 ? (
                <span
                  className="font-mono text-emerald-600/80"
                  title={`${detail.cost.entries.length} session${detail.cost.entries.length === 1 ? '' : 's'}`}
                >
                  {formatCost(detail.cost.totalUsd)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex gap-2">
              <button
                className={primaryAction ? 'btn btn-primary' : 'btn'}
                onClick={primaryAction?.onClick}
                disabled={!primaryAction || primaryAction.disabled}
                title={primaryAction ? `Run ${primaryAction.label}` : 'No action available'}
              >
                {primaryAction?.label ?? 'plan'}
              </button>
              <button className="btn" onClick={startAuto} disabled={!canAuto || busy}>
                auto-iterate
              </button>
              {s.status === 'in_progress' ? (
                <button
                  className="btn btn-danger"
                  onClick={abort}
                  disabled={busy}
                >
                  abort
                </button>
              ) : null}
            </div>
            {error ? <span className="text-xs text-rose-500">{error}</span> : null}
          </div>
        </div>
      </header>
      {detail.snapshot.planMd === null ? (
        <div className="flex-1 overflow-y-auto p-4">
          {detail.snapshot.stack ? (
            <div className="mb-4">
              <StackPanel
                runId={detail.state.run_id}
                stack={detail.snapshot.stack}
                onOpenRun={onSelectRun}
              />
            </div>
          ) : null}
          <NoPlanEmptyState
            taskMd={detail.snapshot.taskMd}
            canPlan={!!canPlan}
            onPlan={startPlan}
            dispatchingActive={!!detail.dispatching && !detail.dispatching.finished}
            busy={busy}
          />
        </div>
      ) : (
        <SprintView
          detail={detail}
          allRuns={allRuns}
          onSelectRun={onSelectRun}
          stackHeader={
            detail.snapshot.stack ? (
              <StackPanel
                runId={detail.state.run_id}
                stack={detail.snapshot.stack}
                onOpenRun={onSelectRun}
              />
            ) : null
          }
        />
      )}
      {sprintRows.length > 0 ? null : null}
    </div>
  );
}

// Retained for legacy reference — the unified SprintView now handles the
// plan-refinement phase too. Kept un-exported and unused so callers that
// previously rendered it now go through SprintView instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _PlanningView({
  detail,
  canPlan,
  onPlan,
  busy
}: {
  detail: RunDetailT;
  canPlan: boolean;
  onPlan: () => Promise<void>;
  busy: boolean;
}) {
  const dispatchingActive = !!(detail.dispatching && !detail.dispatching.finished);
  const planMd = detail.snapshot.planMd;
  const overviewMd = detail.snapshot.overviewMd;
  const taskMd = detail.snapshot.taskMd;
  const pendingComments = detail.snapshot.pendingComments ?? [];
  const [focusedComment, setFocusedComment] = useState<string | null>(null);

  // Default to Overview when one exists — the whole point of the two-file
  // split is that you read the intuition first. Falls back to Plan for
  // legacy runs that pre-date overview.md.
  const [tab, setTab] = useState<'overview' | 'plan'>(overviewMd ? 'overview' : 'plan');

  // Pure empty state — no plan yet. The dominant action is "Generate plan."
  // Pull it out of the header into a real CTA the operator can't miss.
  if (planMd === null) {
    return (
      <NoPlanEmptyState
        taskMd={taskMd}
        canPlan={canPlan}
        onPlan={onPlan}
        dispatchingActive={dispatchingActive}
        busy={busy}
      />
    );
  }

  // Plan exists but no per-sprint contracts yet — operator is refining the
  // plan before kicking off the executor. Use the same InteractivePlanView
  // surface as the sprint phase so navigation and visual language stay
  // consistent across the run lifecycle.
  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <ExpandablePanel
        header={() => (
          <>
            <div className="flex items-center gap-1">
              {overviewMd !== null ? (
                <TabButton
                  active={tab === 'overview'}
                  onClick={() => setTab('overview')}
                >
                  overview.md
                </TabButton>
              ) : null}
              <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
                plan.md
              </TabButton>
            </div>
            <div className="ml-auto">
              {tab === 'plan' ? (
                <PlanEditButton runId={detail.state.run_id} planMd={planMd} />
              ) : null}
            </div>
          </>
        )}
      >
        {tab === 'overview' && overviewMd !== null ? (
          <OverviewView
            runId={detail.state.run_id}
            overviewMd={overviewMd}
            pendingComments={pendingComments}
            onCommentFocus={setFocusedComment}
          />
        ) : (
          <InteractivePlanView
            planMd={planMd}
            detail={detail}
            focusedDirName={null}
            onFocus={() => {
              /* No sprint dirs yet — clicks are non-actionable here. */
            }}
            onCommentFocus={setFocusedComment}
          />
        )}
      </ExpandablePanel>
      <div className="flex min-h-[60vh] flex-col gap-4">
        <PendingCommentsPanel
          runId={detail.state.run_id}
          comments={pendingComments}
          focusedId={focusedComment}
        />
        <PlanChat
          runId={detail.state.run_id}
          busy={dispatchingActive}
          disabled={planMd === null}
          pendingCommentCount={pendingComments.length}
        />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  title,
  children
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        active
          ? 'rounded px-2.5 py-1 text-sm font-semibold text-blue-700 bg-blue-50'
          : 'rounded px-2.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'
      }
    >
      {children}
    </button>
  );
}

/**
 * The "you just created a run, what now" screen. Shows the task you submitted
 * and a single dominant CTA. When the planner is actively running it shows a
 * thinking state instead so the operator knows progress is happening.
 */
function NoPlanEmptyState({
  taskMd,
  canPlan,
  onPlan,
  dispatchingActive,
  busy
}: {
  taskMd: string | null;
  canPlan: boolean;
  onPlan: () => Promise<void>;
  dispatchingActive: boolean;
  busy: boolean;
}) {
  // Strip the boilerplate "# Task" header + metadata to isolate the prompt body.
  const promptBody = extractTaskPrompt(taskMd);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="panel border-blue-200 bg-gradient-to-br from-blue-50/60 to-white p-6 shadow">
        <h2 className="mb-1 text-lg font-semibold text-blue-950">
          Ready to plan
        </h2>
        <p className="mb-5 text-sm text-slate-700">
          The planner will read your task, explore the target repo read-only,
          and write <code className="rounded bg-slate-100 px-1 text-blue-700">plan.md</code>
          {' '}with one sprint per check-pointable piece of work.
        </p>

        {promptBody ? (
          <div className="mb-5 rounded-md border border-slate-200 bg-white/40 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Your task
            </div>
            <div className="whitespace-pre-wrap text-sm text-slate-800">
              {promptBody}
            </div>
          </div>
        ) : null}

        {dispatchingActive ? (
          <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            Planner is exploring the repo and drafting the plan…
          </div>
        ) : (
          <button
            className="btn btn-primary w-full justify-center py-3 text-base"
            onClick={() => void onPlan()}
            disabled={!canPlan || busy}
          >
            {busy ? 'Starting planner…' : 'Generate plan →'}
          </button>
        )}
      </div>

      <div className="text-center text-xs text-slate-600">
        Or use the <span className="font-mono text-slate-500">auto-iterate</span> button in the header
        to drive the run end-to-end without per-step approval.
      </div>
    </div>
  );
}

/**
 * Pull the operator's actual prompt out of task.md, which is wrapped in
 * boilerplate by createRun. Falls back to the raw text if the format
 * doesn't match the expected `## Prompt\n\n<body>` structure.
 */
function extractTaskPrompt(md: string | null): string | null {
  if (!md) return null;
  const m = md.match(/##\s+Prompt\s*\n+([\s\S]+?)(?:\n+##\s|$)/);
  if (m) return m[1].trim();
  // Fallback: drop leading "# Task" + metadata lines, keep prose.
  return md
    .split('\n')
    .filter((l) => !/^\*\*/.test(l) && !/^#\s/.test(l))
    .join('\n')
    .trim() || null;
}

function SprintView({
  detail,
  allRuns,
  onSelectRun,
  stackHeader
}: {
  detail: RunDetailT;
  allRuns: RunState[];
  onSelectRun?: (id: string) => void;
  stackHeader?: ReactNode;
}) {
  const dispatchingActive = !!(detail.dispatching && !detail.dispatching.finished);
  const runId = detail.state.run_id;
  const planMd = detail.snapshot.planMd;
  const overviewMd = detail.snapshot.overviewMd;
  const pendingComments = detail.snapshot.pendingComments ?? [];
  const [focusedComment, setFocusedComment] = useState<string | null>(null);
  const defaultFocus = useDefaultFocus(detail);
  const [focused, setFocused] = useState<string | null>(defaultFocus);
  // Same tab convention as PlanningView — default to overview when present
  // so the authoritative narrative stays the front door for the entire run,
  // not just the planning phase.
  const [tab, setTab] = useState<'overview' | 'plan'>(overviewMd ? 'overview' : 'plan');
  // Plan column can take over the whole detail body so the user gets more
  // horizontal room when reading a long plan. Escape collapses.
  const [planExpanded, setPlanExpanded] = useState(false);
  const [overviewEditing, setOverviewEditing] = useState(false);
  const overviewSaverRef = useRef<(() => Promise<void>) | null>(null);
  const [overviewSavePending, setOverviewSavePending] = useState(false);
  const registerOverviewSaver = useCallback(
    (fn: (() => Promise<void>) | null) => {
      overviewSaverRef.current = fn;
    },
    []
  );
  useEffect(() => {
    if (!focused || !detail.snapshot.sprints.some((s) => s.dirName === focused)) {
      setFocused(defaultFocus);
    }
  }, [defaultFocus, focused, detail.snapshot.sprints]);
  useEffect(() => {
    if (!planExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
      setPlanExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [planExpanded]);

  const tabRowActions = (
    <div className="flex shrink-0 items-center gap-1">
      {tab === 'plan' ? (
        <PlanEditButton runId={runId} planMd={planMd} />
      ) : overviewMd !== null ? (
        overviewEditing ? (
          <>
            <button
              type="button"
              onClick={() => setOverviewEditing(false)}
              disabled={overviewSavePending}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                const save = overviewSaverRef.current;
                if (!save) return;
                setOverviewSavePending(true);
                try {
                  await save();
                } catch {
                  /* OverviewView surfaces the error in its own banner. */
                } finally {
                  setOverviewSavePending(false);
                }
              }}
              disabled={overviewSavePending}
              className="rounded border border-blue-700 bg-blue-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            >
              {overviewSavePending ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOverviewEditing(true)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
        )
      ) : null}
      <button
        type="button"
        onClick={() => setPlanExpanded((v) => !v)}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
        title={planExpanded ? 'Collapse (Esc)' : 'Expand to fullscreen'}
        aria-label={planExpanded ? 'Collapse' : 'Expand'}
      >
        {planExpanded ? '⤡' : '⤢'}
      </button>
    </div>
  );

  const planColumn = (
    <div className="flex h-full min-h-0 flex-col bg-white lg:border-r lg:border-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {overviewMd !== null ? (
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
              overview.md
            </TabButton>
          ) : null}
          <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
            plan.md
          </TabButton>
        </div>
        {tabRowActions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && overviewMd !== null ? (
          <OverviewView
            runId={runId}
            overviewMd={overviewMd}
            pendingComments={pendingComments}
            onCommentFocus={setFocusedComment}
            editing={overviewEditing}
            onEditingChange={setOverviewEditing}
            registerSaver={registerOverviewSaver}
          />
        ) : planMd ? (
          <InteractivePlanView
            planMd={planMd}
            detail={detail}
            focusedDirName={focused}
            onFocus={setFocused}
            onCommentFocus={setFocusedComment}
          />
        ) : (
          <div className="px-4 py-6 text-sm text-slate-500">No plan yet.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Fixed top region: stack panel (if any) + progress bar. Both stay
          visible above the split so they don't compete with plan/planner. */}
      {stackHeader ? <div className="border-b border-slate-200 px-4 py-3">{stackHeader}</div> : null}
      <div className="border-b border-slate-200 px-4 py-3">
        <RunProgressBar detail={detail} allRuns={allRuns} onSelectRun={onSelectRun} />
      </div>

      {/* Two-column workspace: plan.md (with inline sprint contracts) on the
          left, persistent PlannerRail on the right. Each column manages its
          own scroll so they're independent. When the plan column is expanded
          the right rail collapses entirely to give the plan the full width. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {planColumn}
        <PlannerRail
          detail={detail}
          busy={dispatchingActive}
          canAuto={!dispatchingActive && detail.state.status === 'in_progress' && detail.state.next_role !== 'done'}
          onStartAuto={async () => {
            try {
              await api.startAuto(runId);
            } catch {
              /* surfaced via PlannerRail's own error state when used; the
                 outer header's startAuto path is the primary surface for
                 dispatch failures. */
            }
          }}
        />
      </div>

      {/* Fullscreen plan overlay — covers the entire viewport (above the top
          bar and run header) when the Expand button is clicked. Escape
          collapses. The overlay copies the same plan column so the layout is
          identical, just without the planner rail beside it. */}
      {planExpanded ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <div className="flex items-center gap-1">
              {overviewMd !== null ? (
                <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
                  overview.md
                </TabButton>
              ) : null}
              <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
                plan.md
              </TabButton>
            </div>
            {tabRowActions}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'overview' && overviewMd !== null ? (
              <OverviewView
                runId={runId}
                overviewMd={overviewMd}
                pendingComments={pendingComments}
                onCommentFocus={setFocusedComment}
                editing={overviewEditing}
                onEditingChange={setOverviewEditing}
                registerSaver={registerOverviewSaver}
              />
            ) : planMd ? (
              <InteractivePlanView
                planMd={planMd}
                detail={detail}
                focusedDirName={focused}
                onFocus={setFocused}
                onCommentFocus={setFocusedComment}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}


/**
 * Edit button inline in the plan header — opens the full PlanEditor for
 * direct markdown editing. Most edits go through the revise-plan flow
 * (which round-trips the planner); this is the escape hatch.
 */
function PlanEditButton({ runId, planMd }: { runId: string; planMd: string | null }) {
  const [open, setOpen] = useState(false);
  if (planMd === null) return null;
  return (
    <>
      <button
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
        onClick={() => setOpen(true)}
        title="Edit plan.md directly"
      >
        Edit
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between text-sm text-slate-700">
              <span>plan.md — raw editor</span>
              <button
                className="text-slate-600 hover:text-slate-900"
                onClick={() => setOpen(false)}
              >
                close ×
              </button>
            </div>
            <PlanEditor runId={runId} planMd={planMd} />
          </div>
        </div>
      ) : null}
    </>
  );
}

async function refreshSnapshot(runId: string) {
  const fresh = await api.getRun(runId);
  return fresh.snapshot;
}

function updateSprint(
  setDetail: React.Dispatch<React.SetStateAction<RunDetailT | null>>,
  runId: string,
  sprintDir: string,
  patch: (s: SprintSnapshot) => SprintSnapshot
) {
  setDetail((prev) => {
    if (!prev || prev.state.run_id !== runId) return prev;
    const sprints = prev.snapshot.sprints.map((s) => (s.dirName === sprintDir ? patch(s) : s));
    // If the sprint dir was newly created by the planner, append a placeholder.
    if (!sprints.some((s) => s.dirName === sprintDir)) {
      const numMatch = sprintDir.match(/^(\d+)-(.+)$/);
      sprints.push({
        dirName: sprintDir,
        num: numMatch ? parseInt(numMatch[1], 10) : sprints.length + 1,
        slug: numMatch ? numMatch[2] : sprintDir,
        contractMd: null,
        outputMd: null,
        verdictMd: null,
        verdict: null,
        contractAt: null,
        outputAt: null,
        verdictAt: null
      });
      sprints.sort((a, b) => a.num - b.num);
    }
    return { ...prev, snapshot: { ...prev.snapshot, sprints } };
  });
}
