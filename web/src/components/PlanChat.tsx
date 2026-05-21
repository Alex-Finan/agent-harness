import { useState } from 'react';
import { api } from '../api';

export function PlanChat({
  runId,
  busy,
  disabled,
  pendingCommentCount = 0
}: {
  runId: string;
  busy: boolean;
  disabled?: boolean;
  pendingCommentCount?: number;
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ at: string; text: string; comments: number }>>([]);

  async function send() {
    const text = message.trim();
    // Allow sending with no text when there are pending comments to bundle —
    // the backend rejects empty-text + zero-comments, so we mirror that here.
    if (!text && pendingCommentCount === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.revisePlan(runId, text);
      setHistory((h) => [
        ...h,
        { at: new Date().toISOString(), text, comments: pendingCommentCount }
      ]);
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
                {h.comments > 0 ? (
                  <span className="ml-2 text-amber-600">
                    + {h.comments} comment{h.comments === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-slate-800">
                {h.text || <em className="text-slate-500">(comments only)</em>}
              </div>
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
        {pendingCommentCount > 0 ? (
          <div className="mt-1 text-[11px] text-amber-700">
            {pendingCommentCount} pending comment{pendingCommentCount === 1 ? '' : 's'} will be sent with this iteration
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <div className="text-[10px] text-slate-500">⌘/Ctrl + Enter to send</div>
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={disabled || isBusy || (!message.trim() && pendingCommentCount === 0)}
          >
            {submitting ? 'Sending…' : busy ? 'Planner busy' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
