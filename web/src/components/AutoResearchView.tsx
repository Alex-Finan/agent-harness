import { useEffect, useState } from 'react';
import { api, type RunState, type TrialResult } from '../api';
import { MetricChart } from './MetricChart';

interface AutoResearchViewProps {
  run: RunState;
}

/**
 * Detail view for auto_research runs. Shows:
 * - Objective text
 * - Trial counter and best metric
 * - Metric progress chart (SVG, re-fetches every 5s while in_progress)
 * - Notes panel showing notes.md content from the experiment repo
 *
 * Intentionally omits the sprint-centric panels used by standard runs.
 */
export function AutoResearchView({ run }: AutoResearchViewProps) {
  const [trials, setTrials] = useState<TrialResult[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [notesError, setNotesError] = useState<string | null>(null);

  const isLive = run.status === 'in_progress';

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const t = await api.getTrialResults(run.run_id);
        if (!cancelled) setTrials(t);
      } catch {
        // Trial data unavailable yet — no-op
      }

      try {
        const n = await api.getNotes(run.run_id);
        if (!cancelled) {
          setNotes(n);
          setNotesError(null);
        }
      } catch (e) {
        if (!cancelled) setNotesError((e as Error).message);
      }
    }

    void fetchData();

    if (!isLive) return;

    // Re-fetch every 5s while the run is in_progress
    const interval = setInterval(() => {
      void fetchData();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [run.run_id, isLive]);

  const trialsCompleted = run.trials_completed ?? 0;
  const maxTrials = run.max_trials ?? '?';
  const bestMetric = run.best_metric;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header info */}
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
        {run.objective ? (
          <div className="mb-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Objective
            </div>
            <p className="text-sm text-slate-800">{run.objective}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-6">
          {/* Trial counter */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Trials
            </div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">
              {trialsCompleted}{' '}
              <span className="text-base font-normal text-slate-400">/ {maxTrials}</span>
            </div>
          </div>

          {/* Best metric */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Best M
            </div>
            <div className="text-2xl font-bold tabular-nums text-blue-700">
              {bestMetric !== undefined && bestMetric !== null
                ? bestMetric.toFixed(4)
                : '—'}
            </div>
          </div>

          {/* Status */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Status
            </div>
            <div className={`text-sm font-semibold ${
              run.status === 'in_progress'
                ? 'text-amber-600'
                : run.status === 'completed'
                  ? 'text-emerald-600'
                  : 'text-rose-600'
            }`}>
              {run.status === 'in_progress' ? 'Running…' : run.status}
            </div>
          </div>

          {/* Evaluation command */}
          {run.evaluation_cmd ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Eval command
              </div>
              <code className="text-xs text-slate-700 font-mono">{run.evaluation_cmd}</code>
            </div>
          ) : null}
        </div>
      </div>

      {/* Main content: chart + notes */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-5 lg:flex-row">
        {/* Metric chart */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Metric progress
          </div>
          <div className="rounded border border-slate-200 bg-white p-3">
            <MetricChart trials={trials} width={560} height={220} />
          </div>
          {trials.length > 0 ? (
            <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#22c55e]" /> improved
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ef4444]" /> regressed
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" /> no metric
              </span>
            </div>
          ) : null}
        </div>

        {/* Notes panel */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes
          </div>
          <div className="h-64 overflow-y-auto rounded border border-slate-200 bg-white p-3 text-sm text-slate-700 lg:h-full">
            {notesError ? (
              <span className="text-xs text-rose-500">{notesError}</span>
            ) : notes ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{notes}</pre>
            ) : (
              <span className="text-xs text-slate-400">
                {isLive ? 'Waiting for first trial notes…' : 'No notes recorded.'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
