import { useEffect, useMemo, useRef, useState } from 'react';
import {
  chatApi,
  openEventStream,
  type ChatComment,
  type ChatDetail,
  type ChatState,
  type ChatTranscriptMessage,
  type ServerEvent
} from '../api';
import { ChatMessage } from './ChatMessage';
import { Markdown } from './Markdown';
import { JsxArtifactView } from './JsxArtifactView';
import { rangeLabel, truncate } from '../lib/commentAnchor';

/**
 * Three-column interactive chat surface wrapping the `claude` CLI.
 *
 * Left rail: session metadata, tool-call inspector, cost, controls.
 * Center: streaming transcript (user + assistant messages, tool calls).
 *         Assistant text is rendered with ChatMessage so the operator can
 *         highlight passages and attach persistent annotations.
 * Right rail: free-form notes (autosaved markdown) + comment list with
 *             jump-to-message.
 *
 * Streams the assistant's tokens incrementally via SSE `chat_stream` deltas,
 * then settles to the full `chat_message` once the message_stop fires.
 */
export function ChatSession({
  chatId,
  onBack,
  onSwitchTo
}: {
  chatId: string;
  onBack: () => void;
  /** Optional: navigate to a different chat (e.g. a freshly-forked sibling).
   *  Defaults to onBack so the user lands on the chat list. */
  onSwitchTo?: (newChatId: string) => void;
}) {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [pendingStream, setPendingStream] = useState<Record<string, StreamingMessage>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [focusedComment, setFocusedComment] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'artifacts'>('chat');

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    chatApi
      .get(chatId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // SSE subscription.
  useEffect(() => {
    const es = openEventStream(onEvent, { chatId });
    function onEvent(ev: ServerEvent) {
      if (!('chatId' in ev) || ev.chatId !== chatId) return;
      switch (ev.type) {
        case 'chat_state':
          setDetail((prev) => (prev ? { ...prev, state: ev.state } : prev));
          break;
        case 'chat_message':
          setDetail((prev) =>
            prev ? { ...prev, transcript: [...prev.transcript, ev.message] } : prev
          );
          // The full message arrived — clear any partial stream for it.
          setPendingStream((prev) => {
            const id = getMessageId(ev.message);
            if (!id || !prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          break;
        case 'chat_stream':
          setPendingStream((prev) => applyStreamEvent(prev, ev.event));
          break;
        case 'chat_notes':
          setDetail((prev) => (prev ? { ...prev, notesMd: ev.notesMd } : prev));
          break;
        case 'chat_comments':
          setDetail((prev) => (prev ? { ...prev, comments: ev.comments } : prev));
          break;
        case 'chat_result':
          // result clears any unflushed partials for safety
          setPendingStream({});
          break;
        case 'chat_reset':
          // /clear or /compact wiped the transcript on the server. Pull the
          // fresh detail and drop any in-flight stream partials.
          setPendingStream({});
          void chatApi.get(chatId).then(setDetail).catch(() => {});
          break;
        case 'chat_deleted':
          onBack();
          break;
      }
    }
    return () => es.close();
  }, [chatId, onBack]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [detail?.transcript.length, Object.keys(pendingStream).length]);

  const renderable = useMemo(() => {
    if (!detail) return [] as RenderableEntry[];
    return buildRenderable(detail.transcript, pendingStream);
  }, [detail, pendingStream]);

  const commentsByMessage = useMemo(() => {
    const m = new Map<string, ChatComment[]>();
    for (const c of detail?.comments ?? []) {
      const arr = m.get(c.message_id) ?? [];
      arr.push(c);
      m.set(c.message_id, arr);
    }
    return m;
  }, [detail?.comments]);

  // Plans extracted from any ExitPlanMode tool_use in the transcript. Newest
  // last so the artifact panel can reverse-order them.
  const plans = useMemo(() => {
    if (!detail) return [] as PlanArtifact[];
    return extractPlans(detail.transcript);
  }, [detail]);

  // JSX diagrams extracted from ```jsx code fences in assistant text.
  const jsxArtifacts = useMemo(() => {
    if (!detail) return [] as JsxArtifact[];
    return extractJsxArtifacts(detail.transcript);
  }, [detail]);

  const artifacts = useMemo<Artifact[]>(
    () => [
      ...plans.map<Artifact>((p) => ({ kind: 'plan', ...p })),
      ...jsxArtifacts.map<Artifact>((j) => ({ kind: 'jsx', ...j }))
    ],
    [plans, jsxArtifacts]
  );

  async function send() {
    if (!detail) return;
    const text = draft.trim();
    // Queued side-panel comments can carry the turn on their own — allow an
    // empty composer when at least one comment is pending.
    const queuedComments = detail.comments.length;
    if (!text && queuedComments === 0) return;
    // Clear the composer immediately so the operator can keep typing/queuing
    // the next message instead of waiting for the round-trip to finish.
    setDraft('');
    setSending(true);
    setSendError(null);
    try {
      await chatApi.send(chatId, text);
    } catch (e) {
      setSendError((e as Error).message);
      // Restore the draft so the operator doesn't lose what they typed.
      setDraft((d) => (d ? d : text));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!detail) return;
    if (!confirm('End this chat? The subprocess will be killed.')) return;
    await chatApi.stop(chatId);
  }

  async function remove() {
    if (!detail) return;
    if (!confirm('Delete this chat? Transcript, notes, and comments are erased.')) return;
    await chatApi.remove(chatId);
  }

  const [compactBusy, setCompactBusy] = useState(false);
  async function clear() {
    if (!detail) return;
    if (!confirm('Clear the conversation? Notes and comments are kept; transcript and session are wiped.'))
      return;
    try {
      await chatApi.clear(chatId);
    } catch (e) {
      alert(`Clear failed: ${(e as Error).message}`);
    }
  }
  async function compact() {
    if (!detail || compactBusy) return;
    if (!confirm('Compact the conversation? Claude will write a summary, then start a fresh session seeded with it.'))
      return;
    setCompactBusy(true);
    try {
      await chatApi.compact(chatId);
    } catch (e) {
      alert(`Compact failed: ${(e as Error).message}`);
    } finally {
      setCompactBusy(false);
    }
  }

  const [forkBusy, setForkBusy] = useState(false);
  async function fork() {
    if (!detail || forkBusy) return;
    if (
      !confirm(
        'Fork this chat? A sibling chat is created with the same context window. Both can be continued independently.'
      )
    )
      return;
    setForkBusy(true);
    try {
      const { chat } = await chatApi.fork(chatId);
      if (onSwitchTo) onSwitchTo(chat.chat_id);
      else onBack();
    } catch (e) {
      alert(`Fork failed: ${(e as Error).message}`);
    } finally {
      setForkBusy(false);
    }
  }

  if (!detail) {
    return <div className="p-6 text-sm text-slate-500">Loading chat…</div>;
  }

  return (
    <div className="grid h-full grid-cols-[1fr_300px] gap-3 bg-slate-50 p-3">
      {/* Center: tabbed (chat | artifacts) */}
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-3 py-2 backdrop-blur">
          <button
            className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={onBack}
            title="Back"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-slate-900">
              {detail.state.title}
            </div>
            <div className="truncate text-[10px] font-mono text-slate-500">{detail.state.cwd}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-500">
            <div className="flex items-center gap-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot(detail.state.status)}`} />
              {detail.state.status}
            </div>
            <button
              className="rounded border border-slate-200 px-1.5 py-0.5 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
              onClick={clear}
              disabled={detail.state.status === 'ended' || compactBusy}
              title="/clear — wipe transcript & session, keep notes/comments"
            >
              Clear
            </button>
            <button
              className="rounded border border-slate-200 px-1.5 py-0.5 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
              onClick={compact}
              disabled={detail.state.status === 'ended' || compactBusy || detail.transcript.length === 0}
              title="/compact — summarize then restart fresh with the summary"
            >
              {compactBusy ? 'Compacting…' : 'Compact'}
            </button>
            <button
              className="rounded border border-slate-200 px-1.5 py-0.5 hover:border-violet-400 hover:text-violet-700 disabled:opacity-50"
              onClick={fork}
              disabled={
                detail.state.status === 'thinking' ||
                forkBusy ||
                detail.transcript.length === 0
              }
              title="Fork — clone this chat's context into a new sibling you can continue independently"
            >
              {forkBusy ? 'Forking…' : 'Fork'}
            </button>
            <button
              className="rounded border border-slate-200 px-1.5 py-0.5 hover:border-slate-400 hover:text-slate-700"
              onClick={stop}
              disabled={detail.state.status === 'ended'}
              title="End the claude subprocess for this chat"
            >
              End
            </button>
            <button
              className="rounded border border-rose-200 px-1.5 py-0.5 text-rose-600 hover:border-rose-400"
              onClick={remove}
              title="Delete chat (transcript, notes, comments)"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-slate-200 bg-slate-50/70 px-2">
          <TabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>
            Chat
          </TabButton>
          <TabButton
            active={activeTab === 'artifacts'}
            onClick={() => setActiveTab('artifacts')}
            badge={artifacts.length}
            disabled={artifacts.length === 0}
          >
            Artifacts
          </TabButton>
        </div>

        {activeTab === 'chat' ? (
          <>
            <div ref={transcriptRef} className="flex-1 overflow-y-auto bg-slate-50/50 px-3 py-2">
              {renderable.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-[10px] text-slate-400">
                  <div className="mb-1 text-xl">💬</div>
                  <div>Type a message below to start.</div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
                  {renderable.map((entry) => (
                    <TranscriptEntry
                      key={entry.key}
                      entry={entry}
                      chatId={chatId}
                      comments={commentsByMessage.get(entry.id ?? '') ?? []}
                      onCommentFocus={(cid) => setFocusedComment(cid)}
                      onJumpToArtifacts={() => setActiveTab('artifacts')}
                    />
                  ))}
                  {detail.state.status === 'thinking' && Object.keys(pendingStream).length === 0 ? (
                    <ThinkingIndicator />
                  ) : null}
                </div>
              )}
            </div>
            <ChatComposer
              draft={draft}
              setDraft={setDraft}
              onSend={send}
              sending={sending}
              disabled={detail.state.status === 'ended'}
              error={sendError}
              queuedComments={detail.comments.length}
            />
          </>
        ) : (
          <ChatArtifactsTab
            chatId={chatId}
            artifacts={artifacts}
            comments={detail.comments}
            onCommentFocus={(cid) => setFocusedComment(cid)}
          />
        )}
      </div>

      {/* Right rail: notes + comments (collapsible notes) */}
      <ChatSidePanel
        chatId={chatId}
        notesMd={detail.notesMd}
        comments={detail.comments}
        focused={focusedComment}
        onFocus={setFocusedComment}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge,
  disabled
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-1 border-b-2 px-3 py-1.5 text-[10px] font-medium transition ${
        disabled
          ? 'cursor-not-allowed border-transparent text-slate-300'
          : active
            ? 'border-amber-500 text-amber-700'
            : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{children}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ChatArtifactsTab({
  chatId,
  artifacts,
  comments,
  onCommentFocus
}: {
  chatId: string;
  artifacts: Artifact[];
  comments: ChatComment[];
  onCommentFocus: (id: string) => void;
}) {
  // Newest first; the most-recent artifact is the one the operator is reviewing.
  const ordered = useMemo(() => [...artifacts].reverse(), [artifacts]);
  const [openId, setOpenId] = useState<string | null>(ordered[0]?.id ?? null);
  useEffect(() => {
    setOpenId(ordered[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered[0]?.id]);

  if (ordered.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50/50 text-center text-[10px] text-slate-400">
        No artifacts yet — ask Claude for a plan or a ```jsx diagram.
      </div>
    );
  }

  const active = ordered.find((a) => a.id === openId) ?? ordered[0];

  return (
    <div className="flex flex-1 min-h-0 bg-slate-50/50">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
        <ul>
          {ordered.map((a, idx) => {
            const isActive = openId === a.id;
            const aComments = comments.filter((c) => c.message_id === a.id);
            return (
              <li
                key={a.id}
                className={`cursor-pointer border-b border-slate-100 px-3 py-1.5 text-[10px] last:border-b-0 ${
                  isActive ? 'bg-amber-50' : 'hover:bg-slate-50'
                }`}
                onClick={() => setOpenId(a.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">
                    <ArtifactKindBadge kind={a.kind} />
                    <span className="truncate font-medium text-slate-800">{a.title}</span>
                  </span>
                  <span className="shrink-0 text-[9px] text-slate-400">
                    #{ordered.length - idx}
                  </span>
                </div>
                {aComments.length > 0 ? (
                  <div className="mt-0.5 text-[9px] text-amber-700">
                    {aComments.length} comment{aComments.length === 1 ? '' : 's'}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
        {active ? (
          <ArtifactView
            chatId={chatId}
            artifact={active}
            comments={comments.filter((c) => c.message_id === active.id)}
            onCommentFocus={onCommentFocus}
          />
        ) : null}
      </div>
    </div>
  );
}

function ArtifactKindBadge({ kind }: { kind: Artifact['kind'] }) {
  if (kind === 'plan') {
    return (
      <span className="inline-block rounded bg-amber-100 px-1 text-[8px] font-semibold uppercase tracking-wide text-amber-700">
        plan
      </span>
    );
  }
  return (
    <span className="inline-block rounded bg-violet-100 px-1 text-[8px] font-semibold uppercase tracking-wide text-violet-700">
      jsx
    </span>
  );
}

function ArtifactView({
  chatId,
  artifact,
  comments,
  onCommentFocus
}: {
  chatId: string;
  artifact: Artifact;
  comments: ChatComment[];
  onCommentFocus: (id: string) => void;
}) {
  if (artifact.kind === 'plan') {
    return (
      <div className="mx-auto max-w-3xl text-[11px]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold text-slate-900">{artifact.title}</h2>
          <span className="shrink-0 text-[10px] text-slate-500">
            {comments.length} comment{comments.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
          <ChatMessage
            chatId={chatId}
            messageId={artifact.id}
            source={artifact.plan}
            comments={comments}
            onCommentFocus={onCommentFocus}
          />
        </div>
      </div>
    );
  }
  // JSX
  return (
    <div className="mx-auto max-w-4xl text-[11px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-semibold text-slate-900">{artifact.title}</h2>
        <span className="shrink-0 text-[10px] text-slate-500">
          {comments.length} comment{comments.length === 1 ? '' : 's'}
        </span>
      </div>
      <JsxArtifactView source={artifact.source} />
      <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-[11px] shadow-sm">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Source
        </summary>
        <div className="mt-2">
          <ChatMessage
            chatId={chatId}
            messageId={artifact.id}
            source={'```jsx\n' + artifact.source + '\n```'}
            comments={comments}
            onCommentFocus={onCommentFocus}
          />
        </div>
      </details>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
      </span>
      <span>Claude is thinking…</span>
    </div>
  );
}

// -------------------------- Left rail --------------------------

function statusDot(s: ChatState['status']): string {
  switch (s) {
    case 'thinking':
      return 'bg-amber-500 animate-pulse';
    case 'error':
      return 'bg-rose-500';
    case 'ended':
      return 'bg-slate-300';
    default:
      return 'bg-emerald-500';
  }
}

// -------------------------- Composer --------------------------

function ChatComposer({
  draft,
  setDraft,
  onSend,
  sending,
  disabled,
  error,
  queuedComments
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
  error: string | null;
  /** Number of side-panel comments that will be attached to the next send. */
  queuedComments: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Grow the composer with its content, between MIN_PX and MAX_PX. Past the
  // cap the textarea scrolls internally instead of pushing the transcript.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MIN_PX = 64;
    const MAX_PX = 240;
    el.style.height = 'auto';
    el.style.height = Math.max(MIN_PX, Math.min(el.scrollHeight, MAX_PX)) + 'px';
  }, [draft]);
  const canSend = draft.trim().length > 0 || queuedComments > 0;
  return (
    <div className="border-t border-slate-200 bg-white p-2">
      {error ? (
        <div className="mb-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
          {error}
        </div>
      ) : null}
      {queuedComments > 0 ? (
        <div className="mx-auto mb-1 max-w-3xl rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-center text-[10px] text-amber-800">
          {queuedComments} comment{queuedComments === 1 ? '' : 's'} will attach to the next message
        </div>
      ) : null}
      <div className="mx-auto flex max-w-3xl flex-col gap-1">
        <div className="relative rounded-lg border border-slate-300 bg-white shadow-sm transition focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200">
          <textarea
            ref={textareaRef}
            className="block w-full resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-3 py-2 pr-20 text-[13px] leading-snug placeholder:text-slate-400 focus:outline-none focus:ring-0"
            style={{ height: 64 }}
            placeholder={
              disabled
                ? 'Chat has ended.'
                : queuedComments > 0
                  ? 'Optional message (comments will be sent without it)…'
                  : 'Message Claude…'
            }
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!disabled && !sending && canSend) onSend();
              }
            }}
          />
          <button
            className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[10px] font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={onSend}
            disabled={disabled || sending || !canSend}
          >
            {sending ? 'Sending…' : 'Send ⌘↩'}
          </button>
        </div>
        <div className="text-center text-[10px] text-slate-400">
          ⌘+Enter to send · highlight Claude's reply to comment
        </div>
      </div>
    </div>
  );
}

// -------------------------- Side panel --------------------------

function ChatSidePanel({
  chatId,
  notesMd,
  comments,
  focused,
  onFocus
}: {
  chatId: string;
  notesMd: string;
  comments: ChatComment[];
  focused: string | null;
  onFocus: (id: string) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(true);
  const [draft, setDraft] = useState(notesMd);
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef(notesMd);

  // Sync local draft when the source-of-truth changes from outside (e.g.
  // another tab saved). Only overwrite if the operator hasn't dirtied locally.
  useEffect(() => {
    if (draft === lastSavedRef.current) {
      setDraft(notesMd);
      lastSavedRef.current = notesMd;
    }
  }, [notesMd]);

  // Debounced autosave.
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    setSaving(true);
    const handle = window.setTimeout(async () => {
      try {
        await chatApi.saveNotes(chatId, draft);
        lastSavedRef.current = draft;
      } catch {
        /* will retry on next change */
      } finally {
        setSaving(false);
      }
    }, 600);
    return () => window.clearTimeout(handle);
  }, [draft, chatId]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div
        className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
          notesOpen ? 'min-h-0 flex-1' : 'shrink-0'
        }`}
      >
        <button
          className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-1.5 hover:bg-slate-50"
          onClick={() => setNotesOpen((v) => !v)}
        >
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            <span className="text-slate-400">{notesOpen ? '▾' : '▸'}</span>
            Notes
          </div>
          <div className="text-[9px] text-slate-400">
            {notesOpen ? (saving ? '● saving' : '✓ saved') : draft ? `${draft.length} chars` : 'empty'}
          </div>
        </button>
        {notesOpen ? (
          <textarea
            className="flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-[10px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
            placeholder="Personal scratchpad. Never sent to Claude."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : null}
      </div>

      <div
        className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
          notesOpen ? 'max-h-[40%] min-h-0' : 'min-h-0 flex-1'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Comments
          </div>
          <div className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
            {comments.length}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 text-[10px]">
          {comments.length === 0 ? (
            <div className="px-2 py-4 text-center text-slate-400">
              Highlight Claude's reply or a plan to comment.
            </div>
          ) : (
            <ul className="space-y-1">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className={`cursor-pointer rounded-md border p-1.5 transition ${
                    focused === c.id
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}
                  onClick={() => {
                    onFocus(c.id);
                    const target = document.querySelector(`[data-comment-id="${c.id}"]`);
                    if (target && 'scrollIntoView' in target) {
                      (target as HTMLElement).scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                      });
                    }
                  }}
                >
                  <div className="text-[9px] uppercase tracking-wide text-slate-400">
                    {rangeLabel(c.anchor)}
                  </div>
                  <div className="mt-0.5 line-clamp-2 border-l-2 border-amber-300 pl-1.5 italic text-slate-500">
                    {truncate(c.anchor.quoted_text, 100)}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-800">{c.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------- Transcript rendering --------------------------

interface StreamingMessage {
  messageId: string;
  text: string;
  thinking: string;
}

interface RenderableEntry {
  key: string;
  kind: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'partial_assistant';
  id?: string;
  text?: string;
  thinking?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  systemSubtype?: string;
}

function getMessageId(m: ChatTranscriptMessage): string | undefined {
  if ('uuid' in m && typeof m.uuid === 'string') return m.uuid;
  if ('message' in m && m.message && typeof m.message === 'object') {
    const inner = m.message as { id?: unknown };
    if (typeof inner.id === 'string') return inner.id;
  }
  return undefined;
}

function applyStreamEvent(
  prev: Record<string, StreamingMessage>,
  ev: unknown
): Record<string, StreamingMessage> {
  const obj = ev as {
    type?: string;
    event?: {
      type?: string;
      delta?: { type?: string; text?: string; thinking?: string };
      message?: { id?: string };
    };
  };
  if (obj?.type !== 'stream_event' || !obj.event) return prev;
  const msgId = obj.event.message?.id;
  // For text and thinking deltas there's no message_id on the delta itself —
  // we route by the most-recent message_start id. Track that in a synthetic
  // "current" slot, then settle it when message_stop arrives.
  if (obj.event.type === 'message_start' && msgId) {
    return { ...prev, [msgId]: { messageId: msgId, text: '', thinking: '' }, __current: { messageId: msgId, text: '', thinking: '' } };
  }
  const current = prev.__current;
  if (!current) return prev;
  if (obj.event.type === 'content_block_delta' && obj.event.delta) {
    const d = obj.event.delta;
    const updated: StreamingMessage = { ...current };
    if (d.type === 'text_delta' && d.text) updated.text += d.text;
    if (d.type === 'thinking_delta' && d.thinking) updated.thinking += d.thinking;
    return { ...prev, [updated.messageId]: updated, __current: updated };
  }
  if (obj.event.type === 'message_stop') {
    // Drop the synthetic pointer; the assistant `chat_message` will arrive
    // shortly and the per-id partial gets cleaned up there.
    const { __current: _, ...rest } = prev;
    return rest;
  }
  return prev;
}

function buildRenderable(
  transcript: ChatTranscriptMessage[],
  pendingStream: Record<string, StreamingMessage>
): RenderableEntry[] {
  const out: RenderableEntry[] = [];
  const seenMessageIds = new Set<string>();
  for (let i = 0; i < transcript.length; i++) {
    const m = transcript[i];
    if (m.type === 'user') {
      const text = collectUserText(m);
      const toolResult = collectToolResult(m);
      if (toolResult) {
        out.push({ key: `m-${i}-tr`, kind: 'tool_result', toolResult });
      } else if (text) {
        out.push({ key: `m-${i}-u`, kind: 'user', text });
      }
      continue;
    }
    if (m.type === 'assistant' && m.message) {
      const mid = getMessageId(m);
      if (mid) seenMessageIds.add(mid);
      for (let j = 0; j < m.message.content.length; j++) {
        const block = m.message.content[j];
        if (block.type === 'text' && block.text) {
          out.push({ key: `m-${i}-${j}`, kind: 'assistant', id: mid, text: block.text });
        } else if (block.type === 'thinking' && block.thinking) {
          out.push({ key: `m-${i}-${j}`, kind: 'assistant', id: mid, thinking: block.thinking });
        } else if (block.type === 'tool_use') {
          out.push({
            key: `m-${i}-${j}`,
            kind: 'tool_call',
            toolName: block.name,
            toolInput: block.input
          });
        }
      }
      continue;
    }
    if (m.type === 'system') {
      out.push({ key: `m-${i}-s`, kind: 'system', systemSubtype: m.subtype });
      continue;
    }
  }
  // Append any streaming partials that haven't settled into the transcript yet.
  for (const [id, sm] of Object.entries(pendingStream)) {
    if (id === '__current') continue;
    if (seenMessageIds.has(id)) continue;
    if (sm.text.length === 0 && sm.thinking.length === 0) continue;
    out.push({ key: `p-${id}`, kind: 'partial_assistant', id, text: sm.text, thinking: sm.thinking });
  }
  return out;
}

// ------------------------ Artifacts ------------------------

interface PlanArtifact {
  /** tool_use_id from the ExitPlanMode call — stable, doubles as comment message_id. */
  id: string;
  title: string;
  plan: string;
  /** Index in the transcript so the panel can show newest first. */
  index: number;
}

interface JsxArtifact {
  /** Synthetic id derived from message_id + block index. */
  id: string;
  title: string;
  source: string;
  index: number;
}

type Artifact =
  | ({ kind: 'plan' } & PlanArtifact)
  | ({ kind: 'jsx' } & JsxArtifact);

function extractPlans(transcript: ChatTranscriptMessage[]): PlanArtifact[] {
  const out: PlanArtifact[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const m = transcript[i];
    if (m.type !== 'assistant' || !('message' in m) || !m.message) continue;
    for (const block of m.message.content) {
      if (block.type !== 'tool_use' || block.name !== 'ExitPlanMode') continue;
      const input = block.input as { plan?: unknown } | null;
      const plan = input?.plan;
      if (typeof plan !== 'string' || plan.trim().length === 0) continue;
      // tool_use blocks have an `id` field (sibling of `name`/`input`) that
      // doubles as our stable artifact id + comment anchor message_id.
      const tid = (block as { id?: string }).id ?? `plan-${i}`;
      out.push({ id: tid, title: firstLineOrTitle(plan), plan, index: i });
    }
  }
  return out;
}

/**
 * Walk every assistant text block looking for ```jsx (or ```tsx, ```diagram)
 * fenced code. Each match becomes a JSX artifact rendered live in the
 * Artifacts tab. Title is derived from the first comment line in the block,
 * else "JSX Diagram".
 */
function extractJsxArtifacts(transcript: ChatTranscriptMessage[]): JsxArtifact[] {
  const out: JsxArtifact[] = [];
  const fenceRe = /```(?:jsx|tsx|diagram)\s*\n([\s\S]*?)```/g;
  for (let i = 0; i < transcript.length; i++) {
    const m = transcript[i];
    if (m.type !== 'assistant' || !('message' in m) || !m.message) continue;
    const mid = (m.message as { id?: string }).id ?? `msg-${i}`;
    let blockIdx = 0;
    for (const block of m.message.content) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      let match: RegExpExecArray | null;
      // Reset the regex for each new text block.
      fenceRe.lastIndex = 0;
      while ((match = fenceRe.exec(block.text)) !== null) {
        const source = match[1];
        if (!source || !source.trim()) continue;
        out.push({
          id: `${mid}-jsx-${blockIdx}`,
          title: jsxTitle(source),
          source,
          index: i
        });
        blockIdx++;
      }
    }
  }
  return out;
}

/**
 * Remove ```jsx (or ```tsx, ```diagram) fences from assistant text — they're
 * rendered live in the Artifacts tab, no need to also dump the source in the
 * chat bubble. Returns the cleaned text plus a count of fences removed so the
 * caller can show a "↗ Artifacts" pointer.
 */
function stripJsxFences(text: string): { text: string; removed: number } {
  let removed = 0;
  let cleaned = text.replace(/```(?:jsx|tsx|diagram)\s*\n[\s\S]*?```\s*/g, () => {
    removed += 1;
    return '';
  });
  // Streaming case: an in-progress jsx fence has no closing ``` yet. Drop
  // everything from the opening fence onward so the source doesn't flash in
  // the chat bubble while the artifact is still being generated.
  const openIdx = cleaned.search(/```(?:jsx|tsx|diagram)\b/);
  if (openIdx !== -1) {
    cleaned = cleaned.slice(0, openIdx);
    removed += 1;
  }
  return { text: cleaned.trim().length === 0 ? '' : cleaned, removed };
}

function jsxTitle(src: string): string {
  // Prefer a leading `// Title: foo` or first non-empty comment.
  const titleLine = src.match(/^\s*\/\/\s*Title:\s*(.+)$/m)?.[1];
  if (titleLine) return titleLine.trim();
  const firstComment = src.match(/^\s*\/\/\s*(.+)$/m)?.[1];
  if (firstComment) return firstComment.trim();
  // Function/component name?
  const fnName = src.match(/function\s+([A-Z]\w+)/)?.[1];
  if (fnName) return fnName;
  return 'JSX Diagram';
}

function collectUserText(m: ChatTranscriptMessage): string | null {
  if (m.type !== 'user' || !('message' in m) || !m.message) return null;
  // Distinguish operator-typed messages (harness writes them with
  // `_harness_at`) from CLI-injected user turns (skill content, internal
  // bookkeeping). Only operator messages render as user bubbles; CLI-injected
  // text would otherwise drop the entire skill prompt into the chat as if
  // the user typed it.
  if (!('_harness_at' in m) || !m._harness_at) return null;
  const parts: string[] = [];
  for (const c of m.message.content) {
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function collectToolResult(m: ChatTranscriptMessage): unknown | null {
  if (m.type !== 'user' || !('message' in m) || !m.message) return null;
  for (const c of m.message.content) {
    if (c.type === 'tool_result') {
      return { tool_use_id: c.tool_use_id, content: c.content };
    }
  }
  return null;
}

function TranscriptEntry({
  entry,
  chatId,
  comments,
  onCommentFocus,
  onJumpToArtifacts
}: {
  entry: RenderableEntry;
  chatId: string;
  comments: ChatComment[];
  onCommentFocus: (id: string) => void;
  onJumpToArtifacts?: () => void;
}) {
  if (entry.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-blue-600 px-2.5 py-1 text-[11px] text-white shadow-sm">
          <div className="whitespace-pre-wrap leading-snug">{entry.text}</div>
        </div>
      </div>
    );
  }
  if (entry.kind === 'assistant' && entry.text && entry.id) {
    const stripped = stripJsxFences(entry.text);
    const hasProse = stripped.text.length > 0;
    if (!hasProse && stripped.removed === 0) return null;
    return (
      <div className="flex justify-start gap-1.5">
        <ClaudeAvatar />
        <div className="min-w-0 max-w-[85%] rounded-xl rounded-tl-sm bg-white px-2.5 py-1.5 text-[11px] leading-snug text-slate-800 shadow-sm ring-1 ring-slate-200">
          {hasProse ? (
            <ChatMessage
              chatId={chatId}
              messageId={entry.id}
              source={stripped.text}
              comments={comments}
              onCommentFocus={onCommentFocus}
            />
          ) : null}
          {stripped.removed > 0 && onJumpToArtifacts ? (
            <button
              className={`inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:border-violet-400 ${
                hasProse ? 'mt-1' : ''
              }`}
              onClick={onJumpToArtifacts}
              title="Open in Artifacts tab"
            >
              JSX Artifact{stripped.removed > 1 ? `s (${stripped.removed})` : ''} ↗
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (entry.kind === 'assistant' && entry.thinking) {
    return (
      <div className="flex justify-start gap-2">
        <ClaudeAvatar dim />
        <details className="max-w-[85%] rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
          <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            thinking
          </summary>
          <div className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-snug">
            {entry.thinking}
          </div>
        </details>
      </div>
    );
  }
  if (entry.kind === 'partial_assistant') {
    const stripped = entry.text ? stripJsxFences(entry.text) : { text: '', removed: 0 };
    return (
      <div className="flex justify-start gap-1.5">
        <ClaudeAvatar pulsing />
        <div className="min-w-0 max-w-[85%] rounded-xl rounded-tl-sm bg-white px-2.5 py-1.5 text-[11px] leading-snug text-slate-800 shadow-sm ring-1 ring-slate-200">
          {stripped.text ? (
            <div className="whitespace-pre-wrap">{stripped.text}</div>
          ) : null}
          {stripped.removed > 0 && !stripped.text ? (
            <div className="text-[10px] italic text-violet-600">Generating JSX artifact…</div>
          ) : null}
          {entry.thinking && !stripped.text && stripped.removed === 0 ? (
            <div className="whitespace-pre-wrap text-[10px] italic text-slate-400">
              {entry.thinking.slice(-200)}
            </div>
          ) : null}
          <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-slate-400 align-middle" />
        </div>
      </div>
    );
  }
  if (entry.kind === 'tool_call') {
    // Only interactive tool calls render inline. Generic tool calls (Read,
    // Bash, Edit, …) are hidden so the transcript isn't drowned by a massive
    // list — the assistant's next message describes the outcome.
    if (entry.toolName === 'AskUserQuestion') {
      return <AskUserQuestionView input={entry.toolInput} />;
    }
    if (entry.toolName === 'ExitPlanMode') {
      return <ExitPlanModeView input={entry.toolInput} onJumpToArtifacts={onJumpToArtifacts} />;
    }
    return null;
  }
  // Tool results are not rendered — they're noise. The assistant's next
  // message describes the outcome.
  if (entry.kind === 'tool_result') {
    return null;
  }
  return null;
}

interface AskUserQuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
}

function AskUserQuestionView({ input }: { input: unknown }) {
  // Tool inputs occasionally arrive with `questions` as a JSON string (when
  // the model emits it that way) rather than an array. Be defensive: parse,
  // then guard, then filter.
  const raw = (input as { questions?: unknown } | null)?.questions;
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      /* fall through to empty */
    }
  }
  const questions = arr.filter(
    (q): q is AskUserQuestionItem =>
      !!q && typeof (q as AskUserQuestionItem).question === 'string'
  );
  if (questions.length === 0) return null;
  return (
    <div className="flex justify-start gap-2">
      <ClaudeAvatar />
      <div className="min-w-0 max-w-[85%] space-y-2 rounded-xl rounded-tl-sm border border-indigo-200 bg-indigo-50/60 p-2.5 text-[10px] shadow-sm">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-indigo-700">
          Claude wants to ask
        </div>
        {questions.map((q, i) => (
          <div key={i} className="space-y-1.5">
            <div className="font-medium leading-snug text-slate-900">{q.question}</div>
            {q.options && q.options.length > 0 ? (
              <ul className="space-y-1">
                {q.options.map((opt, j) => (
                  <li
                    key={j}
                    className="rounded-md border border-indigo-100 bg-white px-2 py-1 text-[10px]"
                  >
                    <div className="font-medium text-slate-800">{opt.label}</div>
                    {opt.description ? (
                      <div className="mt-0.5 leading-snug text-slate-500">{opt.description}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        <div className="text-[10px] italic text-indigo-700/70">
          Answer in the composer below.
        </div>
      </div>
    </div>
  );
}

function ExitPlanModeView({
  input,
  onJumpToArtifacts
}: {
  input: unknown;
  onJumpToArtifacts?: () => void;
}) {
  const plan = (input as { plan?: string } | null)?.plan;
  if (typeof plan !== 'string' || plan.trim().length === 0) return null;
  const title = firstLineOrTitle(plan);
  // Plans live in the Artifacts tab where they get the full width for review.
  // The inline pointer just hints + lets the operator jump there.
  return (
    <div className="flex justify-start gap-2">
      <ClaudeAvatar />
      <button
        className="min-w-0 max-w-[85%] cursor-pointer rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1 text-left text-[10px] shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
        onClick={onJumpToArtifacts}
        title="Open in Artifacts tab"
      >
        <div className="flex items-center gap-1">
          <span className="font-semibold uppercase tracking-wide text-amber-700">Plan</span>
          <span className="text-amber-700/60">↗ Artifacts</span>
        </div>
        <div className="mt-0.5 truncate font-medium text-slate-800">{title}</div>
      </button>
    </div>
  );
}

function firstLineOrTitle(md: string): string {
  const heading = md.match(/^#{1,6}\s+(.+)$/m)?.[1];
  if (heading) return heading.trim();
  const line = md.split('\n').find((l) => l.trim().length > 0);
  return (line ?? 'Untitled plan').slice(0, 120);
}

function ClaudeAvatar({ dim, pulsing }: { dim?: boolean; pulsing?: boolean } = {}) {
  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm ${
        dim ? 'bg-slate-400' : 'bg-gradient-to-br from-orange-500 to-amber-600'
      } ${pulsing ? 'animate-pulse' : ''}`}
      title="Claude"
    >
      C
    </div>
  );
}

