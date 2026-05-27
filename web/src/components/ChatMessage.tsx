import { useEffect, useRef, useState } from 'react';
import type { ChatComment, CommentAnchor } from '../api';
import { chatApi } from '../api';
import { Markdown } from './Markdown';
import {
  locateAnchor,
  rangeLabel,
  truncate,
  wrapFirstOccurrence
} from '../lib/commentAnchor';

interface HoverState {
  commentId: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

interface PendingSelection {
  anchor: CommentAnchor;
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Renders a single assistant message's markdown text with selection-driven
 * commenting. Comments persist forever in the chat session (unlike planner
 * pending-comments which are short-lived). Each comment is anchored to a
 * specific message_id + line/col coords within that message's rendered text.
 *
 * Mirrors CommentableMarkdown semantically but plugged into chatApi instead of
 * the planner's pending-comments API.
 */
export function ChatMessage({
  chatId,
  messageId,
  source,
  comments,
  onCommentFocus
}: {
  chatId: string;
  messageId: string;
  source: string;
  /** All chat comments anchored to THIS message_id. */
  comments: ChatComment[];
  onCommentFocus?: (commentId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [composing, setComposing] = useState<PendingSelection | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  function scheduleHoverClear() {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHover(null), 180);
  }
  function cancelHoverClear() {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  // selection -> "+ Comment" pill
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function selectionIntersects(range: Range): boolean {
      if (!container) return false;
      return (
        container.contains(range.startContainer) ||
        container.contains(range.endContainer) ||
        range.commonAncestorContainer === container
      );
    }
    function onMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPending(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!selectionIntersects(range)) {
        setPending(null);
        return;
      }
      const text = sel.toString();
      if (!text.trim()) {
        setPending(null);
        return;
      }
      const anchor = locateAnchor(source, text);
      if (!anchor) {
        setPending(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setPending({
        anchor,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      });
    }
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [source]);

  // Apply highlights for this message's comments after every render.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Remove stale marks first (so re-renders don't double-wrap).
    root.querySelectorAll('mark.comment-anchor').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    for (const c of comments) {
      wrapFirstOccurrence(root, c.anchor.quoted_text, c.id);
    }
  }, [comments, source]);

  // Hover / click on highlights.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function getMark(e: Event): HTMLElement | null {
      let el = e.target as HTMLElement | null;
      while (el && el !== container) {
        if (el.tagName === 'MARK' && el.classList.contains('comment-anchor')) return el;
        el = el.parentElement;
      }
      return null;
    }
    function onOver(e: MouseEvent) {
      const mark = getMark(e);
      if (!mark) return;
      cancelHoverClear();
      const cid = mark.dataset.commentId;
      if (!cid) return;
      const rect = mark.getBoundingClientRect();
      setHover({
        commentId: cid,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      });
    }
    function onOut(e: MouseEvent) {
      const mark = getMark(e);
      if (!mark) return;
      scheduleHoverClear();
    }
    function onClick(e: MouseEvent) {
      const mark = getMark(e);
      if (!mark) return;
      const cid = mark.dataset.commentId;
      if (!cid) return;
      setPinned((prev) => (prev === cid ? null : cid));
      if (onCommentFocus) onCommentFocus(cid);
    }
    container.addEventListener('mouseover', onOver);
    container.addEventListener('mouseout', onOut);
    container.addEventListener('click', onClick);
    return () => {
      container.removeEventListener('mouseover', onOver);
      container.removeEventListener('mouseout', onOut);
      container.removeEventListener('click', onClick);
    };
  }, [onCommentFocus]);

  useEffect(() => () => cancelHoverClear(), []);

  useEffect(() => {
    if (pinned && !comments.some((c) => c.id === pinned)) setPinned(null);
    if (hover && !comments.some((c) => c.id === hover.commentId)) setHover(null);
  }, [comments, pinned, hover]);

  async function save() {
    if (!composing) return;
    setSaving(true);
    setError(null);
    try {
      await chatApi.addComment(chatId, {
        message_id: messageId,
        anchor: composing.anchor,
        body: draft.trim()
      });
      setComposing(null);
      setDraft('');
      window.getSelection()?.removeAllRanges();
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const activeId = pinned ?? hover?.commentId ?? null;
  const activeComment = activeId ? comments.find((c) => c.id === activeId) ?? null : null;
  const activeRect = hover && hover.commentId === activeId ? hover.rect : null;

  return (
    <div className="relative">
      <div ref={containerRef} className="markdown-compact">
        <Markdown source={source} />
      </div>

      {pending && !composing ? (
        <button
          className="fixed z-50 rounded-md bg-blue-700 px-2 py-1 text-xs font-medium text-white shadow-lg hover:bg-blue-600"
          style={{
            left: Math.min(pending.rect.right, window.innerWidth - 100),
            top: pending.rect.bottom + 4
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            setComposing(pending);
            setDraft('');
          }}
        >
          + Comment
        </button>
      ) : null}

      {activeComment ? (
        <div
          className="fixed z-40 w-80 rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl"
          style={{
            left: activeRect ? Math.min(activeRect.left, window.innerWidth - 320) : 20,
            top: activeRect ? activeRect.bottom + 4 : 60
          }}
          onMouseEnter={cancelHoverClear}
          onMouseLeave={scheduleHoverClear}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {rangeLabel(activeComment.anchor)}
            </span>
            {pinned ? (
              <button
                className="text-[11px] text-slate-500 hover:text-slate-800"
                onClick={() => setPinned(null)}
                title="Close"
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="whitespace-pre-wrap text-slate-800">{activeComment.body}</div>
          <div className="mt-2 flex justify-end gap-2 text-[11px]">
            <button
              className="text-rose-500 hover:text-rose-700"
              onClick={async () => {
                try {
                  await chatApi.deleteComment(chatId, activeComment.id);
                  setPinned(null);
                } catch {
                  /* the right-rail surfaces the error */
                }
              }}
            >
              delete
            </button>
          </div>
        </div>
      ) : null}

      {composing ? (
        <div
          className="fixed z-50 w-80 rounded-lg border border-slate-300 bg-white p-3 shadow-xl"
          style={{
            left: Math.min(composing.rect.left, window.innerWidth - 340),
            top: composing.rect.bottom + 4
          }}
        >
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
            {rangeLabel(composing.anchor)}
          </div>
          <div className="mb-2 max-h-16 overflow-y-auto rounded bg-amber-50 px-2 py-1 text-xs italic text-slate-700">
            {truncate(composing.anchor.quoted_text, 240)}
          </div>
          <textarea
            autoFocus
            className="textarea h-24 w-full resize-none text-sm"
            placeholder="Mental note about this passage…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setComposing(null);
                setDraft('');
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
          />
          {error ? <div className="mt-1 text-xs text-rose-600">{error}</div> : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="btn"
              onClick={() => {
                setComposing(null);
                setDraft('');
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || draft.trim().length === 0}
            >
              {saving ? 'Saving…' : 'Comment'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
