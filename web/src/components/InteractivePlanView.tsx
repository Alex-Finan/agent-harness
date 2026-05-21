import type { RunDetail, SprintSnapshot } from '../api';
import { Markdown } from './Markdown';
import { CommentableMarkdown } from './CommentableMarkdown';
import { parsePlanSections } from '../lib/plan-diff';
import { formatDuration, formatRelative } from '../lib/format';

/**
 * Render plan.md so the plan IS the navigation: each "## Sprint N — title"
 * heading becomes a clickable row with a phase pip beside it. Clicking
 * focuses the matching sprint in the detail pane on the right.
 *
 * Falls back to a plain markdown render when the plan doesn't follow the
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
  const planComments = detail.snapshot.pendingComments.filter((c) => c.file === 'plan.md');

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
    <div className="space-y-4 px-4 py-3">
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
        const isFocused = sprint && sprint.dirName === focusedDirName;
        return (
          <section
            key={section.num}
            className={`rounded-md border transition ${
              isFocused
                ? 'border-blue-300 bg-blue-50/40'
                : 'border-transparent hover:border-slate-200'
            }`}
          >
            <button
              onClick={() => sprint && onFocus(sprint.dirName)}
              disabled={!sprint}
              className="flex w-full items-center gap-2 rounded-t-md px-3 py-1.5 text-left disabled:cursor-default"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${PHASE_DOT[phase]}`}
                aria-hidden
              />
              <span className="text-base font-semibold text-slate-900">
                Sprint {section.num}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-medium text-slate-700">
                · {section.title}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <SprintTiming sprint={sprint} phase={phase} />
                <span className={`text-[10px] uppercase tracking-wide ${PHASE_TEXT[phase]}`}>
                  {PHASE_LABEL[phase]}
                </span>
              </span>
            </button>
            {section.body ? (
              <div className="px-3 pb-2">
                <CommentableMarkdown
                  source={section.body}
                  anchorSource={planMd}
                  file="plan.md"
                  runId={runId}
                  comments={planComments}
                  onCommentFocus={onCommentFocus}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
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
