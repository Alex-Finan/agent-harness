import { useEffect, useState } from 'react';
import { api } from '../api';
import { Markdown } from './Markdown';

export function PlanEditor({
  runId,
  planMd,
  onSaved
}: {
  runId: string;
  planMd: string | null;
  onSaved?: (sprints: number) => void;
}) {
  const [draft, setDraft] = useState(planMd ?? '');
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!edit) setDraft(planMd ?? '');
  }, [planMd, edit]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.savePlan(runId, draft);
      onSaved?.(res.sprints);
      setEdit(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (planMd === null) {
    return (
      <div className="panel px-4 py-6 text-sm text-slate-400">
        No plan yet. Run the planner to generate <code>plan.md</code>.
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="text-sm font-semibold">plan.md</div>
        <div className="flex gap-2">
          {edit ? (
            <>
              <button className="btn" onClick={() => {
                setDraft(planMd);
                setEdit(false);
              }} disabled={saving}>
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
      </div>
      {error ? (
        <div className="m-3 rounded border border-rose-700 bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {edit ? (
        <textarea
          className="textarea m-3 h-[60vh]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <Markdown source={planMd} />
        </div>
      )}
    </div>
  );
}
