import React, { useEffect, useState } from 'react';
import { cx } from './Icon';

/*
  Ring — one percentage, drawn.

  Built for the dashboard's assistant block, where the single most important claim the
  product makes is "the assistant closed this share of customer questions without you".
  A number alone states that; the ring lets an operator who does not read English
  fluently see it at a glance, which is the whole design brief for this app.

  Holds the app's rules: the unfilled part is the neutral --track (the one place a
  non-white fill is allowed, because a meter needs a visible remainder), the arc is
  plain primary, and there is no gradient or glow. The arc draws itself once on mount —
  motion that reports a value rather than decorating one — and is static outright when
  the viewer asks for reduced motion.
*/

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

export interface RingProps {
  /** Percentage filled, 0 to 100. */
  value: number;
  size?: number;
  stroke?: number;
  label?: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}

export function Ring({ value, size = 96, stroke = 8, label, sub, className }: RingProps) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const [shown, setShown] = useState(() => (prefersReduced() ? pct : 0));

  useEffect(() => {
    if (prefersReduced()) { setShown(pct); return; }
    /* One frame's delay so the transition has a zero state to move away from. */
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div className={cx('ring', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="ring-track"
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke}
        />
        <circle
          className="ring-arc"
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-mid">
        <b className="ring-val">{Math.round(pct)}<i>%</i></b>
        {label && <span className="ring-lbl">{label}</span>}
      </span>
      {sub && <span className="sr-only">{sub}</span>}
    </div>
  );
}
