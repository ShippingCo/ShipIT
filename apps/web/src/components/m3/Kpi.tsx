import React from 'react';
import { Msym, cx } from './Icon';

/*
  KpiCard — the dashboard's headline figures.

  Each card answers three questions in the order an operator asks them: what is this,
  how big is it now, and which way is it going. The sparkline is the third answer, so
  it is deliberately small and unlabelled — it carries shape, not readings. Anyone who
  needs the readings taps through to the screen behind the card.

  The sparkline is hand-drawn SVG rather than a charting library: at this size a chart
  library spends kilobytes on axes, tooltips and responsive plumbing that a 40px trace
  never shows. The big interactive chart on this screen does use Recharts, where that
  machinery earns its place.
*/

/* Catmull-Rom through the points, converted to cubic beziers. Straight polylines read
   as jagged noise at this height; a smoothed trace reads as a trend. */
function smoothPath(points) {
  if (points.length < 2) return '';
  const d = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return d.join(' ');
}

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Colour role for the stroke. */
  tone?: string;
}

export function Sparkline({ values, width = 240, height = 40, tone }: SparklineProps) {
  const nums = (values || []).map((v) => Number(v) || 0);
  if (nums.length < 2) return null;

  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  /* Inset by the stroke so the trace never clips at the top or bottom edge. */
  const pad = 3;
  const points = nums.map((v, i) => ({
    x: (i / (nums.length - 1)) * width,
    y: pad + (1 - (v - min) / span) * (height - pad * 2),
  }));

  const line = smoothPath(points);
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = points[points.length - 1];
  const id = React.useId();

  return (
    <svg
      className={cx('spark', tone && `spark-${tone}`)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="spark-stop-a" />
          <stop offset="100%" className="spark-stop-b" />
        </linearGradient>
      </defs>
      <path className="spark-area" d={area} fill={`url(#sg-${id})`} />
      <path className="spark-line" d={line} fill="none" />
      {/* preserveAspectRatio="none" stretches the x axis, which would turn a round dot
          into an ellipse — so the head of the trace is drawn as a short flat cap. */}
      <line className="spark-head" x1={last.x - 0.5} y1={last.y} x2={last.x} y2={last.y} />
    </svg>
  );
}

export interface DeltaProps {
  /** Percentage change. Positive is drawn as up, negative as down. */
  value?: number | null;
  suffix?: React.ReactNode;
}

export function Delta({ value, suffix = 'vs yesterday' }: DeltaProps) {
  const n = Number(value) || 0;
  const icon = n > 0 ? 'arrow_upward' : n < 0 ? 'arrow_downward' : 'remove';
  return (
    <span className={cx('delta', n === 0 && 'is-flat')}>
      <Msym name={icon} />
      {n === 0 ? `same ${suffix}` : `${Math.abs(n)} ${suffix}`}
    </span>
  );
}

export interface KpiCardProps {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  value?: React.ReactNode;
  /** Small caption under the figure. */
  foot?: React.ReactNode;
  delta?: number | null;
  deltaSuffix?: React.ReactNode;
  /** Values for the inline sparkline, if the figure has a trend worth drawing. */
  series?: number[];
  tone?: string;
  onClick?: () => void;
  className?: string;
}

export function KpiCard({ icon, label, value, foot, delta, deltaSuffix, series, tone, onClick, className }: KpiCardProps) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={cx('kpic', interactive && 'is-link', tone && `tone-${tone}`, className)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
    >
      <div className="kpic-top">
        <span className="kpic-ic"><Msym name={icon} /></span>
        <span className="kpic-label">{label}</span>
        {interactive && <Msym name="arrow_forward" className="kpic-go" />}
      </div>

      <div className="kpic-value">{value}</div>
      <div className="kpic-foot">
        {delta !== undefined && delta !== null
          ? <Delta value={delta} suffix={deltaSuffix} />
          : <span className="kpic-foot-t">{foot}</span>}
      </div>

      {series && series.length > 1 && (
        <div className="kpic-spark"><Sparkline values={series} tone={tone} /></div>
      )}
    </div>
  );
}
