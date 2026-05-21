import { useEffect, useMemo, useState } from 'react';
import { api, type RunDetail, type SprintSnapshot } from '../api';
import { Markdown } from './Markdown';
import { CommentableMarkdown } from './CommentableMarkdown';
import { VerdictBadge } from './StatusBadge';
import { formatCost, formatDuration } from '../lib/format';

type Phase = 'pending' | 'contract-ready' | 'running' | 'passed' | 'failed';

function computePhase(
  s: SprintSnapshot,
  cur: number,
  nextRole: string,
  dispatchingActive: boolean
): Phase {
  if (s.verdict === 'PASS') return 'passed';
  if (s.verdict === 'FAIL') return 'failed';
  const isCurrent = s.num === cur && nextRole !== 'done';
  if (isCurrent && dispatchingActive) return 'running';
  if (s.contractMd !== null || s.outputMd !== null) return 'contract-ready';
  return 'pending';
}

const PHASE_DOT_CLASS: Record<Phase, string> = {
  pending: 'bg-slate-200',
  'contract-ready': 'bg-indigo-500/70',
  running: 'bg-amber-400 animate-pulse ring-2 ring-amber-300',
  passed: 'bg-emerald-500',
  failed: 'bg-rose-500'
};

/**
 * Horizontal sprint pip strip. Just number + slug + pip color — phase is
 * communicated by the pip alone, no text label noise.
 */
export function SprintPipStrip({
  detail,
  focusedDirName,
  onFocus
}: {
  detail: RunDetail;
  focusedDirName: string | null;
  onFocus: (dirName: string) => void;
}) {
  const sprints = detail.snapshot.sprints;
  const cur = detail.state.current_sprint;
  const dispatchingActive = !!(detail.dispatching && !detail.dispatching.finished);
  const passedCount = sprints.filter((s) => s.verdict === 'PASS').length;

  if (sprints.length === 0) return null;

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs">
        <span className="text-slate-600">
          <span className="text-base font-semibold tabular-nums text-slate-900">
            {passedCount}
          </span>
          <span className="mx-1 text-slate-600">/</span>
          <span className="tabular-nums text-slate-600">{sprints.length}</span>
          <span className="ml-2 uppercase tracking-wide text-slate-500">passed</span>
        </span>
      </div>
      <div className="overflow-x-auto px-3 py-2">
        <ol className="flex min-w-max items-center gap-1">
          {sprints.map((s, idx) => {
            const phase = computePhase(s, cur, detail.state.next_role, dispatchingActive);
            const isFocused = s.dirName === focusedDirName;
            return (
              <li key={s.dirName} className="flex items-center">
                <button
                  onClick={() => onFocus(s.dirName)}
                  className={`flex w-28 flex-col items-center gap-1 rounded px-2 py-1.5 text-center transition ${
                    isFocused
                      ? 'bg-slate-100/70 ring-1 ring-blue-400'
                      : 'hover:bg-slate-100/40'
                  }`}
                  title={`Sprint ${s.num} — ${s.slug.replace(/-/g, ' ')}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${PHASE_DOT_CLASS[phase]}`} />
                    <span className="text-[11px] font-semibold tabular-nums text-slate-700">
                      {s.num}
                    </span>
                  </div>
                  <div
                    className="line-clamp-1 text-[11px] leading-tight text-slate-700"
                    title={s.slug.replace(/-/g, ' ')}
                  >
                    {s.slug.replace(/-/g, ' ')}
                  </div>
                </button>
                {idx < sprints.length - 1 ? (
                  <span className="h-px w-2 shrink-0 bg-slate-100" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Compute the default focused sprint: current sprint, falling back to last. */
export function useDefaultFocus(detail: RunDetail): string | null {
  return useMemo(() => {
    const sprints = detail.snapshot.sprints;
    if (sprints.length === 0) return null;
    const current = sprints.find((s) => s.num === detail.state.current_sprint);
    return (current ?? sprints[sprints.length - 1]).dirName;
  }, [detail.snapshot.sprints, detail.state.current_sprint]);
}

/**
 * Focused-sprint detail panel: contract / output / verdict tabs with
 * per-sprint cost & duration in the header.
 */
export function SprintFocus({
  runId,
  sprint,
  detail,
  onCommentFocus
}: {
  runId: string;
  sprint: SprintSnapshot;
  detail: RunDetail;
  onCommentFocus?: (commentId: string) => void;
}) {
  const [tab, setTab] = useState<'contract' | 'output' | 'verdict'>('contract');
  const [editContract, setEditContract] = useState(false);
  const [contractDraft, setContractDraft] = useState(sprint.contractMd ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditContract(false);
    setContractDraft(sprint.contractMd ?? '');
    setError(null);
    if (sprint.verdictMd) setTab('verdict');
    else if (sprint.outputMd) setTab('output');
    else setTab('contract');
  }, [sprint.dirName, sprint.contractMd, sprint.outputMd, sprint.verdictMd]);

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

  const sprintCostEntries = detail.cost.entries.filter((e) =>
    e.logFile.startsWith(`sprint${String(sprint.num).padStart(2, '0')}-`)
  );
  const sprintCost = sprintCostEntries.reduce((acc, e) => acc + (e.costUsd ?? 0), 0);
  const apiDuration = sprintCostEntries.reduce((acc, e) => acc + (e.durationMs ?? 0), 0);
  const sprintTurns = sprintCostEntries.reduce((acc, e) => acc + (e.numTurns ?? 0), 0);
  // Fall back to file-mtime duration when cost data is missing (e.g. older
  // runs without per-session telemetry) so the header isn't empty.
  const mtimeDuration =
    sprint.contractAt && (sprint.verdictAt ?? sprint.outputAt)
      ? Date.parse((sprint.verdictAt ?? sprint.outputAt) as string) - Date.parse(sprint.contractAt)
      : null;
  const sprintDuration = apiDuration > 0 ? apiDuration : mtimeDuration;
  const hasAnyDetail = sprintCostEntries.length > 0 || sprintDuration !== null;

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2">
        <span className="text-sm font-semibold text-slate-900">
          Sprint {sprint.num} — {sprint.slug.replace(/-/g, ' ')}
        </span>
        <VerdictBadge verdict={sprint.verdict} />
        {hasAnyDetail ? (
          <span className="text-xs text-slate-500">
            {sprintCost > 0 ? (
              <>
                <span className="font-mono text-emerald-600/80">{formatCost(sprintCost)}</span>
                <span className="mx-1.5 text-slate-700">·</span>
              </>
            ) : null}
            {sprintDuration !== null && sprintDuration > 0 ? (
              <span className="tabular-nums">{formatDuration(sprintDuration)}</span>
            ) : null}
            {sprintTurns > 0 ? (
              <>
                <span className="mx-1.5 text-slate-700">·</span>
                <span className="tabular-nums">{sprintTurns} turn{sprintTurns === 1 ? '' : 's'}</span>
              </>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-3 text-xs">
          <TabButton active={tab === 'contract'} onClick={() => setTab('contract')} label="contract" present={!!sprint.contractMd} />
          <TabButton active={tab === 'output'} onClick={() => setTab('output')} label="output" present={!!sprint.outputMd} />
          <TabButton active={tab === 'verdict'} onClick={() => setTab('verdict')} label="verdict" present={!!sprint.verdictMd} />
          {tab === 'contract' && sprint.contractMd ? (
            editContract ? (
              <div className="ml-2 flex gap-2">
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
              </div>
            ) : (
              <button className="btn ml-2" onClick={() => setEditContract(true)}>
                Edit
              </button>
            )
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="m-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'contract' ? (
          editContract ? (
            <textarea
              className="textarea h-full min-h-[40vh]"
              value={contractDraft}
              onChange={(e) => setContractDraft(e.target.value)}
            />
          ) : sprint.contractMd ? (
            <CommentableMarkdown
              source={sprint.contractMd}
              file={`sprints/${sprint.dirName}/contract.md`}
              runId={runId}
              comments={detail.snapshot.pendingComments.filter(
                (c) => c.file === `sprints/${sprint.dirName}/contract.md`
              )}
              onCommentFocus={onCommentFocus}
            />
          ) : (
            <Empty>No contract.md yet — the planner produces it before the executor runs.</Empty>
          )
        ) : null}
        {tab === 'output' ? (
          sprint.outputMd ? (
            <Markdown source={sprint.outputMd} />
          ) : (
            <Empty>Executor has not produced output.md yet.</Empty>
          )
        ) : null}
        {tab === 'verdict' ? (
          sprint.verdictMd ? (
            <Markdown source={sprint.verdictMd} />
          ) : (
            <Empty>No verdict yet — the evaluator runs after the executor reports output.</Empty>
          )
        ) : null}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  present
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  present: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
        active
          ? 'bg-slate-100 text-blue-700'
          : present
            ? 'text-slate-600 hover:text-slate-800'
            : 'text-slate-600'
      }`}
    >
      {label}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-4 text-sm text-slate-500">{children}</div>;
}

/**
 * Backwards-compat wrapper — older callers that imported the original
 * combined timeline + focus still work. New code should use SprintPipStrip
 * and SprintFocus directly so the parent owns focus state.
 */
export function SprintTimeline({ detail }: { detail: RunDetail }) {
  const defaultFocus = useDefaultFocus(detail);
  const [focused, setFocused] = useState<string | null>(defaultFocus);
  useEffect(() => {
    if (!focused || !detail.snapshot.sprints.some((s) => s.dirName === focused)) {
      setFocused(defaultFocus);
    }
  }, [defaultFocus, focused, detail.snapshot.sprints]);

  if (detail.snapshot.sprints.length === 0) {
    return (
      <div className="panel px-4 py-6 text-sm text-slate-600">
        No sprint directories yet. The planner produces them.
      </div>
    );
  }

  const sprint =
    detail.snapshot.sprints.find((s) => s.dirName === focused) ?? detail.snapshot.sprints[0];

  return (
    <div className="space-y-2">
      <SprintPipStrip detail={detail} focusedDirName={focused} onFocus={setFocused} />
      <SprintFocus runId={detail.state.run_id} sprint={sprint} detail={detail} />
    </div>
  );
}
