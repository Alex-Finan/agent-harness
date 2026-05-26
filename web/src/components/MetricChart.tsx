import type { TrialResult } from '../api';

interface MetricChartProps {
  trials: TrialResult[];
  width?: number;
  height?: number;
}

const PADDING = { top: 16, right: 16, bottom: 32, left: 48 };

/**
 * SVG line chart showing metric value vs. trial number.
 * - Green circles (#22c55e) for improved trials
 * - Red circles (#ef4444) for regressed trials
 * - Gray circles for no_metric trials
 * No external dependencies — plain SVG elements only.
 */
export function MetricChart({ trials, width = 560, height = 220 }: MetricChartProps) {
  const visibleTrials = trials.filter((t) => t.metric !== null);

  if (trials.length === 0 || visibleTrials.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-400"
      >
        No data yet
      </div>
    );
  }

  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top - PADDING.bottom;

  // X domain: 1 to last trial number
  const xMin = 1;
  const xMax = Math.max(...trials.map((t) => t.trial));

  // Y domain: min to max of visible metrics, with a small margin
  const yValues = visibleTrials.map((t) => t.metric as number);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = yMax - yMin || 1;
  const yPad = yRange * 0.1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  function xScale(trial: number): number {
    if (xMax === xMin) return chartWidth / 2;
    return ((trial - xMin) / (xMax - xMin)) * chartWidth;
  }

  function yScale(value: number): number {
    return chartHeight - ((value - yLo) / (yHi - yLo)) * chartHeight;
  }

  // Build polyline points from visible trials only
  const linePoints = visibleTrials
    .sort((a, b) => a.trial - b.trial)
    .map((t) => `${xScale(t.trial)},${yScale(t.metric as number)}`)
    .join(' ');

  // Y-axis tick values
  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => {
    return yLo + (i / yTicks) * (yHi - yLo);
  });

  // X-axis tick values — show up to 6 ticks
  const xTickCount = Math.min(6, xMax);
  const xTickStep = Math.max(1, Math.floor(xMax / xTickCount));
  const xTickValues = Array.from({ length: Math.ceil(xMax / xTickStep) }, (_, i) => (i + 1) * xTickStep).filter(
    (v) => v <= xMax
  );
  if (!xTickValues.includes(1)) xTickValues.unshift(1);

  function dotColor(t: TrialResult): string {
    if (t.status === 'improved') return '#22c55e';
    if (t.status === 'regressed') return '#ef4444';
    return '#94a3b8'; // gray for no_metric
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-label="Metric progress chart"
    >
      <g transform={`translate(${PADDING.left},${PADDING.top})`}>
        {/* Grid lines */}
        {yTickValues.map((v, i) => (
          <line
            key={i}
            x1={0}
            y1={yScale(v)}
            x2={chartWidth}
            y2={yScale(v)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* Y-axis */}
        <line x1={0} y1={0} x2={0} y2={chartHeight} stroke="#cbd5e1" strokeWidth={1} />

        {/* X-axis */}
        <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#cbd5e1" strokeWidth={1} />

        {/* Y-axis tick labels */}
        {yTickValues.map((v, i) => (
          <text
            key={i}
            x={-6}
            y={yScale(v)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="#64748b"
          >
            {v.toFixed(3)}
          </text>
        ))}

        {/* X-axis tick labels */}
        {xTickValues.map((v) => (
          <text
            key={v}
            x={xScale(v)}
            y={chartHeight + 16}
            textAnchor="middle"
            fontSize={10}
            fill="#64748b"
          >
            {v}
          </text>
        ))}

        {/* Metric line */}
        {visibleTrials.length > 1 && (
          <polyline
            points={linePoints}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Data points */}
        {trials.map((t) => {
          if (t.metric === null) {
            // No-metric: render a small gray dot on the x-axis
            return (
              <circle
                key={t.trial}
                cx={xScale(t.trial)}
                cy={chartHeight}
                r={4}
                fill={dotColor(t)}
                opacity={0.6}
              />
            );
          }
          return (
            <circle
              key={t.trial}
              cx={xScale(t.trial)}
              cy={yScale(t.metric)}
              r={5}
              fill={dotColor(t)}
              stroke="white"
              strokeWidth={1.5}
            >
              <title>Trial {t.trial}: M={t.metric} ({t.status})</title>
            </circle>
          );
        })}
      </g>
    </svg>
  );
}
