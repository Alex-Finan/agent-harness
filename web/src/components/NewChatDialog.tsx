import { useState } from 'react';
import { chatApi, type ChatPermissionMode } from '../api';
import { RepoPicker } from './RepoPicker';

const PERMISSION_MODES: { value: ChatPermissionMode; label: string; hint: string }[] = [
  { value: 'acceptEdits', label: 'Auto-accept edits', hint: 'Like enable-auto-mode in claude code (recommended)' },
  { value: 'bypassPermissions', label: 'Bypass all permissions', hint: 'No prompts at all. Use only in trusted sandboxes.' },
  { value: 'auto', label: 'Auto classifier', hint: 'Built-in claude code auto-mode classifier picks per call.' },
  { value: 'default', label: 'Default (prompt)', hint: 'Prompts you for every risky tool call.' },
  { value: 'plan', label: 'Plan-only', hint: 'No execution; claude plans only.' },
  { value: 'dontAsk', label: 'Don’t ask', hint: 'Silently refuse risky calls without prompting.' }
];

const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Default (Sonnet)' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }
];

export function NewChatDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (chatId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState('');
  const [permission, setPermission] = useState<ChatPermissionMode>('acceptEdits');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!cwd.trim()) {
      setError('Working directory is required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { chat } = await chatApi.create({
        title: title.trim() || undefined,
        cwd: cwd.trim(),
        model: model || undefined,
        permission_mode: permission
      });
      onCreated(chat.chat_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="panel w-full max-w-xl space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">New chat</h2>
          <button className="text-slate-500 hover:text-slate-800" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Spawns a long-lived <code className="font-mono">claude</code> CLI subprocess in the chosen
          directory. Uses your Pro account auth (no API key). Output renders as markdown so you can
          highlight passages to add personal comments.
        </p>

        <div className="space-y-3 text-sm">
          <Field label="Title (optional)">
            <input
              className="input w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Investigate slow query"
            />
          </Field>

          <Field label="Working directory">
            <RepoPicker value={cwd} onChange={setCwd} disabled={creating} />
            <div className="mt-1 text-[11px] text-slate-500">
              Pick from your GitHub repos + local clones, or paste an absolute path directly.
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <select
                className="input w-full"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Permissions">
              <select
                className="input w-full"
                value={permission}
                onChange={(e) => setPermission(e.target.value as ChatPermissionMode)}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                {PERMISSION_MODES.find((m) => m.value === permission)?.hint}
              </div>
            </Field>
          </div>
        </div>

        {error ? <div className="text-xs text-rose-600">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void create()} disabled={creating}>
            {creating ? 'Creating…' : 'Start chat'}
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
