import { useState } from 'react';
import type { RunDetail, SprintSnapshot } from '../api';
import { CommentableMarkdown } from './CommentableMarkdown';
import { parsePlanSections } from '../lib/plan-diff';
import { formatDuration, formatRelative } from '../lib/format';

/**
 * Render plan.md as the working surface: preamble + one collapsible section
 * per sprint. Each sprint row shows phase + timing in its header; expanding
 * reveals the plan-section prose AND the per-sprint contract.md inline so the
 * operator can drill into "what does the executor actually have to do" without
 * leaving the plan view. The currently-active sprint is open by default.
 *
 * Output.md / verdict.md are intentionally NOT rendered here — the agent
 * loop handles those and a human only needs to scan the contract.
 *
 * Falls back to plain markdown when the plan doesn't follow the
 * `## Sprint N — title` convention.
 */
export function InteractivePlanView({
  planMd,
  detail,
  focusedDirName,
  onFocus,
  onCommentFocus
}: {
  planMd: string;
  detail: RunDetail;
  focusedDirName: string | null;
  onFocus: (dirName: string) => void;
  onCommentFocus?: (commentId: string) => void;
}) {
  const { preamble, sprints: sections } = parsePlanSections(planMd);
  const runId = detail.state.run_id;
  const planComments = detail.snapshot.pendingComments.filter(
    (c) => c.file === 'plan.md'
  );

  if (sections.length === 0) {
    // Plan has no sprint headings — render raw markdown unchanged.
    return (
      <div className="px-4 py-3">
        <CommentableMarkdown
          source={planMd}
          file="plan.md"
          runId={runId}
          comments={planComments}
          onCommentFocus={onCommentFocus}
        />
      </div>
    );
  }

  const sprintByNum = new Map(detail.snapshot.sprints.map((s) => [s.num, s]));
  const cur = detail.state.current_sprint;
  const dispatchingActive = !!(detail.dispatching && !detail.dispatching.finished);

  return (
    <div className="space-y-3 px-4 py-3">
      {preamble ? (
        <CommentableMarkdown
          source={preamble}
          anchorSource={planMd}
          file="plan.md"
          runId={runId}
          comments={planComments}
          onCommentFocus={onCommentFocus}
        />
      ) : null}
      {sections.map((section) => {
        const sprint = sprintByNum.get(section.num);
        const phase = sprint
          ? computePhase(sprint, cur, detail.state.next_role, dispatchingActive)
          : 'pending';
        return (
          <SprintRow
            key={section.num}
            section={section}
            sprint={sprint}
            phase={phase}
            planMd={planMd}
            planComments={planComments}
            runId={runId}
            isActive={!!sprint && sprint.num === cur && cur !== 0}
            isFocused={!!sprint && sprint.dirName === focusedDirName}
            onFocus={() => sprint && onFocus(sprint.dirName)}
            onCommentFocus={onCommentFocus}
          />
        );
      })}
    </div>
  );
}

function SprintRow({
  section,
  sprint,
  phase,
  planMd,
  planComments,
  runId,
  isActive,
  isFocused,
  onFocus,
  onCommentFocus
}: {
  section: { num: number; title: string; body: string };
  sprint: SprintSnapshot | undefined;
  phase: Phase;
  planMd: string;
  planComments: ReturnType<typeof Array.prototype.filter>;
  runId: string;
  isActive: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onCommentFocus?: (id: string) => void;
}) {
  // The active sprint is open by default so the user lands on what's
  // happening right now. Otherwise collapsed to keep the plan scannable.
  const [open, setOpen] = useState<boolean>(isActive || isFocused);
  const contractMd = sprint?.contractMd ?? null;

  const borderCls = isActive
    ? 'border-amber-300 bg-amber-50/40 shadow-sm'
    : phase === 'passed'
      ? 'border-emerald-200 bg-emerald-50/30'
      : phase === 'failed'
        ? 'border-rose-200 bg-rose-50/30'
        : 'border-slate-200 hover:border-slate-300';

  return (
    <section className={`rounded-md border ${borderCls} transition`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          onFocus();
        }}
        className="flex w-full items-center gap-2 rounded-t-md px-3 py-2 text-left"
      >
        <span
          className={`text-slate-500 transition ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${PHASE_DOT[phase]}`}
          aria-hidden
        />
        <span className="text-sm font-semibold text-slate-900">
          Sprint {section.num}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
          · {section.title}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <SprintTiming sprint={sprint} phase={phase} />
          <span
            className={`text-[10px] uppercase tracking-wide ${PHASE_TEXT[phase]}`}
          >
            {PHASE_LABEL[phase]}
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-current/10 px-3 pb-3 pt-2">
          {section.body ? (
            <CommentableMarkdown
              source={section.body}
              anchorSource={planMd}
              file="plan.md"
              runId={runId}
              comments={planComments as never}
              onCommentFocus={onCommentFocus}
            />
          ) : null}
          {contractMd ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                contract.md
              </div>
              <CommentableMarkdown
                source={contractMd}
                file={`sprints/${sprint?.dirName}/contract.md`}
                runId={runId}
                comments={[]}
                onCommentFocus={onCommentFocus}
              />
            </div>
          ) : (
            <div className="mt-3 rounded border border-dashed border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
              No contract.md yet — the planner produces this when sprint
              scope is locked.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// Local phase classification — matches SprintTimeline so colors stay consistent.
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

const PHASE_DOT: Record<Phase, string> = {
  pending: 'bg-slate-200',
  'contract-ready': 'bg-indigo-500/70',
  running: 'bg-amber-400 animate-pulse ring-2 ring-amber-300',
  passed: 'bg-emerald-500',
  failed: 'bg-rose-500'
};

const PHASE_TEXT: Record<Phase, string> = {
  pending: 'text-slate-600',
  'contract-ready': 'text-indigo-600',
  running: 'text-amber-600',
  passed: 'text-emerald-600',
  failed: 'text-rose-500'
};

const PHASE_LABEL: Record<Phase, string> = {
  pending: 'pending',
  'contract-ready': 'contract',
  running: 'running',
  passed: 'passed',
  failed: 'failed'
};

/**
 * Render timing info for a sprint section: duration + age of the terminal
 * event (verdict for done sprints, output for running ones, contract for
 * waiting ones). Helps operators answer "how long did this take" and "when
 * did this happen" without a separate activity log.
 */
function SprintTiming({ sprint, phase }: { sprint: SprintSnapshot | undefined; phase: Phase }) {
  if (!sprint) return null;
  // Duration: contract → verdict (preferred), or contract → output, or contract → now (running).
  const startMs = sprint.contractAt ? Date.parse(sprint.contractAt) : null;
  const endMs = sprint.verdictAt
    ? Date.parse(sprint.verdictAt)
    : sprint.outputAt
      ? Date.parse(sprint.outputAt)
      : null;

  // The "when" we surface: last meaningful event for the sprint.
  const lastAt = sprint.verdictAt ?? sprint.outputAt ?? sprint.contractAt;

  if (!lastAt && phase === 'pending') return null;

  const parts: string[] = [];
  if (startMs !== null && endMs !== null && endMs > startMs) {
    parts.push(formatDuration(endMs - startMs));
  } else if (phase === 'running' && startMs !== null) {
    parts.push(`${formatDuration(Date.now() - startMs)}+`);
  }
  if (lastAt) parts.push(formatRelative(lastAt));

  if (parts.length === 0) return null;
  return (
    <span className="text-[10px] tabular-nums text-slate-500" title={lastAt ?? undefined}>
      {parts.join(' · ')}
    </span>
  );
}
