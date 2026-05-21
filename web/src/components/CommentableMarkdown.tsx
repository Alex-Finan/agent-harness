import { useEffect, useRef, useState } from 'react';
import type { PendingComment, CommentAnchor } from '../api';
import { api } from '../api';
import { Markdown } from './Markdown';

interface HoverState {
  commentId: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Renders markdown with selection-driven inline commenting. On mouseup with a
 * non-empty selection inside the container, a floating "+ Comment" pill
 * appears near the selection. Clicking it opens a popover composer; saving
 * POSTs a pending comment to the server (cleared after the next planner
 * iteration).
 *
 * Highlights: after each render, walks text nodes and wraps occurrences of
 * each comment's quoted_text with a <mark> span. Click on a highlight calls
 * onCommentFocus, letting the parent scroll the right-rail item into view.
 *
 * Anchoring strategy: comment coordinates are computed by substring-matching
 * the selected text against the source markdown. Quoted_text travels with the
 * comment so the planner can always re-locate the passage even if line
 * numbers shift in flight (which they don't, in the one-shot lifecycle).
 */
export function CommentableMarkdown({
  source,
  anchorSource,
  file,
  runId,
  comments,
  onCommentFocus
}: {
  /** Markdown content actually rendered. May be a slice (e.g. one sprint section). */
  source: string;
  /**
   * Optional fuller source against which selection coordinates and quoted_text
   * are computed. Defaults to `source`. Pass the full file content here when
   * the rendered `source` is a slice so that anchor line/col numbers stay
   * file-relative.
   */
  anchorSource?: string;
  file: string;
  runId: string;
  comments: PendingComment[];
  onCommentFocus?: (commentId: string) => void;
}) {
  const effectiveAnchorSource = anchorSource ?? source;
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

  // Selection -> pending pill
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPending(null);
        return;
      }
      // Require selection to be entirely inside our container.
      const range = sel.getRangeAt(0);
      if (!container) return;
      if (!container.contains(range.commonAncestorContainer)) {
        setPending(null);
        return;
      }
      const text = sel.toString();
      if (text.trim().length === 0) {
        setPending(null);
        return;
      }
      const anchor = locateAnchor(effectiveAnchorSource, text);
      if (!anchor) {
        // Couldn't map the selection back to source. Skip silently.
        setPending(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setPending({
        anchor,
        rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right }
      });
    }

    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        // Selection went away (e.g. user clicked somewhere else). Drop the
        // pill so it can't hover over unrelated UI like header buttons.
        setPending(null);
      }
    }

    function onScroll() {
      // Any scroll invalidates the captured viewport rect — drop the pill so
      // it doesn't drift over unrelated UI like tab strips or page headers.
      setPending(null);
    }
    function onMouseDownAnywhere(e: MouseEvent) {
      if (!container) return;
      const target = e.target as Node | null;
      // If the user mousedowns outside the markdown body AND not on the pill
      // itself, drop the pending state. Pill is rendered as a sibling div in
      // the relative wrapper, so we test against the container's parent.
      const wrapper = container.parentElement;
      if (!wrapper) return;
      if (target && wrapper.contains(target)) return;
      setPending(null);
    }

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mousedown', onMouseDownAnywhere, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onMouseDownAnywhere, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [source, effectiveAnchorSource]);

  // Highlight overlay: re-apply after every render of comments / source.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Strip prior highlights, then re-wrap.
    container.querySelectorAll('mark.comment-anchor').forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
    for (const c of comments) {
      wrapFirstOccurrence(container, c.anchor.quoted_text, c.id);
    }
  }, [comments, source]);

  // Hover + click handlers on highlights. Hover surfaces the comment body in a
  // floating tooltip; click "pins" the tooltip (so the operator can move into
  // it to edit/delete) and also bubbles the comment id up to the parent so
  // the right-rail entry scrolls into view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function getMark(e: Event): HTMLElement | null {
      const target = e.target as HTMLElement | null;
      if (!target) return null;
      return target.closest('mark.comment-anchor') as HTMLElement | null;
    }
    function onOver(e: Event) {
      const mark = getMark(e);
      if (!mark) return;
      const cid = mark.dataset.commentId;
      if (!cid) return;
      const rect = mark.getBoundingClientRect();
      cancelHoverClear();
      setHover({
        commentId: cid,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      });
    }
    function onOut(e: Event) {
      const mark = getMark(e);
      if (!mark) return;
      // Don't clear if moving into the popover itself.
      scheduleHoverClear();
    }
    function onClick(e: MouseEvent) {
      const mark = getMark(e);
      if (!mark) return;
      const cid = mark.dataset.commentId;
      if (!cid) return;
      // Toggle pin so a second click on the same highlight closes the popover.
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

  // Clean up hover timer on unmount.
  useEffect(() => () => cancelHoverClear(), []);

  // If the focused comment goes away (sent + cleared, or deleted) unpin.
  useEffect(() => {
    if (pinned && !comments.some((c) => c.id === pinned)) setPinned(null);
    if (hover && !comments.some((c) => c.id === hover.commentId)) setHover(null);
  }, [comments, pinned, hover]);

  async function save() {
    if (!composing) return;
    setSaving(true);
    setError(null);
    try {
      await api.addPendingComment(runId, {
        file,
        anchor: composing.anchor,
        body: draft.trim()
      });
      setComposing(null);
      setDraft('');
      // Clear the pill + selection so the user doesn't see a stale "+ Comment".
      window.getSelection()?.removeAllRanges();
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <div ref={containerRef}>
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
            // Prevent the click from collapsing the selection before we open
            // the composer.
            e.preventDefault();
            setComposing(pending);
            setDraft('');
          }}
        >
          + Comment
        </button>
      ) : null}

      <CommentHoverPopover
        runId={runId}
        comments={comments}
        hover={hover}
        pinned={pinned}
        onPinClose={() => setPinned(null)}
        onEnter={cancelHoverClear}
        onLeave={scheduleHoverClear}
      />

      {composing ? (
        <div
          className="fixed z-50 w-80 rounded-lg border border-slate-300 bg-white p-3 shadow-xl"
          style={{
            left: Math.min(composing.rect.left, window.innerWidth - 340),
            top: composing.rect.bottom + 4
          }}
        >
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
            {file} · {rangeLabel(composing.anchor)}
          </div>
          <div className="mb-2 max-h-16 overflow-y-auto rounded bg-amber-50 px-2 py-1 text-xs italic text-slate-700">
            {truncate(composing.anchor.quoted_text, 240)}
          </div>
          <textarea
            autoFocus
            className="textarea h-24 w-full resize-none text-sm"
            placeholder="Comment for the planner…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Stop the bubble so ExpandablePanel / global shortcuts don't
                // also react (e.g. collapse the whole panel) when the user is
                // just closing the composer.
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
          {error ? (
            <div className="mt-1 text-xs text-rose-600">{error}</div>
          ) : null}
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

function CommentHoverPopover({
  runId,
  comments,
  hover,
  pinned,
  onPinClose,
  onEnter,
  onLeave
}: {
  runId: string;
  comments: PendingComment[];
  hover: HoverState | null;
  pinned: string | null;
  onPinClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  // Pinned wins over hover so the popover stays put while the user moves.
  const activeId = pinned ?? hover?.commentId ?? null;
  if (!activeId) return null;
  const comment = comments.find((c) => c.id === activeId);
  if (!comment) return null;
  // When pinned but no hover rect, fall back to a fixed slot in case the
  // highlight scrolled out of view (rare, but better than rendering off-screen).
  const rect = hover && hover.commentId === activeId ? hover.rect : null;
  const left = rect ? Math.min(rect.left, window.innerWidth - 320) : 20;
  const top = rect ? rect.bottom + 4 : 60;
  const range =
    comment.anchor.start_line === comment.anchor.end_line
      ? `line ${comment.anchor.start_line + 1}`
      : `lines ${comment.anchor.start_line + 1}-${comment.anchor.end_line + 1}`;

  return (
    <div
      className="fixed z-40 w-80 rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl"
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {comment.file} · {range}
        </span>
        {pinned ? (
          <button
            className="text-[11px] text-slate-500 hover:text-slate-800"
            onClick={onPinClose}
            title="Close (Esc)"
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="whitespace-pre-wrap text-slate-800">{comment.body}</div>
      <div className="mt-2 flex justify-end gap-2 text-[11px]">
        <button
          className="text-rose-500 hover:text-rose-700"
          onClick={async () => {
            try {
              await api.deletePendingComment(runId, comment.id);
              onPinClose();
            } catch {
              /* surfaced via right-rail row's error path */
            }
          }}
        >
          delete
        </button>
      </div>
    </div>
  );
}

// ---- helpers ----

interface PendingSelection {
  anchor: CommentAnchor;
  rect: { left: number; top: number; right: number; bottom: number };
}

function locateAnchor(source: string, selectedText: string): CommentAnchor | null {
  // The selection may collapse whitespace (e.g., line breaks shown as spaces
  // in the rendered DOM). Try exact match first, then fall back to a relaxed
  // whitespace-collapsed search.
  const normalized = selectedText.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;

  const direct = source.indexOf(selectedText);
  if (direct >= 0) {
    return toCoords(source, direct, direct + selectedText.length, selectedText);
  }

  // Relaxed search: collapse whitespace in source AND in selection, find
  // index in collapsed source, then map back. Cheap and usually sufficient.
  const collapsedSource = source.replace(/\s+/g, ' ');
  const idxC = collapsedSource.indexOf(normalized);
  if (idxC < 0) return null;
  // Map collapsed index back to original index by counting characters.
  let realIdx = 0;
  let collapsedSeen = 0;
  let inWs = false;
  while (realIdx < source.length && collapsedSeen < idxC) {
    const ch = source[realIdx];
    if (/\s/.test(ch)) {
      if (!inWs) {
        collapsedSeen++;
        inWs = true;
      }
    } else {
      collapsedSeen++;
      inWs = false;
    }
    realIdx++;
  }
  // Heuristic end: scan forward up to normalized.length non-collapsed chars.
  let endIdx = realIdx;
  let matchedCollapsed = 0;
  inWs = false;
  while (endIdx < source.length && matchedCollapsed < normalized.length) {
    const ch = source[endIdx];
    if (/\s/.test(ch)) {
      if (!inWs) {
        matchedCollapsed++;
        inWs = true;
      }
    } else {
      matchedCollapsed++;
      inWs = false;
    }
    endIdx++;
  }
  return toCoords(source, realIdx, endIdx, source.slice(realIdx, endIdx));
}

function toCoords(
  source: string,
  startOffset: number,
  endOffset: number,
  quoted: string
): CommentAnchor {
  const prefix = source.slice(0, startOffset);
  const startLine = (prefix.match(/\n/g) ?? []).length;
  const startCol = startOffset - (prefix.lastIndexOf('\n') + 1);
  const mid = source.slice(0, endOffset);
  const endLine = (mid.match(/\n/g) ?? []).length;
  const endCol = endOffset - (mid.lastIndexOf('\n') + 1);
  return {
    start_line: startLine,
    start_col: startCol,
    end_line: endLine,
    end_col: endCol,
    quoted_text: quoted
  };
}

function rangeLabel(a: CommentAnchor): string {
  if (a.start_line === a.end_line) return `line ${a.start_line + 1}`;
  return `lines ${a.start_line + 1}-${a.end_line + 1}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/**
 * Find the first occurrence of `text` within a single text node of `root`
 * and wrap it in <mark class="comment-anchor" data-comment-id=...>. Single-
 * text-node only — multi-node spans (text broken by formatting) are skipped
 * silently and surface only in the right-rail list.
 */
function wrapFirstOccurrence(root: HTMLElement, text: string, commentId: string): void {
  if (text.length === 0) return;
  // Match the same whitespace flexibility we use to locate the anchor.
  const needle = text.replace(/\s+/g, ' ').trim();
  if (needle.length === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null = walker.nextNode();
  while (node) {
    const nodeText = node.nodeValue ?? '';
    if (nodeText.length > 0) {
      const collapsed = nodeText.replace(/\s+/g, ' ');
      const idx = collapsed.indexOf(needle);
      if (idx >= 0) {
        // Map collapsed offset back to raw offset within nodeText.
        let real = 0;
        let seen = 0;
        let inWs = false;
        while (real < nodeText.length && seen < idx) {
          const ch = nodeText[real];
          if (/\s/.test(ch)) {
            if (!inWs) {
              seen++;
              inWs = true;
            }
          } else {
            seen++;
            inWs = false;
          }
          real++;
        }
        const realStart = real;
        let realEnd = real;
        let matched = 0;
        inWs = false;
        while (realEnd < nodeText.length && matched < needle.length) {
          const ch = nodeText[realEnd];
          if (/\s/.test(ch)) {
            if (!inWs) {
              matched++;
              inWs = true;
            }
          } else {
            matched++;
            inWs = false;
          }
          realEnd++;
        }

        const range = document.createRange();
        range.setStart(node, realStart);
        range.setEnd(node, realEnd);
        const mark = document.createElement('mark');
        mark.className = 'comment-anchor';
        mark.dataset.commentId = commentId;
        try {
          range.surroundContents(mark);
        } catch {
          /* range crossed element boundary — skip */
        }
        return;
      }
    }
    node = walker.nextNode();
  }
}
