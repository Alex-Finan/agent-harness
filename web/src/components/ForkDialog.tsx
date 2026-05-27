import { useState } from 'react';
import { chatApi } from '../api';

/**
 * Branch the current chat into a sibling. Same context window via the CLI's
 * --resume mechanic; optional `git worktree` so divergent file edits don't
 * trample the parent's working tree.
 */
export function ForkDialog({
  chatId,
  parentTitle,
  parentCwd,
  onClose,
  onCreated
}: {
  chatId: string;
  parentTitle: string;
  parentCwd: string;
  onClose: () => void;
  onCreated: (newChatId: string) => void;
}) {
  const [title, setTitle] = useState(`${parentTitle} (fork)`);
  const [useWorktree, setUseWorktree] = useState(false);
  const [baseBranch, setBaseBranch] = useState('');
  const [branchName, setBranchName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setCreating(true);
    setError(null);
    try {
      const { chat } = await chatApi.fork(chatId, {
        title: title.trim() || undefined,
        worktree: useWorktree
          ? {
              baseBranch: baseBranch.trim() || undefined,
              newBranch: branchName.trim() || undefined
            }
          : undefined
      });
      onCreated(chat.chat_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-xl space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Fork chat</h2>
          <button
            className="text-slate-500 hover:text-slate-800"
            onClick={onClose}
            disabled={creating}
          >
            ×
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Creates a sibling chat that resumes from the parent's exact context. Both threads can be
          continued independently — Claude doesn't share state between branches after the fork.
        </p>

        <div className="space-y-3 text-sm">
          <Field label="Title">
            <input
              className="input w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={creating}
            />
          </Field>

          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs">
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
              disabled={creating}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <div className="font-medium text-slate-800">
                Isolate in a new git worktree
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-600">
                Creates a fresh checkout under{' '}
                <code className="font-mono">~/.agent-harness/worktrees/</code> on a new branch off
                this repo. File edits in the fork stay separated from{' '}
                <code className="font-mono">{shortPath(parentCwd)}</code>. Requires the parent cwd
                to be a git repo. The worktree is removed when you delete the fork.
              </div>
            </div>
          </label>

          {useWorktree ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base branch (optional)">
                <input
                  className="input w-full"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  disabled={creating}
                  placeholder="defaults to current HEAD"
                />
              </Field>
              <Field label="New branch name (optional)">
                <input
                  className="input w-full"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  disabled={creating}
                  placeholder="agent-harness/fork-…"
                />
              </Field>
            </div>
          ) : null}
        </div>

        {error ? <div className="text-xs text-rose-600">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={creating}
          >
            {creating ? 'Forking…' : 'Fork'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function shortPath(p: string): string {
  const home = '/Users/';
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const i = rest.indexOf('/');
    if (i > 0) return '~/' + rest.slice(i + 1);
  }
  return p;
}
