import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  openEventStream,
  type RunDetail as RunDetailT,
  type ServerEvent,
  type SprintSnapshot,
  type TranscriptMessage
} from '../api';
import { PlanEditor } from './PlanEditor';
import { OverviewView } from './OverviewView';
import { ExpandablePanel } from './ExpandablePanel';
import { PendingCommentsPanel } from './PendingCommentsPanel';
import { SprintFocus, useDefaultFocus } from './SprintTimeline';
import { PlanChat } from './PlanChat';
import { RunStatusChip, computeChipState } from './RunStatusChip';
import { ActivityLine } from './ActivityLine';
import { FailureBanner } from './FailureBanner';
import { RevisePlanPanel } from './RevisePlanPanel';
import { InteractivePlanView } from './InteractivePlanView';
import { formatCost, formatRelative } from '../lib/format';

/**
 * A run is in the "planning phase" until the planner writes the first contract.md.
 * As soon as any sprint has a contract, the sprint timeline becomes visible and
 * the operator can track executor/evaluator progress.
 */
function isPlanningPhase(detail: RunDetailT): boolean {
  const sprints = detail.snapshot.sprints;
  return !sprints.some((s) => s.contractMd !== null);
}

export function RunDetail({ runId }: { runId: string }) {
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
              {s.task_summary}
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
      <div className="flex-1 overflow-y-auto p-4">
        {isPlanningPhase(detail) ? (
          <PlanningView
            detail={detail}
            canPlan={!!canPlan}
            onPlan={startPlan}
            busy={busy}
          />
        ) : (
          <SprintView detail={detail} />
        )}
      </div>
      {sprintRows.length > 0 ? null : null}
    </div>
  );
}

function PlanningView({
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
              <TabButton
                active={tab === 'overview'}
                onClick={() => setTab('overview')}
                disabled={overviewMd === null}
                title={overviewMd === null ? 'No overview.md yet — pre-dates two-file convention' : undefined}
              >
                overview.md
              </TabButton>
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
  detail
}: {
  detail: RunDetailT;
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
  useEffect(() => {
    if (!focused || !detail.snapshot.sprints.some((s) => s.dirName === focused)) {
      setFocused(defaultFocus);
    }
  }, [defaultFocus, focused, detail.snapshot.sprints]);

  const focusedSprint =
    detail.snapshot.sprints.find((s) => s.dirName === focused) ??
    detail.snapshot.sprints[0] ??
    null;

  return (
    <div className="flex flex-col gap-4">
      {/* Plan + focused sprint detail side by side — the two anchors.
          (No separate top-level pip strip — the plan view itself acts as
          the sprint navigator, with each section showing phase + timing.) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ExpandablePanel
          collapsedClassName="panel flex max-h-[70vh] flex-col overflow-hidden"
          header={() => (
            <>
              <div className="flex items-center gap-1">
                <TabButton
                  active={tab === 'overview'}
                  onClick={() => setTab('overview')}
                  disabled={overviewMd === null}
                  title={overviewMd === null ? 'No overview.md yet — pre-dates two-file convention' : undefined}
                >
                  overview.md
                </TabButton>
                <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
                  plan.md
                </TabButton>
              </div>
              <div className="ml-auto">
                {tab === 'plan' ? (
                  <PlanEditButton runId={runId} planMd={planMd} />
                ) : null}
              </div>
            </>
          )}
        >
          {tab === 'overview' && overviewMd !== null ? (
            <OverviewView
              runId={runId}
              overviewMd={overviewMd}
              pendingComments={pendingComments}
              onCommentFocus={setFocusedComment}
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
            <div className="px-4 py-6 text-sm text-slate-500">
              No plan yet.
            </div>
          )}
        </ExpandablePanel>

        <div className="max-h-[70vh]">
          {focusedSprint ? (
            <SprintFocus
              runId={runId}
              sprint={focusedSprint}
              detail={detail}
              onCommentFocus={setFocusedComment}
            />
          ) : (
            <div className="panel px-4 py-6 text-sm text-slate-500">
              No sprint to focus yet — the planner produces sprint directories before the executor runs.
            </div>
          )}
        </div>
      </div>

      {pendingComments.length > 0 ? (
        <PendingCommentsPanel
          runId={runId}
          comments={pendingComments}
          focusedId={focusedComment}
        />
      ) : null}

      {/* Revise plan — sticky to the bottom of the viewport so it's always
          reachable even on long plans / long sprint detail. Subtle ring +
          backdrop separates it from scrolled content above. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <RevisePlanPanel
          runId={runId}
          planMd={planMd}
          busy={dispatchingActive}
          pendingCommentCount={pendingComments.length}
        />
      </div>
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
        className="text-xs text-slate-600 hover:text-blue-700"
        onClick={() => setOpen(true)}
        title="Edit plan.md directly"
      >
        edit raw ↗
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
