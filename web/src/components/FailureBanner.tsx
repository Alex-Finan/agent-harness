import { useState } from 'react';
import { api, type SprintSnapshot } from '../api';
import { verdictExcerpt } from '../lib/format';

/**
 * When a run is halted, the operator's most-pressing question is "why did
 * this fail?" The answer is in `verdict.md` of the sprint that failed, but
 * that takes two clicks to reach via the sprint timeline. This banner pulls
 * a short excerpt up to the header so it's the first thing read.
 *
 * Also surfaces the recovery affordance — a Resume button that clears the
 * halted status and resets retry_count so the operator can fix the issue
 * (edit the contract, revise the plan) and click next to retry.
 */
export function FailureBanner({
  runId,
  sprints
}: {
  runId: string;
  sprints: SprintSnapshot[];
}) {
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The most recent FAIL is the one to surface — the planner's loop might
  // produce earlier FAILs that the executor since fixed.
  const failed = [...sprints].reverse().find((s) => s.verdict === 'FAIL');
  if (!failed || !failed.verdictMd) return null;

  const excerpt = verdictExcerpt(failed.verdictMd, 320);
  if (!excerpt) return null;

  async function resume() {
    setResuming(true);
    setError(null);
    try {
      await api.resume(runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="mt-3 flex items-start gap-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <span className="mt-0.5 shrink-0 text-base">⛔</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-rose-600">
          Sprint {failed.num} — {failed.slug.replace(/-/g, ' ')} failed · max retries reached
        </div>
        <div className="mt-0.5 text-rose-800/90" title={failed.verdictMd}>
          {excerpt}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button
            className="rounded border border-rose-400 bg-rose-100 px-2 py-1 font-medium text-rose-800 hover:bg-rose-200 disabled:opacity-50"
            onClick={resume}
            disabled={resuming}
            title="Reset retry budget and clear halted status — then click 'next' to retry the sprint"
          >
            {resuming ? 'Resuming…' : '↻ Resume run'}
          </button>
          <span className="text-rose-600/70">
            Fix the contract or revise the plan, then resume.
          </span>
        </div>
        {error ? <div className="mt-1 text-rose-600">{error}</div> : null}
      </div>
    </div>
  );
}
