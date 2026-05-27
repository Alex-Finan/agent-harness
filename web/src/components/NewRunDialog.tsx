import { useState } from 'react';
import { api } from '../api';
import { RepoPicker } from './RepoPicker';

type RunMode = 'standard' | 'auto_research';

export function NewRunDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (runId: string) => void;
}) {
  const [mode, setMode] = useState<RunMode>('standard');

  // Standard run fields
  const [repo, setRepo] = useState('');
  const [task, setTask] = useState('');
  const [base, setBase] = useState('');
  const [branch, setBranch] = useState('');
  const [maxRetries, setMaxRetries] = useState(3);
  const [autoIterate, setAutoIterate] = useState(true);

  // Auto-research fields
  const [experimentDir, setExperimentDir] = useState('');
  const [objective, setObjective] = useState('');
  const [evaluationCmd, setEvaluationCmd] = useState('');
  const [maxTrials, setMaxTrials] = useState(50);
  const [budgetMinutes, setBudgetMinutes] = useState(10);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'auto_research') {
        const result = await api.createRun({
          repo: experimentDir,
          task: objective,
          runType: 'auto_research',
          experimentDir,
          objective,
          evaluationCmd: evaluationCmd.trim() || undefined,
          maxTrials,
          budgetMinutesPerTrial: budgetMinutes
        });
        // Backend auto-starts the sweep on creation for auto_research runs.
        onCreated(result.runId);
      } else {
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
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="panel w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="text-sm font-semibold">Start a new run</div>
          <button className="text-slate-600 hover:text-slate-800" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Mode selector tabs */}
        <div className="flex border-b border-slate-200 px-5 pt-3">
          <button
            type="button"
            onClick={() => setMode('standard')}
            className={`mr-1 rounded-t px-4 py-2 text-sm font-medium transition ${
              mode === 'standard'
                ? 'border-b-2 border-blue-600 text-blue-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Long Running Task
          </button>
          <button
            type="button"
            onClick={() => setMode('auto_research')}
            className={`rounded-t px-4 py-2 text-sm font-medium transition ${
              mode === 'auto_research'
                ? 'border-b-2 border-blue-600 text-blue-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Auto Research
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          {mode === 'standard' ? (
            <>
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
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={autoIterate}
                  onChange={(e) => setAutoIterate(e.target.checked)}
                />
                Auto-iterate (planner → all sprints) once created
              </label>
            </>
          ) : (
            <>
              <div>
                <label className="label">Experiment directory</label>
                <RepoPicker value={experimentDir} onChange={setExperimentDir} disabled={busy} />
                <div className="mt-1 text-[11px] text-slate-500">
                  Pick from your GitHub repos + local clones, or paste an absolute path directly.
                  Claude has full read/write access to all files in the selected repo.
                </div>
              </div>
              <div>
                <label className="label">Objective</label>
                <textarea
                  className="textarea h-28"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="Improve composite metric M by tuning the preprocessing pipeline"
                  required
                  disabled={busy}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Describe what to optimise and how it is measured.
                </div>
              </div>
              <div>
                <label className="label">Evaluation command (optional)</label>
                <input
                  className="input"
                  value={evaluationCmd}
                  onChange={(e) => setEvaluationCmd(e.target.value)}
                  placeholder="bash run_experiment.sh — or leave blank to let the agent define it"
                  disabled={busy}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Command that prints <code className="font-mono">RESULT|M=&lt;value&gt;</code> somewhere in its output.
                  Leave blank and the agent will design its own reproducible metric on trial 1, freeze it,
                  and reuse it for every later trial.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Max trials</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    className="input"
                    value={maxTrials}
                    onChange={(e) => setMaxTrials(parseInt(e.target.value, 10) || 1)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="label">Budget minutes / trial</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    className="input"
                    value={budgetMinutes}
                    onChange={(e) => setBudgetMinutes(parseInt(e.target.value, 10) || 1)}
                    disabled={busy}
                  />
                </div>
              </div>
            </>
          )}

          {error ? (
            <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : mode === 'auto_research' ? 'Start research' : 'Create run'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
