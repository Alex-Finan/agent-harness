import { useEffect, useMemo, useState } from 'react';
import { api, type TranscriptMessage } from '../api';

/**
 * Single-line "what is the agent doing right now" indicator shown in the run
 * header. Derived from the most-recent assistant message in the active
 * dispatch's log file. Falls back to a neutral placeholder when nothing is
 * streaming.
 *
 * Why: when an agent is running, the operator's question is "what step are
 * we on?" The transcript pane below answers it eventually, but you have to
 * scroll/scan. This pulls the latest meaningful message up to the header.
 */
export function ActivityLine({
  runId,
  dispatching,
  logFiles,
  appendByLog
}: {
  runId: string;
  dispatching: { role: string; finished: boolean } | null;
  logFiles: string[];
  appendByLog: Record<string, TranscriptMessage[]>;
}) {
  // The active log = the most recently appended-to log, or the
  // dispatch-matching role if no append has fired yet, or simply the
  // latest log file in the directory (useful when the run was running
  // before this page opened — show the last thing it did).
  const activeLog = useMemo(() => {
    if (Object.keys(appendByLog).length > 0) {
      return Object.entries(appendByLog).sort((a, b) => b[1].length - a[1].length)[0][0];
    }
    if (logFiles.length === 0) return null;
    if (dispatching?.role) {
      const match = [...logFiles].reverse().find((f) => f.includes(dispatching.role));
      if (match) return match;
    }
    // Logs are alphabetically sorted by filename (sprintNN-role.log), so the
    // last entry is the most-recent role on the most-recent sprint.
    return logFiles[logFiles.length - 1];
  }, [appendByLog, dispatching, logFiles]);

  // For a quick load we also fetch the tail of the active log so the line
  // isn't blank when reopening a run that was already running before page load.
  const [baseTail, setBaseTail] = useState<TranscriptMessage[]>([]);
  useEffect(() => {
    if (!activeLog) {
      setBaseTail([]);
      return;
    }
    let cancelled = false;
    api
      .getTranscript(runId, activeLog)
      .then((t) => {
        if (cancelled) return;
        setBaseTail(t.lines.slice(-20));
      })
      .catch(() => {
        if (!cancelled) setBaseTail([]);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, activeLog]);

  const allRecent = useMemo<TranscriptMessage[]>(() => {
    const incoming = activeLog ? appendByLog[activeLog] ?? [] : [];
    return [...baseTail, ...incoming];
  }, [baseTail, activeLog, appendByLog]);

  const activity = useMemo(() => deriveActivity(allRecent), [allRecent]);

  // Only render during active dispatch — when the run is idle, the latest
  // tool_use is reference info that doesn't help anyone. The transcript
  // pane (kept for debug) carries history if needed.
  if (!dispatching) return null;
  if (!activity) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span className="text-slate-500">{dispatching.role} starting…</span>
      </div>
    );
  }

  const roleLabel = dispatching.role;

  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <span className="truncate text-slate-600" title={activity.title}>
        <span className="font-medium text-slate-700">{roleLabel}</span>
        <span className="mx-1.5 text-slate-600">·</span>
        <span>{activity.summary}</span>
      </span>
    </div>
  );
}

interface DerivedActivity {
  role: string;
  summary: string;
  title: string;
}

/**
 * Walk recent transcript messages and pull the most recent meaningful piece
 * of work — preferring a tool_use over plain text since "Editing file X" is
 * more useful than "I'll now look at..."
 */
function deriveActivity(messages: TranscriptMessage[]): DerivedActivity | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      type?: string;
      message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
    };
    if (m.type !== 'assistant') continue;
    const content = m.message?.content ?? [];
    // Prefer the most recent tool_use within this message
    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j];
      if (c.type === 'tool_use') {
        return {
          role: 'assistant',
          summary: summarizeToolUse(c.name ?? 'tool', c.input),
          title: JSON.stringify({ name: c.name, input: c.input }).slice(0, 400)
        };
      }
    }
    // Fall back to text content
    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j];
      if (c.type === 'text' && c.text) {
        const trimmed = c.text.trim().split('\n')[0].slice(0, 160);
        return { role: 'assistant', summary: trimmed, title: c.text };
      }
    }
  }
  return null;
}

function summarizeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) =>
    keys.map((k) => i[k]).find((v) => typeof v === 'string') as string | undefined;

  switch (name) {
    case 'Read': {
      const path = pick('file_path');
      return path ? `Reading ${shortPath(path)}` : 'Reading a file';
    }
    case 'Write': {
      const path = pick('file_path');
      return path ? `Writing ${shortPath(path)}` : 'Writing a file';
    }
    case 'Edit': {
      const path = pick('file_path');
      return path ? `Editing ${shortPath(path)}` : 'Editing a file';
    }
    case 'Bash': {
      const cmd = pick('command');
      return cmd ? `$ ${cmd.split('\n')[0].slice(0, 120)}` : 'Running a command';
    }
    case 'Grep': {
      const pattern = pick('pattern');
      return pattern ? `Grepping ${pattern.slice(0, 60)}` : 'Searching';
    }
    case 'Glob': {
      const pattern = pick('pattern');
      return pattern ? `Globbing ${pattern}` : 'Listing files';
    }
    case 'TodoWrite':
      return 'Updating todos';
    default:
      return `${name}(…)`;
  }
}

function shortPath(p: string): string {
  // Show last 2 segments to keep the line readable
  const parts = p.split('/');
  if (parts.length <= 2) return p;
  return parts.slice(-2).join('/');
}
