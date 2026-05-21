import { useEffect, useState, type ReactNode } from 'react';

/**
 * Panel wrapper with a fullscreen toggle in its header. When expanded, the
 * panel renders into a fixed inset overlay; Escape collapses it. Used for the
 * plan/overview view so operators can read long plans without the cramped
 * 2fr/1fr layout.
 */
export function ExpandablePanel({
  header,
  collapsedClassName = 'panel flex max-h-[70vh] min-h-[60vh] flex-col overflow-hidden',
  children
}: {
  header: (expanded: boolean) => ReactNode;
  collapsedClassName?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      // Don't collapse when the user is escaping out of a typing context.
      // The textarea / composer / form handler should process Escape first;
      // collapsing the whole panel as a side-effect is confusing.
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || el.isContentEditable) {
          return;
        }
      }
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Bump to z-[60] when expanded so the header (with the collapse button)
  // always renders above floating CommentableMarkdown affordances (pill /
  // composer / hover popover, all at z-50).
  const containerClass = expanded
    ? 'fixed inset-4 z-[60] panel flex flex-col overflow-hidden shadow-2xl'
    : collapsedClassName;

  return (
    <>
      {expanded ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30"
          onClick={() => setExpanded(false)}
        />
      ) : null}
      <div className={containerClass}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {header(expanded)}
          </div>
          <button
            className="btn shrink-0"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse (Esc)' : 'Expand to fullscreen'}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '⤡' : '⤢'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
