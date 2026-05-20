import { useState } from 'react';
import { api, type RunDetail, type SprintSnapshot } from '../api';
import { Markdown } from './Markdown';
import { VerdictBadge } from './StatusBadge';

export function SprintTimeline({ detail }: { detail: RunDetail }) {
  const sprints = detail.snapshot.sprints;
  const cur = detail.state.current_sprint;
  const [expanded, setExpanded] = useState<string | null>(null);

  if (sprints.length === 0) {
    return (
      <div className="panel px-4 py-6 text-sm text-slate-400">
        No sprint directories yet. The planner produces them.
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="border-b border-slate-800 px-4 py-2 text-sm font-semibold">sprints</div>
      <ol className="divide-y divide-slate-800">
        {sprints.map((s) => {
          const isCurrent = s.num === cur && detail.state.next_role !== 'done';
          const finished = s.verdict === 'PASS';
          const failed = s.verdict === 'FAIL';
          return (
            <li key={s.dirName} className="px-4 py-3">
              <button
                className="flex w-full items-center gap-3 text-left"
                onClick={() => setExpanded(expanded === s.dirName ? null : s.dirName)}
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                    finished
                      ? 'border-emerald-700 bg-emerald-700/30 text-emerald-300'
                      : failed
                      ? 'border-rose-700 bg-rose-700/30 text-rose-300'
                      : isCurrent
                      ? 'border-amber-700 bg-amber-700/30 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}
                >
                  {s.num}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-100">{s.slug.replace(/-/g, ' ')}</div>
                  <div className="text-xs text-slate-500">{s.dirName}</div>
                </div>
                <VerdictBadge verdict={s.verdict} />
                {isCurrent ? (
                  <span className="badge badge-running animate-pulse">{detail.state.next_role}</span>
                ) : null}
                <span className="text-slate-600">{expanded === s.dirName ? '▾' : '▸'}</span>
              </button>

              {expanded === s.dirName ? (
                <SprintExpanded runId={detail.state.run_id} sprint={s} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SprintExpanded({ runId, sprint }: { runId: string; sprint: SprintSnapshot }) {
  const [tab, setTab] = useState<'contract' | 'output' | 'verdict'>('contract');
  const [editContract, setEditContract] = useState(false);
  const [contractDraft, setContractDraft] = useState(sprint.contractMd ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveContract(runId, sprint.dirName, contractDraft);
      setEditContract(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded border border-slate-800 bg-slate-950/60">
      <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-2 text-xs">
        <button
          className={tab === 'contract' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}
          onClick={() => setTab('contract')}
        >
          contract.md
        </button>
        <button
          className={tab === 'output' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}
          onClick={() => setTab('output')}
        >
          output.md
        </button>
        <button
          className={tab === 'verdict' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}
          onClick={() => setTab('verdict')}
        >
          verdict.md
        </button>
        {tab === 'contract' ? (
          <div className="ml-auto flex gap-2">
            {editContract ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    setContractDraft(sprint.contractMd ?? '');
                    setEditContract(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  setContractDraft(sprint.contractMd ?? '');
                  setEditContract(true);
                }}
                disabled={sprint.contractMd === null}
              >
                Edit
              </button>
            )}
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="m-3 rounded border border-rose-700 bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="max-h-[40vh] overflow-y-auto px-3 py-2">
        {tab === 'contract' ? (
          editContract ? (
            <textarea
              className="textarea h-[40vh]"
              value={contractDraft}
              onChange={(e) => setContractDraft(e.target.value)}
            />
          ) : sprint.contractMd ? (
            <Markdown source={sprint.contractMd} />
          ) : (
            <Empty>No contract.md yet.</Empty>
          )
        ) : null}
        {tab === 'output' ? (
          sprint.outputMd ? (
            <Markdown source={sprint.outputMd} />
          ) : (
            <Empty>Executor has not produced output.md.</Empty>
          )
        ) : null}
        {tab === 'verdict' ? (
          sprint.verdictMd ? (
            <Markdown source={sprint.verdictMd} />
          ) : (
            <Empty>No verdict yet.</Empty>
          )
        ) : null}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-4 text-sm text-slate-500">{children}</div>;
}
