import { useMemo, useState } from 'react';
import { api, type ConversationEntry, type RunDetail } from '../api';
import { formatRelative } from '../lib/format';
import { Markdown } from './Markdown';

/**
 * Right-rail planner workspace.
 *
 * Tabs (Conversation, Questions), an Auto-iteration banner, a chat thread
 * sourced from the durable server-side planner log, and a composer pinned at
 * the bottom. Conversation entries (user turns + planner replies summarising
 * what was changed) are persisted in <runRoot>/planner-log.jsonl so they
 * survive reloads, server restarts, and other browsers.
 */

export function PlannerRail({
  detail,
  busy,
  canAuto,
  onStartAuto
}: {
  detail: RunDetail;
  busy: boolean;
  canAuto: boolean;
  onStartAuto: () => Promise<void> | void;
}) {
  const runId = detail.state.run_id;
  const planMd = detail.snapshot.planMd ?? '';
  const overviewMd = detail.snapshot.overviewMd ?? '';
  const dispatching = detail.dispatching;
  // The PLANNER rail's "working" state should only light up when the planner
  // itself is dispatched. Executor / evaluator runs (dispatching.role === 'next')
  // are someone else's job — the planner is idle then.
  const plannerWorking =
    !!dispatching && !dispatching.finished && dispatching.role === 'planner';
  // Any role being dispatched still blocks sending a new message — the planner
  // can't compose a reply while the loop is mid-flight.
  const anyDispatchActive = !!dispatching && !dispatching.finished;
  const pendingComments = detail.snapshot.pendingComments ?? [];

  const [tab, setTab] = useState<'conv' | 'q'>('conv');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server-side log is the source of truth; we just keep an optimistic local
  // entry around between "Send" and the next snapshot refresh so the user
  // sees their message instantly even before the SSE re-fetch lands.
  const serverHistory = detail.snapshot.conversation ?? [];
  const [optimistic, setOptimistic] = useState<ConversationEntry[]>([]);
  // Drop any optimistic entries the server has already echoed back to us so
  // we don't render the same turn twice. Matching is timestamp+text — both
  // are generated client-side for the optimistic entry and the server uses
  // its own clock for the durable one, so they can drift by a few hundred
  // ms; falling back to text-equality covers that.
  const history = useMemo<ConversationEntry[]>(() => {
    const stillPending = optimistic.filter(
      (o) => !serverHistory.some((s) => s.role === o.role && s.text === o.text)
    );
    return [...serverHistory, ...stillPending];
  }, [serverHistory, optimistic]);


  // Pull free-form questions from a `## Questions` section in plan.md or
  // overview.md. The planner emits this section when it has decisions it
  // can't make on its own; the UI surfaces them as a checklist with a single
  // shared composer to answer all at once.
  const questions = useMemo(
    () => extractQuestions(planMd) ?? extractQuestions(overviewMd) ?? [],
    [planMd, overviewMd]
  );

  // Sending is blocked while any role is dispatched — even mid-executor runs,
  // we don't want messages racing with an in-flight loop.
  const isBusy = busy || submitting || anyDispatchActive;
  const planLooksReady =
    !!planMd && !plannerWorking && questions.length === 0 && canAuto;

  async function send() {
    const text = message.trim();
    if (!text && pendingComments.length === 0) return;
    setSubmitting(true);
    setError(null);

    // Optimistic append — user sees the message immediately. Once the
    // server-side log writes through and the next snapshot lands, the
    // matching entry in serverHistory replaces this one (we dedupe on
    // role+text in the merge).
    const entry: ConversationEntry = {
      at: new Date().toISOString(),
      role: 'user',
      text,
      ...(pendingComments.length > 0 ? { comments: pendingComments.length } : {})
    };
    setOptimistic((o) => [...o, entry]);
    setMessage('');

    try {
      await api.revisePlan(runId, text);
    } catch (e) {
      setOptimistic((o) => o.filter((m) => m !== entry));
      setMessage(text);
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-gradient-to-b from-slate-50 to-white">
      {/* Header + tabs */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[12px] font-semibold text-blue-700">
              P
            </span>
            <span className="text-sm font-semibold text-slate-900">Planner</span>
            {plannerWorking ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                working
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                idle
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 px-3">
          <TabButton active={tab === 'conv'} onClick={() => setTab('conv')}>
            Conversation
          </TabButton>
          <TabButton active={tab === 'q'} onClick={() => setTab('q')}>
            Questions
            {questions.length > 0 ? (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
                {questions.length}
              </span>
            ) : null}
          </TabButton>
        </div>
      </div>

      {/* Auto-iterate banner — explicit affordance to leave planning and
          enter the executor/evaluator loop. Only surfaces when the plan looks
          ready: a plan exists, planner isn't mid-flight, no unanswered
          questions, and the run state actually allows auto-dispatch. */}
      {planLooksReady ? (
        <div className="border-b border-emerald-300 bg-emerald-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-900">
                Plan is ready
              </div>
              <div className="text-[11px] text-emerald-700">
                Hand the run off to the executor / evaluator loop.
              </div>
            </div>
            <button
              className="shrink-0 rounded-md border border-emerald-700 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60"
              onClick={() => void onStartAuto()}
              disabled={isBusy}
            >
              ▶ Start auto-iteration
            </button>
          </div>
        </div>
      ) : null}

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'conv' ? (
          <ConversationTab
            history={history}
            plannerWorking={plannerWorking}
            pendingCommentCount={pendingComments.length}
            onOpenQuestionsTab={() => setTab('q')}
            questionCount={questions.length}
          />
        ) : (
          <QuestionsTab
            questions={questions}
            planMdPresent={!!planMd}
            runId={runId}
            disabled={anyDispatchActive}
          />
        )}
      </div>

      {/* Composer pinned at the bottom — sibling of the scroll region so it
          permanently anchors the rail and nothing scrolls past or under it. */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)]">
        {error ? (
          <div className="mb-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {error}
          </div>
        ) : null}
        <textarea
          className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            tab === 'q'
              ? 'Answer the planner’s questions, then send'
              : 'Reply or ask the planner…'
          }
          disabled={isBusy}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        {pendingComments.length > 0 ? (
          <div className="mt-1 text-[11px] text-amber-700">
            {pendingComments.length} pending comment
            {pendingComments.length === 1 ? '' : 's'} will be sent with this
            message
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <div className="text-[10px] text-slate-500">⌘/Ctrl + Enter to send</div>
          <button
            className="rounded-md border border-blue-700 bg-blue-700 px-3 py-1 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            onClick={() => void send()}
            disabled={
              isBusy || (!message.trim() && pendingComments.length === 0)
            }
          >
            {submitting
              ? 'Sending…'
              : plannerWorking
                ? 'Planner busy'
                : anyDispatchActive
                  ? 'Run in progress'
                  : 'Send'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px inline-flex items-center px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'border-b-2 border-blue-600 text-blue-700'
          : 'border-b-2 border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function ConversationTab({
  history,
  plannerWorking,
  pendingCommentCount,
  onOpenQuestionsTab,
  questionCount
}: {
  history: ConversationEntry[];
  plannerWorking: boolean;
  pendingCommentCount: number;
  onOpenQuestionsTab: () => void;
  questionCount: number;
}) {
  const empty = history.length === 0;
  return (
    <div className="space-y-2 px-3 py-3">
      {questionCount > 0 ? (
        <button
          type="button"
          onClick={onOpenQuestionsTab}
          className="flex w-full items-center gap-2 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-left text-xs text-indigo-800 hover:bg-indigo-100"
        >
          <span>▣</span>
          <span>
            Planner is waiting on {questionCount} question
            {questionCount === 1 ? '' : 's'}.
          </span>
          <span className="ml-auto text-[11px] underline-offset-2 group-hover:underline">
            View →
          </span>
        </button>
      ) : null}

      {empty ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-500">
          <div className="font-medium text-slate-700">No messages yet</div>
          <div className="mt-1 leading-relaxed">
            Ask the planner to revise the plan, or highlight text in plan.md
            and add a comment. Messages queue until you send.
          </div>
        </div>
      ) : (
        history.map((h, i) => <Message key={i} entry={h} />)
      )}

      {plannerWorking ? (
        <div className="text-xs text-amber-700">planner is working…</div>
      ) : null}
      {pendingCommentCount > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {pendingCommentCount} pending comment
          {pendingCommentCount === 1 ? '' : 's'} waiting to be sent with your
          next message.
        </div>
      ) : null}
    </div>
  );
}

function Message({ entry }: { entry: ConversationEntry }) {
  const isUser = entry.role === 'user';
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        isUser
          ? 'ml-6 border-blue-300 bg-blue-50'
          : 'mr-6 border-slate-200 bg-white'
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-wide ${
          isUser ? 'text-blue-700' : 'text-slate-500'
        }`}
      >
        {entry.role === 'user' ? 'you' : 'planner'} ·{' '}
        {formatRelative(entry.at)}
        {entry.comments ? (
          <span className="ml-2 text-amber-700">
            + {entry.comments} comment{entry.comments === 1 ? '' : 's'}
          </span>
        ) : null}
        {entry.failed ? (
          <span className="ml-2 text-rose-600">· failed</span>
        ) : null}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
        {entry.text || <em className="text-slate-500">(comments only)</em>}
      </div>
    </div>
  );
}

function QuestionsTab({
  questions,
  planMdPresent,
  runId,
  disabled
}: {
  questions: string[];
  planMdPresent: boolean;
  runId: string;
  disabled: boolean;
}) {
  // One textarea state per question. Keyed by the question text itself so the
  // draft survives re-renders even if the questions array is rebuilt — and
  // automatically resets when the planner rewrites the Questions section.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (questions.length === 0) {
    return (
      <div className="px-3 py-3">
        <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
          {planMdPresent
            ? 'No open questions from the planner. When the planner needs a decision it can’t make on its own, it’ll write a "## Questions" section in plan.md and they’ll show up here.'
            : 'No plan yet — questions will appear here when the planner needs a decision from you.'}
        </div>
      </div>
    );
  }

  const filledCount = questions.filter((q) => (answers[q] ?? '').trim().length > 0).length;

  async function submit() {
    const lines: string[] = [
      'Answers to your questions (please apply these to plan.md, then remove the Questions section):',
      ''
    ];
    questions.forEach((q, i) => {
      const a = (answers[q] ?? '').trim();
      lines.push(`${i + 1}. **Q:** ${q.replace(/\n+/g, ' ')}`);
      lines.push(`   **A:** ${a || '_(no answer)_'}`);
      lines.push('');
    });
    setSubmitting(true);
    setError(null);
    try {
      await api.revisePlan(runId, lines.join('\n'));
      setAnswers({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-3 py-3">
      <div className="rounded-md border-2 border-indigo-300 bg-indigo-50/50 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
          <span>
            ▣ {questions.length} question{questions.length === 1 ? '' : 's'} from planner
          </span>
          <span className="font-normal normal-case text-indigo-700/70">
            {filledCount}/{questions.length} answered
          </span>
        </div>
        <p className="mb-3 text-[11px] text-indigo-700/80">
          Answer below — submitting routes all answers to the planner as one
          message and asks it to remove the Questions section once applied.
        </p>
        <ol className="space-y-3 text-sm text-slate-800">
          {questions.map((q, i) => (
            <li key={i} className="rounded-md bg-white px-3 py-2 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Q{i + 1}
              </div>
              <div className="mt-1">
                <Markdown source={q} />
              </div>
              <textarea
                className="mt-2 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:opacity-60"
                rows={2}
                value={answers[q] ?? ''}
                placeholder="Your answer…"
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [q]: e.target.value }))
                }
                disabled={disabled || submitting}
              />
            </li>
          ))}
        </ol>
        {error ? (
          <div className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setAnswers({})}
            disabled={submitting || filledCount === 0}
            className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            Clear answers
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || submitting || filledCount === 0}
            className="rounded-md border border-indigo-700 bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-60"
          >
            {submitting ? 'Sending…' : `Submit ${filledCount} answer${filledCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Free-form question extraction: look for a `## Questions` (or `## Open
 * questions`) section and split its body on top-level bullets (`- ` or `* `
 * at line start) or numbered list items. Falls back to one big block when no
 * bullets are present so a planner that writes a paragraph still surfaces.
 *
 * Returns null when no Questions section exists, so the caller can fall back
 * to other markdown sources.
 */
function extractQuestions(md: string): string[] | null {
  if (!md) return null;
  const m = /(?:^|\n)##+\s*(?:open\s+)?questions?\b[^\n]*\n([\s\S]+?)(?=\n##+\s|\s*$)/i.exec(md);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;
  const items = splitBullets(body);
  return items.length > 0 ? items : [body];
}

function splitBullets(body: string): string[] {
  const lines = body.split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push(text);
    buf = [];
  };
  for (const line of lines) {
    const isItem = /^\s*(?:[-*]|\d+\.)\s+/.test(line);
    if (isItem) {
      flush();
      buf.push(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
    } else if (buf.length > 0) {
      buf.push(line);
    }
  }
  flush();
  return out;
}
