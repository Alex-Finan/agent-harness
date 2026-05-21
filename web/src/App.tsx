import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, openEventStream, type RunState, type ServerEvent } from './api';
import { RunList } from './components/RunList';
import { RunDetail } from './components/RunDetail';
import { RunOverview } from './components/RunOverview';
import { NewRunDialog } from './components/NewRunDialog';
import { PromptsPanel } from './components/PromptsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts';

type Page = 'settings' | 'prompts';

export function App() {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // `page` takes over the main area when set. Selecting a run clears it;
  // navigating to a page clears `selected`. Modeled as a single enum so only
  // one main view ever renders.
  const [page, setPage] = useState<Page | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [meta, setMeta] = useState<{ version: string; harnessHome: string } | null>(null);

  useEffect(() => {
    void api.meta().then(setMeta).catch(() => {});
    void refresh();
    const es = openEventStream((event: ServerEvent) => {
      if (event.type === 'hello') return;
      if (
        event.type === 'run_state' ||
        event.type === 'run_created' ||
        event.type === 'dispatch' ||
        event.type === 'cost'
      ) {
        void refresh();
      }
    });
    return () => es.close();
  }, []);

  async function refresh() {
    try {
      const { runs } = await api.listRuns();
      setRuns(runs);
      // No auto-selection. The dashboard (RunOverview) is the default landing
      // surface — the operator picks a run explicitly. Auto-selecting would
      // fight an explicit "Dashboard" / Escape on every SSE tick.
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    // When the selected run disappears from the list (purged after abort,
    // etc.), drop back to the dashboard rather than snapping to runs[0] —
    // the user did not ask to look at some other arbitrary run.
    if (selected && !runs.some((r) => r.run_id === selected)) {
      setSelected(null);
    }
  }, [runs, selected]);

  function goToPage(p: Page) {
    setPage(p);
    setSelected(null);
  }

  function selectRun(runId: string | null) {
    setSelected(runId);
    setPage(null);
  }

  // Keyboard navigation across runs. j/k cycles through the run list, Enter
  // focuses the highlighted run, Escape returns to the dashboard, n opens
  // the new-run dialog, ? toggles the shortcut overlay.
  //
  // Use DOM order rather than the raw runs[] order so j/k matches what the
  // operator sees — the sidebar groups by base_branch and applies filters,
  // both of which change the visual sequence.
  const moveSelection = useCallback(
    (delta: number) => {
      const visible = Array.from(document.querySelectorAll<HTMLLIElement>('aside ul > li[title]'))
        .map((li) => li.getAttribute('title'))
        .filter((id): id is string => !!id);
      if (visible.length === 0) return;
      const i = selected ? visible.indexOf(selected) : -1;
      const next =
        i === -1
          ? delta > 0
            ? 0
            : visible.length - 1
          : (i + delta + visible.length) % visible.length;
      selectRun(visible[next]);
    },
    [selected]
  );
  useKeyboardShortcuts(
    useMemo(
      () => ({
        onNext: () => moveSelection(1),
        onPrev: () => moveSelection(-1),
        onEscape: () => {
          if (showHelp) setShowHelp(false);
          else if (showNew) setShowNew(false);
          else if (page) setPage(null);
          else setSelected(null);
        },
        onHelp: () => setShowHelp((x) => !x),
        onNew: () => setShowNew(true)
      }),
      [moveSelection, showHelp, showNew, page]
    )
  );

  function HeaderNavButton({
    active,
    onClick,
    title,
    children
  }: {
    active: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) {
    return (
      <button
        className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
          active
            ? 'border-blue-300 bg-white text-blue-900'
            : 'border-blue-700 text-blue-100 hover:bg-blue-800 hover:text-white'
        }`}
        onClick={onClick}
        title={title}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Global top bar — spans the full width of the window. Logo on the left,
          page navigation on the right. Left padding leaves room for macOS
          traffic-light controls (hiddenInset window style); the bar itself
          is the drag region so the user can move the window. */}
      <header className="app-drag flex shrink-0 items-center justify-between gap-4 border-b border-blue-200 bg-blue-900 py-3 pl-[88px] pr-4 text-white">
        <button
          className="app-no-drag flex min-w-0 items-baseline gap-2 text-left hover:opacity-80"
          onClick={() => {
            setSelected(null);
            setPage(null);
          }}
          title="Go to dashboard"
        >
          <span className="text-lg font-bold tracking-tight text-white">Sentinel</span>
          {meta ? <span className="text-xs text-blue-200">v{meta.version}</span> : null}
        </button>
        <div className="app-no-drag flex shrink-0 items-center gap-1.5">
          {selected || page ? (
            <HeaderNavButton
              active={false}
              onClick={() => {
                setSelected(null);
                setPage(null);
              }}
              title="Show multi-run dashboard"
            >
              ⌂ Dashboard
            </HeaderNavButton>
          ) : null}
          <HeaderNavButton
            active={page === 'prompts'}
            onClick={() => goToPage('prompts')}
            title="Edit system prompts for planner / executor / evaluator"
          >
            Prompts
          </HeaderNavButton>
          <HeaderNavButton
            active={page === 'settings'}
            onClick={() => goToPage('settings')}
            title="API key and other settings"
          >
            Settings
          </HeaderNavButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="min-h-0 flex-1">
            <RunList runs={runs} selectedId={selected} onSelect={selectRun} onNew={() => setShowNew(true)} />
          </div>
          {meta ? (
            <div
              className="border-t border-slate-200 px-4 py-2 text-[10px] font-mono text-slate-600"
              title={meta.harnessHome}
            >
              {meta.harnessHome}
            </div>
          ) : null}
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden bg-white">
          {page === 'settings' ? (
            <PageShell title="Settings">
              <SettingsPanel />
            </PageShell>
          ) : page === 'prompts' ? (
            <PageShell title="System prompts">
              <PromptsPanel />
            </PageShell>
          ) : selected ? (
            <RunDetail key={selected} runId={selected} onSelectRun={selectRun} allRuns={runs} />
          ) : (
            <RunOverview runs={runs} onSelect={selectRun} />
          )}
        </main>
      </div>

      {showNew ? (
        <NewRunDialog
          onClose={() => setShowNew(false)}
          onCreated={(runId) => {
            setShowNew(false);
            selectRun(runId);
            void refresh();
          }}
        />
      ) : null}
      {showHelp ? <ShortcutOverlay onClose={() => setShowHelp(false)} /> : null}
      <ShortcutHintFooter onShow={() => setShowHelp(true)} />
    </div>
  );
}

function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  // The page header is a plain section heading; the inner panel handles
  // its own scroll + flex layout. We give it a max width but otherwise
  // get out of its way so existing components don't need to change.
  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-base font-semibold text-slate-900">{title}</h1>
      </div>
      <div className="min-h-0 flex-1 px-6 py-6">
        <div className="mx-auto flex h-full max-w-4xl flex-col">{children}</div>
      </div>
    </div>
  );
}

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'j / ↓', desc: 'Next run in sidebar' },
  { keys: 'k / ↑', desc: 'Previous run' },
  { keys: 'Esc', desc: 'Dashboard / close modal' },
  { keys: 'n', desc: 'New run' },
  { keys: '?', desc: 'Toggle this help' }
];

function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">Keyboard shortcuts</span>
          <button
            className="text-slate-600 hover:text-slate-900"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{s.desc}</span>
              <kbd className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ShortcutHintFooter({ onShow }: { onShow: () => void }) {
  return (
    <button
      className="fixed bottom-3 right-3 z-10 rounded-full border border-slate-300 bg-white/80 px-2.5 py-1 text-[10px] font-mono text-slate-600 backdrop-blur transition hover:border-blue-400 hover:text-blue-700"
      onClick={onShow}
      title="Show keyboard shortcuts"
    >
      ?
    </button>
  );
}
