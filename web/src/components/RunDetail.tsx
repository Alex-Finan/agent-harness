import { useEffect, useMemo, useState } from 'react';
import {
  api,
  openEventStream,
  type RunDetail as RunDetailT,
  type ServerEvent,
  type SprintSnapshot,
  type TranscriptMessage
} from '../api';
import { StatusBadge, VerdictBadge } from './StatusBadge';
import { PlanEditor } from './PlanEditor';
import { SprintTimeline } from './SprintTimeline';
import { TranscriptStream } from './TranscriptStream';
import { CostPanel } from './CostPanel';
import { PlanChat } from './PlanChat';
import { formatCost, formatRelative } from '../lib/format';

/**
 * A run is in the "planning phase" until any sprint produces output.md.
 * During this window the operator iterates on plan.md with the planner;
 * the sprint timeline and other run-time panels stay hidden.
 */
function isPlanningPhase(detail: RunDetailT): boolean {
  const sprints = detail.snapshot.sprints;
  const anySprintRan = sprints.some((s) => s.outputMd !== null || s.verdictMd !== null);
  return !anySprintRan;
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
      <div className="m-6 rounded border border-rose-700 bg-rose-900/40 px-4 py-3 text-sm text-rose-200">
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-slate-800 px-6 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={s.status} />
              {dispatchingActive ? (
                <span className="badge badge-running animate-pulse">{detail.dispatching!.role}…</span>
              ) : null}
              <VerdictBadge verdict={s.last_verdict ?? null} />
              <span className="text-xs text-slate-500">updated {formatRelative(s.updated_at)}</span>
            </div>
            <div className="mt-2 truncate text-lg font-semibold" title={s.task_summary}>
              {s.task_summary}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-slate-500" title={s.target_repo}>
              {s.target_repo}
              {s.branch ? <span className="ml-2 text-emerald-500">{s.branch}</span> : null}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              run_id <span className="font-mono">{s.run_id}</span> · sprint{' '}
              <span className="font-mono">
                {s.current_sprint}/{s.total_sprints || '?'}
              </span>{' '}
              · next <span className="font-mono">{s.next_role}</span> · retry{' '}
              <span className="font-mono">
                {s.retry_count}/{s.max_retries}
              </span>{' '}
              · cost <span className="font-mono text-emerald-400">{formatCost(detail.cost.totalUsd)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex gap-2">
              <button className="btn" onClick={startPlan} disabled={!canPlan || busy}>
                plan
              </button>
              <button className="btn" onClick={startNext} disabled={!canNext || busy}>
                next
              </button>
              <button className="btn btn-primary" onClick={startAuto} disabled={!canAuto || busy}>
                auto-iterate
              </button>
              <button
                className="btn btn-danger"
                onClick={abort}
                disabled={s.status !== 'in_progress' || busy}
              >
                abort
              </button>
            </div>
            {error ? <span className="text-xs text-rose-400">{error}</span> : null}
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {isPlanningPhase(detail) ? (
          <PlanningView
            detail={detail}
            appendByLog={appendByLog}
            resetTick={resetTick}
          />
        ) : (
          <SprintView
            detail={detail}
            appendByLog={appendByLog}
            resetTick={resetTick}
          />
        )}
      </div>
      {sprintRows.length > 0 ? null : null}
    </div>
  );
}

function PlanningView({
  detail,
  appendByLog,
  resetTick
}: {
  detail: RunDetailT;
  appendByLog: Record<string, TranscriptMessage[]>;
  resetTick: Record<string, number>;
}) {
  const dispatchingActive = !!(detail.dispatching && !detail.dispatching.finished);
  const planMd = detail.snapshot.planMd;
  const showTranscript = dispatchingActive && detail.snapshot.logFiles.length > 0;

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="min-h-[60vh]">
        <PlanEditor runId={detail.state.run_id} planMd={planMd} />
      </div>
      <div className="flex min-h-[60vh] flex-col gap-4">
        <div className="min-h-[40vh] flex-1">
          <PlanChat
            runId={detail.state.run_id}
            busy={dispatchingActive}
            disabled={planMd === null}
          />
        </div>
        {showTranscript ? (
          <div className="h-[30vh]">
            <TranscriptStream
              runId={detail.state.run_id}
              logFiles={detail.snapshot.logFiles}
              appendByLog={appendByLog}
              resetTick={resetTick}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SprintView({
  detail,
  appendByLog,
  resetTick
}: {
  detail: RunDetailT;
  appendByLog: Record<string, TranscriptMessage[]>;
  resetTick: Record<string, number>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <SprintTimeline detail={detail} />
      <div className="h-[60vh]">
        <TranscriptStream
          runId={detail.state.run_id}
          logFiles={detail.snapshot.logFiles}
          appendByLog={appendByLog}
          resetTick={resetTick}
        />
      </div>
      <PlanEditor runId={detail.state.run_id} planMd={detail.snapshot.planMd} />
      <CostPanel cost={detail.cost} />
    </div>
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
        verdict: null
      });
      sprints.sort((a, b) => a.num - b.num);
    }
    return { ...prev, snapshot: { ...prev.snapshot, sprints } };
  });
}
