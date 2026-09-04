import React, { useEffect, useRef, useState } from 'react';
import { Msym, cx } from './Icon';
import { IconButton } from './Button';
import type { Attachment, AttachmentKind } from '../../data/types';

/* ============================================================
   Shared page controls — one implementation each, used everywhere.
   Search, filters, date range and icon tiles were all being hand-rolled
   per page, which is why the pages drifted apart visually.
   ============================================================ */

/** Rounded search field. `shortcut` shows a key hint and focuses on that key. */
export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Key that focuses the field from anywhere. Pass empty to disable. */
  shortcut?: string;
  autoFocus?: boolean;
  label?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search', shortcut = '/', autoFocus, label }: SearchBarProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '');
      if (e.key === shortcut && !typing) { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'Escape' && document.activeElement === ref.current) onChange('');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut, onChange]);

  return (
    <div className="searchbar">
      <Msym name="search" />
      <input
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
      />
      {value && <IconButton icon="close" label="Clear search" size="sm" onClick={() => onChange('')} />}
    </div>
  );
}

/** Pill filters. Pass `counts` to show a live number on each chip. */
export interface FilterChipOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface FilterChipsProps {
  options: FilterChipOption[];
  value: string;
  onChange: (value: string) => void;
  /** Live counts keyed by option value, shown on each chip. */
  counts?: Record<string, number | undefined>;
  className?: string;
  children?: React.ReactNode;
}

export function FilterChips({ options, value, onChange, counts, className, children }: FilterChipsProps) {
  return (
    <div className={cx('chips-row', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx('fchip', value === o.value && 'on')}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Msym name={o.icon} />}
          {o.label}
          {counts && <span className="fchip-n">{counts[o.value] ?? 0}</span>}
        </button>
      ))}
      {children}
    </div>
  );
}

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'custom';

/** Both ends are 'YYYY-MM-DD' as typed into a date input, or empty for open-ended. */
export interface CustomRange {
  from?: string;
  to?: string;
}

export const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

/** Resolves a preset (or custom from/to) to a millisecond window. */
export function dateWindow(preset: DatePreset, custom?: CustomRange): [number, number] {
  const now = new Date();
  if (preset === 'today') return [new Date(now).setHours(0, 0, 0, 0), Infinity];
  if (preset === 'week') return [now.getTime() - 7 * 864e5, Infinity];
  if (preset === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity];
  if (preset === 'custom') {
    const from = custom?.from ? new Date(custom.from).setHours(0, 0, 0, 0) : 0;
    const to = custom?.to ? new Date(custom.to).setHours(23, 59, 59, 999) : Infinity;
    return [from, to];
  }
  return [0, Infinity];
}

/**
 * Date filter as a dropdown, deliberately NOT a chip row — a second row of pills is
 * indistinguishable from the status filters sitting above it.
 */
export interface DateFilterProps {
  preset: DatePreset;
  onPreset: (preset: DatePreset) => void;
  custom?: CustomRange;
  onCustom: (range: CustomRange) => void;
}

export function DateFilter({ preset, onPreset, custom, onCustom }: DateFilterProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const current = DATE_PRESETS.find((p) => p.value === preset) ?? DATE_PRESETS[0]!;
  const label = preset === 'custom' && (custom?.from || custom?.to)
    ? `${custom?.from || '…'} → ${custom?.to || '…'}`
    : current.label;
  const active = preset !== 'all';

  return (
    <div className="datefilter" ref={wrap}>
      <button
        type="button"
        className={cx('datefilter-btn', active && 'on')}
        aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Msym name="calendar_month" />
        <span>{label}</span>
        <Msym name={open ? 'expand_less' : 'expand_more'} />
      </button>

      {open && (
        <div className="datefilter-pop" role="dialog" aria-label="Filter by date">
          {DATE_PRESETS.filter((p) => p.value !== 'custom').map((p) => (
            <button
              key={p.value} type="button"
              className={cx('datefilter-opt', preset === p.value && 'on')}
              onClick={() => { onPreset(p.value); setOpen(false); }}
            >
              {p.label}
              {preset === p.value && <Msym name="check" />}
            </button>
          ))}
          <div className="datefilter-sep" />
          <div className="datefilter-custom">
            <label>
              <span>From</span>
              <input type="date" value={custom?.from || ''} max={custom?.to || undefined}
                onChange={(e) => { onCustom({ ...custom, from: e.target.value }); onPreset('custom'); }} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={custom?.to || ''} min={custom?.from || undefined}
                onChange={(e) => { onCustom({ ...custom, to: e.target.value }); onPreset('custom'); }} />
            </label>
          </div>
          {active && (
            <button type="button" className="datefilter-clear"
              onClick={() => { onPreset('all'); onCustom({ from: '', to: '' }); setOpen(false); }}>
              Clear date filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The small bordered icon square used beside section titles and stats. */
export interface IconTileProps {
  name: React.ReactNode;
  /** Colour role: success, warning, error, info. Applied to the ring, never as a fill. */
  tone?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function IconTile({ name, tone, size = 'md', className }: IconTileProps) {
  return (
    <span className={cx('itile', tone && `tone-${tone}`, size === 'sm' && 'itile-sm', size === 'lg' && 'itile-lg', className)}>
      <Msym name={name} />
    </span>
  );
}

interface KindSpec {
  accept: string;
  icon: string;
  label: string;
  /** Asks a phone for the camera or mic directly instead of the file browser. */
  capture?: 'environment' | 'user';
}

const KIND: Record<AttachmentKind, KindSpec> = {
  image: { accept: 'image/*', icon: 'photo_camera', label: 'Photo', capture: 'environment' },
  video: { accept: 'video/*', icon: 'videocam', label: 'Video', capture: 'environment' },
  audio: { accept: 'audio/*', icon: 'mic', label: 'Voice note' },
};

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Photo / video / voice note attached to a booking. Images are downscaled;
 * video and audio are stored as-is, so they are size-capped to keep
 * localStorage usable.
 */
export interface AttachmentPickerProps {
  items?: Attachment[];
  onChange: (items: Attachment[]) => void;
  onError?: (message: string) => void;
}

export function AttachmentPicker({ items, onChange, onError }: AttachmentPickerProps) {
  const refs: Record<AttachmentKind, React.RefObject<HTMLInputElement>> = {
    image: useRef<HTMLInputElement>(null),
    video: useRef<HTMLInputElement>(null),
    audio: useRef<HTMLInputElement>(null),
  };
  const [busy, setBusy] = useState(false);

  async function add(kind: AttachmentKind, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      onError?.(`That ${KIND[kind].label.toLowerCase()} is too large (max 8 MB).`);
      return;
    }
    setBusy(true);
    try {
      let url: string;
      if (kind === 'image') {
        const { downscaleImage } = await import('../../utils/image');
        url = await downscaleImage(file);
      } else {
        url = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = rej;
          fr.readAsDataURL(file);
        });
      }
      onChange([...(items || []), { kind, url, name: file.name, size: file.size }]);
    } catch {
      onError?.('Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  const remove = (i: number) => onChange((items || []).filter((_, x) => x !== i));

  return (
    <div className="attach">
      <div className="attach-buttons">
        {(Object.entries(KIND) as Array<[AttachmentKind, KindSpec]>).map(([kind, k]) => (
          <button key={kind} type="button" className="attach-btn" disabled={busy}
            onClick={() => refs[kind].current?.click()}>
            <Msym name={k.icon} />
            {k.label}
          </button>
        ))}
        {(Object.entries(KIND) as Array<[AttachmentKind, KindSpec]>).map(([kind, k]) => (
          <input key={kind} ref={refs[kind]} type="file" accept={k.accept} capture={k.capture}
            hidden onChange={(e) => add(kind, e)} />
        ))}
      </div>

      {(items || []).length > 0 && (
        <ul className="attach-list">
          {(items || []).map((a, i) => (
            <li key={i}>
              {a.kind === 'image' && <img src={a.url} alt="" />}
              {a.kind === 'video' && <video src={a.url} controls preload="metadata" />}
              {a.kind === 'audio' && <audio src={a.url} controls preload="metadata" />}
              <div className="u-grow" style={{ minWidth: 0 }}>
                <div className="attach-name">{a.name || KIND[a.kind]?.label}</div>
                <div className="attach-meta">{KIND[a.kind]?.label} · {Math.round((a.size || 0) / 1024)} KB</div>
              </div>
              <IconButton icon="delete" label="Remove attachment" size="sm" onClick={() => remove(i)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
