import { useEffect, useState } from 'react';
import { api, type PendingComment } from '../api';
import { CommentableMarkdown } from './CommentableMarkdown';

/**
 * Renders overview.md — the intuitive, authoritative narrative for a run.
 * Markdown renders normally; ```mermaid``` blocks are rendered as SVG
 * diagrams by the Markdown component.
 *
 * Editing is controlled from the parent (so the Edit / Save / Cancel buttons
 * can live on the tab row alongside the plan.md / overview.md tabs instead
 * of in a second header below them).
 */
export function OverviewView({
  runId,
  overviewMd,
  pendingComments = [],
  onCommentFocus,
  editing = false,
  onEditingChange,
  registerSaver
}: {
  runId: string;
  overviewMd: string;
  pendingComments?: PendingComment[];
  onCommentFocus?: (id: string) => void;
  editing?: boolean;
  onEditingChange?: (next: boolean) => void;
  /**
   * Lets the parent grab a save handler so it can wire the tab-row "Save"
   * button. Called once on mount + whenever the draft text changes; the
   * parent stashes the latest fn and invokes it on click.
   */
  registerSaver?: (save: (() => Promise<void>) | null) => void;
}) {
  const [draft, setDraft] = useState(overviewMd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(overviewMd);
  }, [overviewMd, editing]);

  useEffect(() => {
    if (!registerSaver) return;
    if (!editing) {
      registerSaver(null);
      return;
    }
    registerSaver(async () => {
      setSaving(true);
      setError(null);
      try {
        await api.saveOverview(runId, draft);
        onEditingChange?.(false);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setSaving(false);
      }
    });
    return () => registerSaver(null);
  }, [registerSaver, editing, draft, runId, onEditingChange]);

  return (
    <div className="flex h-full flex-col">
      {error ? (
        <div className="m-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {editing ? (
        <textarea
          className="textarea m-3 h-[60vh] flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
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
