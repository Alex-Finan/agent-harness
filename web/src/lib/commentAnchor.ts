import type { CommentAnchor } from '../api';

/**
 * Locate a substring within `source` by selection text, returning a
 * CommentAnchor (line/col coords + quoted_text). Tries an exact match first,
 * then falls back to a whitespace-collapsed match (handles the case where the
 * DOM rendering collapsed line breaks into spaces). Returns null if not found.
 *
 * Shared by both the planner (pending_comments on plan/overview/contract) and
 * chat sessions (persistent comments on assistant messages). Same anchor
 * shape, same matching semantics — keep the two surfaces consistent.
 */
export function locateAnchor(source: string, selectedText: string): CommentAnchor | null {
  const normalized = selectedText.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;

  const direct = source.indexOf(selectedText);
  if (direct >= 0) {
    return toCoords(source, direct, direct + selectedText.length, selectedText);
  }

  const collapsedSource = source.replace(/\s+/g, ' ');
  const idxC = collapsedSource.indexOf(normalized);
  if (idxC < 0) return null;
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

export function toCoords(
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

export function rangeLabel(a: CommentAnchor): string {
  if (a.start_line === a.end_line) return `line ${a.start_line + 1}`;
  return `lines ${a.start_line + 1}-${a.end_line + 1}`;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/**
 * Find the first occurrence of `text` within a single text node of `root` and
 * wrap it in <mark class="comment-anchor" data-comment-id=...>. Single-text-
 * node only — multi-node spans (text broken by formatting) are skipped
 * silently. Whitespace-flexible match to mirror locateAnchor.
 */
export function wrapFirstOccurrence(root: HTMLElement, text: string, commentId: string): void {
  if (text.length === 0) return;
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
