import { useEffect, useState } from 'react';
import { api, type PendingComment } from '../api';
import { CommentableMarkdown } from './CommentableMarkdown';

/**
 * Renders overview.md — the intuitive, authoritative narrative for a run.
 * Markdown renders normally; ```mermaid``` blocks are rendered as SVG
 * diagrams by the Markdown component. Click "Edit" to switch to a raw
 * textarea and save back through the /overview API.
 */
export function OverviewView({
  runId,
  overviewMd,
  pendingComments = [],
  onCommentFocus
}: {
  runId: string;
  overviewMd: string;
  pendingComments?: PendingComment[];
  onCommentFocus?: (id: string) => void;
}) {
  const [draft, setDraft] = useState(overviewMd);
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!edit) setDraft(overviewMd);
  }, [overviewMd, edit]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveOverview(runId, draft);
      setEdit(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-slate-100 px-4 py-2">
        {edit ? (
          <>
            <button
              className="btn"
              onClick={() => {
                setDraft(overviewMd);
                setEdit(false);
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setEdit(true)}>
            Edit
          </button>
        )}
      </div>
      {error ? (
        <div className="m-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {edit ? (
        <textarea
          className="textarea m-3 h-[60vh] flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <div className="overflow-y-auto px-4 py-3">
          <CommentableMarkdown
            source={overviewMd}
            file="overview.md"
            runId={runId}
            comments={pendingComments.filter((c) => c.file === 'overview.md')}
            onCommentFocus={onCommentFocus}
          />
        </div>
      )}
    </div>
  );
}
