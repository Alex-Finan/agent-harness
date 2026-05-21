import { useEffect } from 'react';

export interface ShortcutHandlers {
  /** Move selection to the next item in a list (e.g. sidebar runs). */
  onNext?: () => void;
  /** Move selection to the previous item. */
  onPrev?: () => void;
  /** Confirm current selection / open detail. */
  onEnter?: () => void;
  /** Escape — deselect / go back to dashboard. */
  onEscape?: () => void;
  /** Toggle the shortcut overlay. */
  onHelp?: () => void;
  /** Open the new-run dialog. */
  onNew?: () => void;
}

/**
 * Global keyboard shortcuts. Skips when focus is in an input/textarea/select
 * or an element with contenteditable so we don't hijack typing.
 *
 * Bindings:
 *   j / ArrowDown  → onNext
 *   k / ArrowUp    → onPrev
 *   Enter          → onEnter
 *   Escape         → onEscape
 *   ?              → onHelp
 *   n              → onNew
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      // Don't hijack typing inside form fields or contenteditable.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
          // Allow Escape to blur the input — useful for "stop typing, go nav."
          if (e.key === 'Escape') {
            t.blur();
          }
          return;
        }
      }
      // Ignore modified keys (cmd-k, ctrl-l, etc) so we don't conflict with
      // browser/system shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          if (handlers.onNext) {
            e.preventDefault();
            handlers.onNext();
          }
          break;
        case 'k':
        case 'ArrowUp':
          if (handlers.onPrev) {
            e.preventDefault();
            handlers.onPrev();
          }
          break;
        case 'Enter':
          if (handlers.onEnter) {
            e.preventDefault();
            handlers.onEnter();
          }
          break;
        case 'Escape':
          if (handlers.onEscape) {
            e.preventDefault();
            handlers.onEscape();
          }
          break;
        case '?':
          if (handlers.onHelp) {
            e.preventDefault();
            handlers.onHelp();
          }
          break;
        case 'n':
          if (handlers.onNew) {
            e.preventDefault();
            handlers.onNew();
          }
          break;
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handlers]);
}
