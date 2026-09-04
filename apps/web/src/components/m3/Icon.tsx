import React from 'react';

export interface MsymProps {
  /** A Material Symbols ligature name, e.g. 'local_shipping'. */
  name: React.ReactNode;
  /** Draws the filled variant of the glyph. */
  fill?: boolean;
  /** Any CSS font-size value; the icon font scales on font-size, not width. */
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function Msym({ name, fill, size, className = '', style }: MsymProps) {
  return (
    <span
      className={`msym${fill ? ' fill' : ''}${className ? ' ' + className : ''}`}
      style={{ fontSize: size, ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

/* M3 state-layer ripple */
export function useRipple() {
  return React.useCallback((e: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
    const host = e.currentTarget as HTMLElement | null;
    if (!host || e.button !== 0) return;
    const rect = host.getBoundingClientRect();
    const d = Math.max(rect.width, rect.height) * 2.1;
    const s = document.createElement('span');
    s.className = 'm-ripple';
    s.style.width = s.style.height = `${d}px`;
    s.style.left = `${e.clientX - rect.left - d / 2}px`;
    s.style.top = `${e.clientY - rect.top - d / 2}px`;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(s);
    setTimeout(() => s.remove(), 560);
  }, []);
}

/**
 * Joins class names, dropping anything falsy — so `cond && 'cls'` reads inline.
 * Takes `unknown` because the guard is often a value rather than a boolean: `error &&
 * 'err'` yields whatever `error` is when it is falsy, and that is exactly the case this
 * helper exists to swallow.
 */
export function cx(...parts: unknown[]) {
  return parts.filter(Boolean).join(' ');
}
