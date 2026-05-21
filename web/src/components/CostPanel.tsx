import { useState } from 'react';
import type { RunCostSummary } from '../api';
import { formatCost, formatDuration, formatTokens } from '../lib/format';

/**
 * Cost panel — compact summary by default, full table behind an expand toggle.
 *
 * The full per-session breakdown is useful when debugging cost spikes, but
 * 95% of the time the operator only wants to know "how much have I spent."
 */
export function CostPanel({ cost }: { cost: RunCostSummary }) {
  const [showDetails, setShowDetails] = useState(false);
  const totalDuration = cost.entries.reduce((acc, e) => acc + (e.durationMs ?? 0), 0);
  const sessions = cost.entries.length;
  const perRoleEntries = Object.entries(cost.perRole);

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-slate-800">cost</span>
          <span className="text-lg font-semibold tabular-nums text-emerald-600">
            {formatCost(cost.totalUsd)}
          </span>
          <span className="text-xs text-slate-500">
            {sessions} session{sessions === 1 ? '' : 's'} · {formatDuration(totalDuration)}
          </span>
        </div>
        <button
          className="text-xs text-slate-600 hover:text-slate-800"
          onClick={() => setShowDetails((x) => !x)}
        >
          {showDetails ? 'hide details ▴' : 'details ▾'}
        </button>
      </div>

      {/* Per-role one-liner — always visible since it's just 1 row */}
      {perRoleEntries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-xs">
          {perRoleEntries.map(([role, usd]) => (
            <span key={role} className="text-slate-600">
              <span className="uppercase tracking-wide text-slate-500">{role}</span>
              <span className="ml-1.5 font-mono text-slate-800">{formatCost(usd)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
          No cost data yet.
        </div>
      )}

      {showDetails ? (
        <div className="max-h-[40vh] overflow-y-auto px-4 py-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left font-medium">log</th>
                <th className="text-right font-medium">$</th>
                <th className="text-right font-medium">dur</th>
                <th className="text-right font-medium">turns</th>
                <th className="text-right font-medium">in</th>
                <th className="text-right font-medium">out</th>
                <th className="text-right font-medium">cache→</th>
                <th className="text-right font-medium">cache↓</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {cost.entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-2 text-center text-slate-500">
                    No sessions yet.
                  </td>
                </tr>
              ) : (
                cost.entries.map((e) => (
                  <tr key={e.logFile}>
                    <td className="py-1 font-mono">{e.logFile}</td>
                    <td className="py-1 text-right">{formatCost(e.costUsd)}</td>
                    <td className="py-1 text-right">{formatDuration(e.durationMs)}</td>
                    <td className="py-1 text-right">{e.numTurns ?? '—'}</td>
                    <td className="py-1 text-right">{formatTokens(e.inputTokens)}</td>
                    <td className="py-1 text-right">{formatTokens(e.outputTokens)}</td>
                    <td className="py-1 text-right">{formatTokens(e.cacheCreationTokens)}</td>
                    <td className="py-1 text-right">{formatTokens(e.cacheReadTokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
