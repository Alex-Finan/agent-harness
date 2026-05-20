import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type TranscriptMessage } from '../api';

export function TranscriptStream({
  runId,
  logFiles,
  appendByLog,
  resetTick
}: {
  runId: string;
  logFiles: string[];
  appendByLog: Record<string, TranscriptMessage[]>;
  resetTick: Record<string, number>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [base, setBase] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Default selection: the most-recently modified log (i.e. last in alphabetical
  // order from the API since they sort by file name with sprint+retry suffix).
  useEffect(() => {
    if (!selected && logFiles.length > 0) {
      // Prefer the file the dispatcher just appended to (largest append count).
      const best =
        Object.entries(appendByLog).sort((a, b) => b[1].length - a[1].length)[0]?.[0] ??
        logFiles[logFiles.length - 1];
      setSelected(best);
    }
  }, [logFiles, appendByLog, selected]);

  const incomingAppend = selected ? appendByLog[selected] ?? [] : [];
  const incomingReset = selected ? resetTick[selected] ?? 0 : 0;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    api
      .getTranscript(runId, selected)
      .then((t) => {
        if (!cancelled) setBase(t.lines);
      })
      .catch(() => {
        if (!cancelled) setBase([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, selected, incomingReset]);

  useEffect(() => {
    // Auto-scroll on new content.
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [incomingAppend.length, base.length, selected]);

  const allLines = useMemo<TranscriptMessage[]>(() => {
    return [...base, ...incomingAppend];
  }, [base, incomingAppend]);

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="text-sm font-semibold">live transcript</div>
        <select
          className="input max-w-xs"
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value)}
        >
          {logFiles.length === 0 ? <option value="">(no logs yet)</option> : null}
          {logFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto p-3">
        {loading && base.length === 0 ? (
          <div className="text-sm text-slate-500">loading…</div>
        ) : null}
        {allLines.length === 0 && !loading ? (
          <div className="text-sm text-slate-500">
            No transcript content yet. Watch this pane during a planner/executor/evaluator run.
          </div>
        ) : null}
        <ol className="space-y-2">
          {allLines.map((line, i) => (
            <TranscriptItem key={i} message={line} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function TranscriptItem({ message }: { message: TranscriptMessage }) {
  if (message.type === 'system') {
    return (
      <li className="rounded border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">system</span>
        {message.subtype ? <span className="ml-2 text-slate-500">{String(message.subtype)}</span> : null}
      </li>
    );
  }

  if (message.type === 'assistant') {
    const m = message as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } };
    const content = m.message?.content ?? [];
    return (
      <li className="rounded border border-emerald-900/60 bg-emerald-900/10 px-3 py-2">
        <div className="mb-1 text-xs font-semibold text-emerald-400">assistant</div>
        <div className="space-y-2">
          {content.map((c, i) => {
            if (c.type === 'text') {
              return (
                <div key={i} className="whitespace-pre-wrap text-sm text-slate-100">
                  {c.text}
                </div>
              );
            }
            if (c.type === 'tool_use') {
              return (
                <div key={i} className="rounded bg-slate-950 px-2 py-1 font-mono text-xs text-sky-300">
                  ↪ {c.name}({truncate(JSON.stringify(c.input), 240)})
                </div>
              );
            }
            return (
              <div key={i} className="text-xs text-slate-400">
                ({c.type})
              </div>
            );
          })}
        </div>
      </li>
    );
  }

  if (message.type === 'user') {
    const m = message as { message?: { content?: Array<{ type: string; content?: unknown }> } };
    const content = m.message?.content ?? [];
    return (
      <li className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
        <div className="mb-1 font-semibold text-slate-400">tool result</div>
        <div className="space-y-1">
          {content.map((c, i) => (
            <div key={i} className="font-mono text-slate-300">
              {truncate(JSON.stringify(c.content ?? c), 600)}
            </div>
          ))}
        </div>
      </li>
    );
  }

  if (message.type === 'result') {
    const m = message as { subtype?: string; result?: unknown; total_cost_usd?: number };
    const ok = m.subtype === 'success';
    return (
      <li
        className={`rounded border px-3 py-2 text-sm ${
          ok
            ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
            : 'border-rose-700 bg-rose-900/40 text-rose-200'
        }`}
      >
        <div className="mb-1 font-semibold">result · {m.subtype}</div>
        <div className="text-xs">cost: ${(m.total_cost_usd ?? 0).toFixed(4)}</div>
        {ok && typeof m.result === 'string' ? (
          <div className="mt-1 whitespace-pre-wrap text-xs">{truncate(m.result, 600)}</div>
        ) : null}
      </li>
    );
  }

  if (message.type === 'raw') {
    const m = message as { text: string };
    return (
      <li className="rounded border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-400">
        {m.text}
      </li>
    );
  }

  return null;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
