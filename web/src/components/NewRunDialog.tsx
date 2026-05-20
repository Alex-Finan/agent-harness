import { useState } from 'react';
import { api } from '../api';
import { RepoPicker } from './RepoPicker';

export function NewRunDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (runId: string) => void;
}) {
  const [repo, setRepo] = useState('');
  const [task, setTask] = useState('');
  const [base, setBase] = useState('');
  const [branch, setBranch] = useState('');
  const [maxRetries, setMaxRetries] = useState(3);
  const [autoIterate, setAutoIterate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.createRun({
        repo,
        task,
        maxRetries,
        base: base || undefined,
        branch: branch || undefined
      });
      if (autoIterate) {
        await api.startAuto(result.runId).catch((e) => {
          // Auto-iterate failure shouldn't block the run from existing.
          // eslint-disable-next-line no-console
          console.warn('auto-iterate failed to start', e);
        });
      }
      onCreated(result.runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="panel w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="text-sm font-semibold">Start a new run</div>
          <button className="text-slate-400 hover:text-slate-200" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          <div>
            <label className="label">Target repository</label>
            <RepoPicker value={repo} onChange={setRepo} disabled={busy} />
            <div className="mt-1 text-[11px] text-slate-500">
              Pick from your GitHub repos + local clones, or paste an absolute path directly.
            </div>
          </div>
          <div>
            <label className="label">Task description</label>
            <textarea
              className="textarea h-40"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe what you want the planner→executor→evaluator to accomplish."
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Base branch (optional)</label>
              <input
                className="input"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="main"
              />
            </div>
            <div>
              <label className="label">Branch name (optional)</label>
              <input
                className="input"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="harness/<run_id>"
              />
            </div>
            <div>
              <label className="label">Max retries / sprint</label>
              <input
                type="number"
                min={1}
                max={20}
                className="input"
                value={maxRetries}
                onChange={(e) => setMaxRetries(parseInt(e.target.value, 10) || 1)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={autoIterate}
              onChange={(e) => setAutoIterate(e.target.checked)}
            />
            Auto-iterate (planner → all sprints) once created
          </label>
          {error ? (
            <div className="rounded border border-rose-700 bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create run'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
