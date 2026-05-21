import { useState } from 'react';
import { api } from '../api';

export function PlanChat({
  runId,
  busy,
  disabled
}: {
  runId: string;
  busy: boolean;
  disabled?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ at: string; text: string }>>([]);

  async function send() {
    const text = message.trim();
    if (!text) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.revisePlan(runId, text);
      setHistory((h) => [...h, { at: new Date().toISOString(), text }]);
      setMessage('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const isBusy = busy || submitting;

  return (
    <div className="panel flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold">
        chat with planner
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
        {history.length === 0 ? (
          <div className="text-xs text-slate-500">
            Ask the planner to revise the plan. The current plan.md is kept;
            the planner edits it according to your request.
          </div>
        ) : (
          history.map((h, i) => (
            <div key={i} className="rounded border border-slate-200 bg-white/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                you · {new Date(h.at).toLocaleTimeString()}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-slate-800">{h.text}</div>
            </div>
          ))
        )}
        {busy ? (
          <div className="text-xs text-amber-600">planner is revising…</div>
        ) : null}
      </div>
      {error ? (
        <div className="mx-3 mb-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="border-t border-slate-200 p-3">
        <textarea
          className="textarea h-24"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Combine sprints 2 and 3 into one. Add a sprint for migration rollback."
          disabled={disabled || isBusy}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="text-[10px] text-slate-500">⌘/Ctrl + Enter to send</div>
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={disabled || isBusy || !message.trim()}
          >
            {submitting ? 'Sending…' : busy ? 'Planner busy' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
