import { useState } from 'react';
import type { PendingComment } from '../api';
import { api } from '../api';

/**
 * Right-rail panel listing pending comments grouped by file. Each item can be
 * edited in-place or deleted. The panel is intentionally minimal — comments
 * are short-lived and get cleared on the next planner iteration.
 *
 * `focusedId` lets the parent scroll an item into view when the user clicks
 * a highlight in the document.
 */
export function PendingCommentsPanel({
  runId,
  comments,
  focusedId
}: {
  runId: string;
  comments: PendingComment[];
  focusedId?: string | null;
}) {
  const byFile = new Map<string, PendingComment[]>();
  for (const c of comments) {
    const arr = byFile.get(c.file) ?? [];
    arr.push(c);
    byFile.set(c.file, arr);
  }

  return (
    <div className="panel flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <span className="text-sm font-semibold text-slate-800">
          Pending comments
          {comments.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {comments.length}
            </span>
          ) : null}
        </span>
      </div>
      {comments.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          Select text in the overview / plan / contract above and click <strong>+ Comment</strong> to add a review note. Comments are bundled with the revision message on the next iteration.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {[...byFile.entries()].map(([file, list]) => (
            <div key={file} className="mb-2">
              <div className="px-2 pb-1 pt-1 text-[11px] font-mono text-slate-500">{file}</div>
              {list.map((c) => (
                <CommentRow
                  key={c.id}
                  runId={runId}
                  comment={c}
                  focused={focusedId === c.id}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  runId,
  comment,
  focused
}: {
  runId: string;
  comment: PendingComment;
  focused: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.patchPendingComment(runId, comment.id, draft.trim());
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api.deletePendingComment(runId, comment.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const range =
    comment.anchor.start_line === comment.anchor.end_line
      ? `line ${comment.anchor.start_line + 1}`
      : `lines ${comment.anchor.start_line + 1}-${comment.anchor.end_line + 1}`;

  return (
    <div
      className={`mb-2 rounded border px-2 py-2 text-xs ${
        focused ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">{range}</div>
      <div className="mb-1 line-clamp-2 rounded bg-amber-50 px-1 py-0.5 italic text-slate-700">
        {comment.anchor.quoted_text}
      </div>
      {editing ? (
        <>
          <textarea
            className="textarea h-20 w-full resize-none text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {err ? <div className="mt-1 text-rose-600">{err}</div> : null}
          <div className="mt-1 flex justify-end gap-1">
            <button
              className="btn !px-2 !py-0.5 !text-xs"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary !px-2 !py-0.5 !text-xs"
              onClick={() => void save()}
              disabled={busy || draft.trim().length === 0}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="whitespace-pre-wrap text-slate-800">{comment.body}</div>
          {err ? <div className="mt-1 text-rose-600">{err}</div> : null}
          <div className="mt-1 flex justify-end gap-1 text-[11px]">
            <button
              className="text-slate-500 hover:text-slate-800"
              onClick={() => setEditing(true)}
              disabled={busy}
            >
              edit
            </button>
            <button
              className="text-rose-500 hover:text-rose-700"
              onClick={() => void remove()}
              disabled={busy}
            >
              delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
