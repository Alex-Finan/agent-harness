import { useState } from 'react';
import { api, type RunDetail, type SprintSnapshot } from '../api';
import { Markdown } from './Markdown';
import { VerdictBadge } from './StatusBadge';

type Phase = 'pending' | 'contract-ready' | 'running' | 'passed' | 'failed';

function computePhase(
  s: SprintSnapshot,
  cur: number,
  nextRole: string,
  dispatchingActive: boolean,
): Phase {
  if (s.verdict === 'PASS') return 'passed';
  if (s.verdict === 'FAIL') return 'failed';
  const isCurrent = s.num === cur && nextRole !== 'done';
  if (isCurrent && dispatchingActive) return 'running';
  if (s.contractMd !== null && s.outputMd === null) return 'contract-ready';
  return 'pending';
}

const PHASE_ICON_CLASS: Record<Phase, string> = {
  pending: 'border-slate-700 bg-slate-800 text-slate-400',
  'contract-ready': 'border-indigo-700 bg-indigo-700/30 text-indigo-300',
  running: 'border-amber-700 bg-amber-700/30 text-amber-300',
  passed: 'border-emerald-700 bg-emerald-700/30 text-emerald-300',
  failed: 'border-rose-700 bg-rose-700/30 text-rose-300',
};

const PHASE_BADGE_CLASS: Record<Phase, string> = {
  pending: 'border border-slate-700 bg-slate-800 text-slate-400',
  'contract-ready': 'border border-indigo-700 bg-indigo-900/40 text-indigo-300',
  running: 'border border-amber-700 bg-amber-900/40 text-amber-300',
  passed: 'border border-emerald-700 bg-emerald-900/40 text-emerald-300',
  failed: 'border border-rose-700 bg-rose-900/40 text-rose-300',
};

const PHASE_LABEL: Record<Phase, string> = {
  pending: 'pending',
  'contract-ready': 'contract ready',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
};

export function SprintTimeline({ detail }: { detail: RunDetail }) {
  const sprints = detail.snapshot.sprints;
  const cur = detail.state.current_sprint;
  const dispatchingActive = !!(detail.dispatching && !detail.dispatching.finished);
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
          const phase = computePhase(s, cur, detail.state.next_role, dispatchingActive);
          const isRunning = phase === 'running';
          const isCurrent = s.num === cur && detail.state.next_role !== 'done';
          return (
            <li key={s.dirName} className="px-4 py-3">
              <button
                className="flex w-full items-center gap-3 text-left"
                onClick={() => setExpanded(expanded === s.dirName ? null : s.dirName)}
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${PHASE_ICON_CLASS[phase]}${isRunning ? ' animate-pulse' : ''}`}
                >
                  {s.num}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-100">{s.slug.replace(/-/g, ' ')}</div>
                  <div className="text-xs text-slate-500">{s.dirName}</div>
                </div>
                <span className={`badge ${PHASE_BADGE_CLASS[phase]}${isRunning ? ' animate-pulse' : ''}`}>
                  {PHASE_LABEL[phase]}
                </span>
                <VerdictBadge verdict={s.verdict} />
                {isCurrent ? (
                  <span className={`badge badge-running${dispatchingActive ? ' animate-pulse' : ''}`}>
                    {detail.state.next_role}
                  </span>
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
