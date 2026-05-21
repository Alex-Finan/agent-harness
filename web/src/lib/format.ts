export function formatCost(usd: number | undefined | null): string {
  if (usd === undefined || usd === null) return '$0.00';
  if (usd >= 10) return `$${usd.toFixed(2)}`;
  if (usd >= 0.1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m - h * 60;
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  }
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Extract a short, readable preview of *why* a verdict failed.
 *
 * Strategy: prefer a "Required fixes" / "Reason" / "Notes" section in the
 * verdict markdown; otherwise fall back to the first non-heading prose lines.
 * Strip checklist syntax (✅ ❌ ⚠️) and markdown emphasis to keep it scannable
 * in a header context.
 */
export function verdictExcerpt(md: string, maxChars = 280): string {
  if (!md) return '';

  // Prefer body of a "Required fixes" / "Reason" / "Notes" section.
  // No multiline flag on purpose — `$` then only matches end-of-string, not
  // end-of-line, so the non-greedy capture doesn't stop at the first newline.
  const preferred = /(?:^|\n)##+\s+(required fixes|reason|notes?)\b[^\n]*\n([\s\S]+?)(?=\n##+\s|$)/i.exec(md);
  let body = preferred ? preferred[2] : md;

  // Strip everything down to readable prose.
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^#{1,6}\s/.test(l)) // drop headings
    .filter((l) => !/^verdict\s*:/i.test(l))
    .map((l) =>
      l
        .replace(/^[-*]\s*/, '• ') // bullet to dot
        .replace(/^\d+\.\s*/, '• ')
        .replace(/[`*_]/g, '')
        .replace(/^✅|^❌|^⚠️/u, (m) => m + ' ')
        .replace(/\s+/g, ' ')
    );

  const text = lines.join(' · ').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + '…';
}
