import { useEffect, useState } from 'react';
import { api, type ApiKeyStatus } from '../api';

export function SettingsPanel() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [reveal, setReveal] = useState(false);

  async function refresh() {
    try {
      const s = await api.getConfig();
      setStatus(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const s = await api.setApiKey(draft.trim());
      setStatus(s);
      setDraft('');
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm('Remove the configured API key from disk?')) return;
    setSaving(true);
    setError(null);
    try {
      const s = await api.clearApiKey();
      setStatus(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const envOverride = status?.source === 'env';
  const canSubmit = draft.trim().length > 0 && !saving;

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="text-sm font-semibold">settings</div>
        {savedTick > 0 ? (
          <span className="text-xs text-emerald-700">saved ✓</span>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto px-4 py-4 text-sm">
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Anthropic API key</h3>
          <p className="mb-3 text-xs text-slate-600">
            Used by the Claude Agent SDK for planner / executor / evaluator sessions. Stored at{' '}
            <code className="rounded bg-slate-100 px-1">~/.agent-harness/config.json</code>{' '}
            with <code>0600</code> permissions. The <code>ANTHROPIC_API_KEY</code> environment
            variable always wins if set, so existing shell setups keep working.
          </p>

          <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-700">Current</span>
              <SourceBadge source={status?.source ?? 'none'} />
            </div>
            <div className="mt-1 font-mono text-slate-900">
              {status?.hasKey ? status.masked : <span className="italic text-slate-500">not set</span>}
            </div>
            {envOverride ? (
              <div className="mt-1 text-[11px] text-amber-700">
                Sourced from <code>ANTHROPIC_API_KEY</code> in the environment. Saving below
                writes to the config file but the env var keeps overriding until you unset it.
              </div>
            ) : null}
          </div>

          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="api-key">
            New key
          </label>
          <div className="flex gap-2">
            <input
              id="api-key"
              type={reveal ? 'text' : 'password'}
              className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
              placeholder="sk-ant-..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={() => setReveal((r) => !r)}
            >
              {reveal ? 'hide' : 'show'}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={save}
              disabled={!canSubmit}
            >
              {saving ? 'saving…' : 'save key'}
            </button>
            {status?.source === 'config' ? (
              <button
                className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                onClick={clear}
                disabled={saving}
              >
                remove saved key
              </button>
            ) : null}
          </div>
          {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
        </section>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: 'env' | 'config' | 'none' }) {
  if (source === 'env') {
    return <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">env</span>;
  }
  if (source === 'config') {
    return <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">config file</span>;
  }
  return <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">not set</span>;
}
