import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';
import { IconTile } from './m3/Controls';
import { StatusPill } from './m3/Surface';
import { useDB } from '../context/AppContext';
import { prettyPhone } from '../data/store';

/*
  Ctrl/Cmd-K palette — one field that reaches any docket, customer, route or lot.

  The counter is the reason this exists. A customer says a docket number, or just their
  phone number, and the operator should not have to work out which of nine screens holds
  the answer. Searching a booking here opens it directly, because ?open=<id> is already
  a supported entry point on the packages screen.

  Three deliberate choices:
  - An empty query lists ACTIONS ONLY. A courier with thousands of dockets should not be
    handed all of them; parcels appear once there is something to narrow them with.
  - Rows are never pre-sliced before cmdk filters them. Cutting the list to the first N
    in array order and then filtering would silently hide most matches — the cap below
    is on how many are handed to the filter, not on what it may return.
  - Icons are Material Symbols and rows carry the app's own status pills, so this reads
    as part of ShippingCo rather than as a library widget dropped into it.
*/

const NAV_ACTIONS = [
  { icon: 'add_circle', label: 'New Booking', to: '/business/booking', keywords: 'create docket parcel add' },
  { icon: 'space_dashboard', label: 'Dashboard', to: '/business', keywords: 'home overview' },
  { icon: 'inventory_2', label: 'Packages', to: '/business/packages', keywords: 'parcels dockets' },
  { icon: 'layers', label: 'Lots', to: '/business/lots', keywords: 'group bags' },
  { icon: 'alt_route', label: 'Dispatch Routes', to: '/business/routes', keywords: 'trips vehicles' },
  { icon: 'forward_to_inbox', label: 'Automation Feed', to: '/business/feed', keywords: 'whatsapp messages assistant' },
  { icon: 'receipt_long', label: 'Receipts', to: '/business/receipts', keywords: 'bills print' },
  { icon: 'query_stats', label: 'Reports', to: '/business/reports', keywords: 'analytics numbers' },
  { icon: 'local_shipping', label: 'E-way Bills', to: '/business/eway', keywords: 'gst compliance' },
  { icon: 'settings', label: 'Settings', to: '/business/settings', keywords: 'business profile' },
];

/* How many parcels are handed to the filter. Enough to cover a working set without
   mounting an unbounded list on every keystroke. */
const SEARCH_POOL = 400;

/* Owns the shortcut so any shell can mount the palette with two lines. */
/** Owns the palette's open state and the Ctrl/Cmd-K shortcut that toggles it. */
export function useCommandPalette(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key && e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

export default function CommandPalette({ open, onOpenChange }) {
  const data = useDB();
  const nav = useNavigate();
  const [query, setQuery] = useState('');

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const pool = useMemo(
    () => (data ? data.bookings.slice(0, SEARCH_POOL) : []),
    [data]
  );

  if (!data) return null;

  const searching = query.trim().length > 0;

  function go(to) {
    onOpenChange(false);
    nav(to);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search a docket, customer, phone, route or lot…"
        value={query}
        onValueChange={setQuery}
      />

      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>
          <span className="muted">Nothing matches that.</span>
        </CommandEmpty>

        {searching && pool.length > 0 && (
          <CommandGroup heading="Packages">
            {pool.map((b) => (
              <CommandItem
                key={b.id}
                value={`${b.docket} ${b.name} ${b.phone} ${b.to}`}
                onSelect={() => go(`/business/packages?open=${encodeURIComponent(b.id)}`)}
                className="gap-3"
              >
                <IconTile name="inventory_2" size="sm" />
                <span className="u-grow" style={{ minWidth: 0 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{b.docket}</span>
                  <span className="muted"> · {b.name} · {b.to}</span>
                  <span className="t-body-sm muted" style={{ display: 'block' }}>{prettyPhone(b.phone)}</span>
                </span>
                <StatusPill status={b.status} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && data.routes.length > 0 && (
          <CommandGroup heading="Routes">
            {data.routes.map((r) => (
              <CommandItem
                key={r.id}
                value={`${r.code} ${r.origin} ${r.destination} ${r.mode}`}
                onSelect={() => go('/business/routes')}
                className="gap-3"
              >
                <IconTile name="alt_route" size="sm" />
                <span className="u-grow" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.origin} → {r.destination}</span>
                  <span className="muted"> · <span className="mono">{r.code}</span></span>
                </span>
                {r.status === 'delayed' && <StatusPill status="delayed" labelOverride="Delayed" />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && data.lots.length > 0 && (
          <CommandGroup heading="Lots">
            {data.lots.map((l) => (
              <CommandItem
                key={l.id}
                value={`${l.code} ${l.name}`}
                onSelect={() => go('/business/lots')}
                className="gap-3"
              >
                <IconTile name="layers" size="sm" />
                <span className="u-grow" style={{ minWidth: 0 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{l.code}</span>
                  <span className="muted"> · {l.name}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && <CommandSeparator />}

        <CommandGroup heading={searching ? 'Go to' : 'Actions'}>
          {NAV_ACTIONS.map((a) => (
            <CommandItem
              key={a.to + a.label}
              value={`${a.label} ${a.keywords}`}
              onSelect={() => go(a.to)}
              className="gap-3"
            >
              <IconTile name={a.icon} size="sm" />
              <span className="u-grow">{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>

      <div className="cmdk-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </CommandDialog>
  );
}
