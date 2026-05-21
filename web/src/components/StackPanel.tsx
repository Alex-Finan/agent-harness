import { useState } from 'react';
import type { Stack, StackEntry } from '../api';
import { api } from '../api';

/**
 * Renders the planner's recommended PR stack. The current run is always
 * ordered[0] (filled dot). Follow-up entries (ordered[1..]) start unspawned
 * (open dot) and can be edited inline before the operator clicks Spawn.
 *
 * Spawn calls /api/runs/:id/stack/spawn which inits a worktree per entry,
 * each branched off the previous PR's branch. With the auto-iterate
 * checkbox ticked, the chain orchestrator fires auto-iterate on each
 * follow-up as soon as its predecessor reaches status=completed.
 */
export function StackPanel({
  runId,
  stack,
  onOpenRun
}: {
  runId: string;
  stack: Stack;
  onOpenRun?: (id: string) => void;
}) {
  const [autoIterate, setAutoIterate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const followUps = stack.ordered.slice(1);
  const unspawned = followUps.filter((e) => !e.runId).length;
  const spawned = followUps.filter((e) => !!e.runId).length;

  async function spawn() {
    setBusy(true);
    setError(null);
    try {
      await api.spawnStack(runId, autoIterate);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Recommended PR stack
            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
              {stack.ordered.length} PRs
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            {spawned > 0
              ? `${spawned} spawned · ${unspawned} pending`
              : `${unspawned} follow-up${unspawned === 1 ? '' : 's'} to spawn`}
            {stack.auto_iterate_chain ? (
              <span className="ml-2 text-amber-700">chain active</span>
            ) : null}
            {typeof stack.halted_at === 'number' ? (
              <span className="ml-2 text-rose-600">halted at PR {stack.halted_at + 1}</span>
            ) : null}
          </div>
        </div>
      </div>

      <ol className="divide-y divide-slate-200/60">
        {stack.ordered.map((entry, i) => (
          <StackRow
            key={i}
            runId={runId}
            index={i}
            entry={entry}
            isCurrent={i === stack.current_index}
            onOpenRun={onOpenRun}
          />
        ))}
      </ol>

      {unspawned > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={autoIterate}
              onChange={(e) => setAutoIterate(e.target.checked)}
            />
            Auto-iterate the chain (each follow-up runs end-to-end as soon as its predecessor completes)
          </label>
          <button
            className="btn btn-primary"
            onClick={() => void spawn()}
            disabled={busy}
            title={`Spawn ${unspawned} follow-up run${unspawned === 1 ? '' : 's'}`}
          >
            {busy ? 'Spawning…' : `Spawn ${unspawned} follow-up run${unspawned === 1 ? '' : 's'}`}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="m-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function StackRow({
  runId,
  index,
  entry,
  isCurrent,
  onOpenRun
}: {
  runId: string;
  index: number;
  entry: StackEntry;
  isCurrent: boolean;
  onOpenRun?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTask, setDraftTask] = useState(entry.task);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filled = !!entry.runId || isCurrent;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.patchStackEntry(runId, index, { task: draftTask.trim() });
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex gap-3 px-4 py-3">
      <div className="flex flex-col items-center pt-1">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            filled
              ? 'border border-indigo-500 bg-indigo-500 text-white'
              : 'border border-slate-300 bg-white text-slate-500'
          }`}
        >
          {index + 1}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <span className="font-mono text-slate-800">{entry.branch}</span>
          <span className="text-slate-400">←</span>
          <span className="font-mono text-slate-600">{entry.base}</span>
          {isCurrent ? (
            <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
              this run
            </span>
          ) : entry.runId ? (
            <button
              className="ml-1 text-[11px] text-blue-700 hover:underline"
              onClick={() => onOpenRun?.(entry.runId!)}
              title={entry.runId}
            >
              spawned · open
            </button>
          ) : (
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              pending
            </span>
          )}
        </div>

        {editing ? (
          <>
            <textarea
              className="textarea mt-2 h-28 w-full resize-none text-xs"
              value={draftTask}
              onChange={(e) => setDraftTask(e.target.value)}
              disabled={busy}
            />
            {err ? <div className="mt-1 text-xs text-rose-600">{err}</div> : null}
            <div className="mt-1 flex justify-end gap-2">
              <button
                className="btn !px-2 !py-0.5 !text-xs"
                onClick={() => {
                  setDraftTask(entry.task);
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary !px-2 !py-0.5 !text-xs"
                onClick={() => void save()}
                disabled={busy || draftTask.trim().length === 0}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-700">
              {entry.task}
            </p>
            {!entry.runId && !isCurrent ? (
              <button
                className="mt-1 text-[11px] text-slate-500 hover:text-slate-800"
                onClick={() => setEditing(true)}
              >
                edit task
              </button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
