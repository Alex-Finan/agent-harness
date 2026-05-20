import { useEffect, useState } from 'react';
import { api, openEventStream, type RunState, type ServerEvent } from './api';
import { RunList } from './components/RunList';
import { RunDetail } from './components/RunDetail';
import { RunOverview } from './components/RunOverview';
import { NewRunDialog } from './components/NewRunDialog';

export function App() {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
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
      // Use the functional setter so we read the *current* selection rather
      // than the value captured when this `refresh` closure was created. The
      // SSE handler in the mount-time effect keeps calling the very first
      // refresh — without this, any event would reset selection to runs[0].
      setSelected((current) => current ?? runs[0]?.run_id ?? null);
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
        <div className="min-h-0 flex-1">
          <RunList runs={runs} selectedId={selected} onSelect={setSelected} onNew={() => setShowNew(true)} />
        </div>
        {meta ? (
          <div className="border-t border-slate-800 px-4 py-2 text-[10px] font-mono text-slate-600" title={meta.harnessHome}>
            {meta.harnessHome}
          </div>
        ) : null}
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-slate-950">
        {selected ? (
          <RunDetail key={selected} runId={selected} />
        ) : (
          <RunOverview runs={runs} onSelect={setSelected} />
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
