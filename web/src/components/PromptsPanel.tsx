import { useEffect, useState } from 'react';
import { api, type PromptName } from '../api';

const NAMES: PromptName[] = ['planner', 'executor', 'evaluator'];

export function PromptsPanel() {
  const [prompts, setPrompts] = useState<Record<PromptName, string> | null>(null);
  const [tab, setTab] = useState<PromptName>('planner');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    api
      .getPrompts()
      .then((p) => {
        setPrompts(p);
        setDraft(p[tab]);
      })
      .catch((e) => setError((e as Error).message));
    // load once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prompts) setDraft(prompts[tab]);
  }, [tab, prompts]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.savePrompt(tab, draft);
      setPrompts((prev) => (prev ? { ...prev, [tab]: draft } : prev));
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = prompts ? prompts[tab] !== draft : false;

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="text-sm font-semibold">system prompts</div>
        <div className="flex gap-1 rounded border border-slate-800 bg-slate-950 p-0.5">
          {NAMES.map((n) => (
            <button
              key={n}
              className={`rounded px-3 py-1 text-xs ${
                tab === n ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-100'
              }`}
              onClick={() => setTab(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="border-b border-slate-800 px-4 py-2 text-xs text-slate-500">
        Edits apply globally to all future role invocations. The harness re-reads these on every session start.
      </div>
      {error ? (
        <div className="m-3 rounded border border-rose-700 bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="flex-1 px-3 py-3">
        <textarea
          className="textarea h-full min-h-[40vh] w-full"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-2">
        {savedTick > 0 && !dirty ? (
          <span className="text-xs text-emerald-400">saved</span>
        ) : null}
        <button
          className="btn"
          onClick={() => {
            if (prompts) setDraft(prompts[tab]);
          }}
          disabled={!dirty || saving}
        >
          Reset
        </button>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
