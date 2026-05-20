import { useEffect, useState } from 'react';
import { api, openEventStream, type RunState, type ServerEvent } from './api';
import { RunList } from './components/RunList';
import { RunDetail } from './components/RunDetail';
import { NewRunDialog } from './components/NewRunDialog';
import { PromptsPanel } from './components/PromptsPanel';

type View = 'runs' | 'prompts';

export function App() {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<View>('runs');
  const [meta, setMeta] = useState<{ version: string; harnessHome: string } | null>(null);

  useEffect(() => {
    void api.meta().then(setMeta).catch(() => {});
    void refresh();
    const es = openEventStream((event: ServerEvent) => {
      if (event.type === 'hello') return;
      // Any state-affecting event refreshes the run list so badges/cost stay
      // current across all runs (cheap call, returns trimmed objects).
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
      if (!selected && runs.length > 0) setSelected(runs[0].run_id);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (selected && !runs.some((r) => r.run_id === selected)) {
      setSelected(runs[0]?.run_id ?? null);
    }
  }, [runs, selected]);

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <span className="text-lg font-bold tracking-tight">agent-harness</span>
          {meta ? <span className="text-xs text-slate-500">v{meta.version}</span> : null}
        </div>
        <div className="flex gap-1 border-b border-slate-800 px-2 py-2">
          <button
            className={`flex-1 rounded px-3 py-1 text-sm ${
              view === 'runs' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-100'
            }`}
            onClick={() => setView('runs')}
          >
            Runs
          </button>
          <button
            className={`flex-1 rounded px-3 py-1 text-sm ${
              view === 'prompts' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-100'
            }`}
            onClick={() => setView('prompts')}
          >
            Prompts
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {view === 'runs' ? (
            <RunList runs={runs} selectedId={selected} onSelect={setSelected} onNew={() => setShowNew(true)} />
          ) : (
            <div className="p-3 text-xs text-slate-500">
              Edit planner/executor/evaluator system prompts on the right →
            </div>
          )}
        </div>
        {meta ? (
          <div className="border-t border-slate-800 px-4 py-2 text-[10px] font-mono text-slate-600" title={meta.harnessHome}>
            {meta.harnessHome}
          </div>
        ) : null}
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-slate-950">
        {view === 'prompts' ? (
          <div className="h-full p-4">
            <PromptsPanel />
          </div>
        ) : selected ? (
          <RunDetail key={selected} runId={selected} />
        ) : (
          <div className="m-6 text-sm text-slate-500">
            Select a run on the left, or click "+ New run" to create one.
          </div>
        )}
      </main>
      {showNew ? (
        <NewRunDialog
          onClose={() => setShowNew(false)}
          onCreated={(runId) => {
            setShowNew(false);
            setSelected(runId);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
