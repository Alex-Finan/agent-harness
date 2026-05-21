import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Repo } from '../api';

/**
 * Searchable picker for the target repository.
 *
 * Sources:
 *   - `gh repo list` for repos owned by the user + each org they're in
 *   - local clones discovered under the configured search roots
 *
 * What you select fills in the absolute local path (the harness needs a
 * working directory, not a GH URL). Repos without a local clone are still
 * shown but disabled, with a hint to clone them first.
 */
export function RepoPicker({
  value,
  onChange,
  disabled
}: {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
}) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghAvailable, setGhAvailable] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void load(false);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function load(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listRepos({ refresh: force });
      setRepos(res.repos);
      setGhAvailable(res.ghAvailable);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.slug.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.localPath && r.localPath.toLowerCase().includes(q))
    );
  }, [repos, query]);

  function pick(repo: Repo) {
    if (!repo.localPath) return; // disabled — no local clone
    onChange(repo.localPath);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault();
        pick(filtered[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        <input
          className="input flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="/Users/alex/Developer/payabli-datalake — or pick from list"
          required
          disabled={disabled}
        />
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((o) => !o)}
          disabled={disabled || loading}
          title={open ? 'Hide repo list' : 'Browse GitHub + local repos'}
        >
          {loading ? '…' : open ? '▲' : '▼'}
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-96 overflow-hidden rounded border border-slate-300 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <input
              autoFocus
              className="input flex-1 text-sm"
              placeholder="Search by name, owner, description, or path…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className="text-xs text-slate-600 hover:text-slate-800"
              onClick={() => void load(true)}
              title="Refresh from gh CLI"
            >
              ⟳
            </button>
          </div>
          {!ghAvailable ? (
            <div className="border-b border-amber-900/40 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-700">
              gh CLI not available or unauthed — showing local clones only
            </div>
          ) : null}
          {error ? (
            <div className="border-b border-rose-900/40 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-600">
              {error}
            </div>
          ) : null}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-sm text-slate-500">Loading repos…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">
                {repos === null ? 'Loading…' : 'No repos match.'}
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {filtered.map((r, i) => {
                  const usable = r.localPath != null;
                  const highlighted = i === highlight;
                  return (
                    <li
                      key={`${r.slug}-${r.source}`}
                      className={`px-3 py-2 ${
                        usable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                      } ${highlighted && usable ? 'bg-slate-100' : 'hover:bg-slate-100/60'}`}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(r)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-900">{r.slug}</span>
                        {r.localPath ? (
                          <span className="badge bg-emerald-900/60 text-emerald-700">local</span>
                        ) : (
                          <span className="badge bg-slate-100 text-slate-500">not cloned</span>
                        )}
                        {r.source === 'local-only' ? (
                          <span className="badge bg-slate-100 text-slate-600" title="Found locally but not in gh repo list">
                            local-only
                          </span>
                        ) : null}
                      </div>
                      {r.description ? (
                        <div className="mt-0.5 truncate text-xs text-slate-600" title={r.description}>
                          {r.description}
                        </div>
                      ) : null}
                      {r.localPath ? (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={r.localPath}>
                          {r.localPath}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[10px] text-slate-600">
                          Clone it locally first to use as a target repo
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-500">
            {repos ? `${repos.length} repos` : ''} · ↑↓ to navigate · Enter to select · esc to close
          </div>
        </div>
      ) : null}
    </div>
  );
}
