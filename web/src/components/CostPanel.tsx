import type { RunCostSummary } from '../api';
import { formatCost, formatDuration, formatTokens } from '../lib/format';

export function CostPanel({ cost }: { cost: RunCostSummary }) {
  return (
    <div className="panel">
      <div className="border-b border-slate-800 px-4 py-2 text-sm font-semibold">cost</div>
      <div className="grid grid-cols-3 gap-3 border-b border-slate-800 px-4 py-3">
        <Tile label="Total" value={formatCost(cost.totalUsd)} highlight />
        <Tile label="Sessions" value={String(cost.entries.length)} />
        <Tile
          label="Total duration"
          value={formatDuration(cost.entries.reduce((acc, e) => acc + (e.durationMs ?? 0), 0))}
        />
      </div>
      <div className="grid grid-cols-3 gap-3 border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
        {Object.entries(cost.perRole).length === 0 ? (
          <div className="col-span-3 text-slate-500">No cost data yet.</div>
        ) : (
          Object.entries(cost.perRole).map(([role, usd]) => (
            <div key={role}>
              <div className="uppercase tracking-wide text-slate-500">{role}</div>
              <div className="text-base text-slate-100">{formatCost(usd)}</div>
            </div>
          ))
        )}
      </div>
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
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {cost.entries.map((e) => (
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${highlight ? 'text-emerald-400' : 'text-slate-100'}`}>
        {value}
      </div>
    </div>
  );
}
