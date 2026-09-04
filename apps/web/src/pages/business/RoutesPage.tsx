import React, { useState } from 'react';
import { Msym } from '../../components/m3/Icon';
import { TextField, SelectField } from '../../components/m3/Input';
import { Button, Checkbox } from '../../components/m3/Button';
import { Card, EmptyState } from '../../components/m3/Surface';
import { Dialog } from '../../components/m3/Dialog';
import { useToast } from '../../components/m3/Snackbar';
import {
  createRoute, postRouteEvent, attachToRoute, bookingsOfRoute, queueMsg,
  fmtDT, CITIES,
} from '../../data/store';
import { useDB } from '../../context/AppContext';
import type { RouteEventKind } from '../../data/types';

const MODE_ICON = { Flight: 'flight', Train: 'train', Road: 'local_shipping', Ship: 'directions_boat' };
const REASONS = [
  'Heavy fog / low visibility',
  'Rain / weather conditions',
  'Flight delayed at source airport',
  'Traffic congestion en route',
  'Technical issue with vehicle',
  'High volume at sorting hub',
];

const startOfToday = () => new Date().setHours(0, 0, 0, 0);
const GROUPS = [
  { key: 'today', label: 'Today', match: (r) => r.status !== 'arrived' && r.departAt < startOfToday() + 864e5 },
  { key: 'later', label: 'Upcoming', match: (r) => r.status !== 'arrived' && r.departAt >= startOfToday() + 864e5 },
  { key: 'done', label: 'Completed', match: (r) => r.status === 'arrived' },
];

const ROUTE_STATUS = (r) =>
  r.status === 'delayed' ? { cls: 'st-delayed', label: 'DELAYED' }
  : r.status === 'departed' ? { cls: 'st-dispatched', label: 'DEPARTED' }
  : r.status === 'arrived' ? { cls: 'st-delivered', label: 'ARRIVED' }
  : { cls: 'st-booked', label: 'SCHEDULED' };

export default function RoutesPage() {
  const data = useDB();
  const [planOpen, setPlanOpen] = useState(false);

  return (
    <div className="page">
      <div className="page-actions">
        <Button icon="add" onClick={() => setPlanOpen(true)}>Plan Route</Button>
      </div>

      {GROUPS.map((g) => {
        const rows = data.routes.filter(g.match);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="rt-group">
            <div className="section-label">{g.label}<span className="count-note">{rows.length}</span></div>
            <div style={{ display: 'grid', gap: 14 }}>
              {rows.map((r) => <RouteCard key={r.id} r={r} />)}
            </div>
          </section>
        );
      })}

      {!data.routes.length && (
        <Card>
          <EmptyState icon="alt_route" title="No routes yet" sub='Plan a route like "Ahmedabad → Mumbai, Flight AI-888" and attach lots.' />
        </Card>
      )}

      <PlanRouteDialog open={planOpen} onClose={() => setPlanOpen(false)} />
    </div>
  );
}

function RouteCard({ r }) {
  const data = useDB();
  const toast = useToast();
  const pkgs = bookingsOfRoute(r);
  const st = ROUTE_STATUS(r);
  const active = pkgs.filter((b) => b.status !== 'delivered').length;

  const [evKind, setEvKind] = useState<RouteEventKind | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);

  return (
    <Card>
      <div className="rt">
        <div className="rt-head">
          <Msym name={MODE_ICON[r.mode] || 'route'} className="rt-mode" />
          <div className="u-grow" style={{ minWidth: 0 }}>
            <div className="rt-title">{r.origin} → {r.destination}</div>
            <div className="rt-meta">
              <span className="mono">{r.code}</span> · {r.carrierCode} · leaves {fmtDT(r.departAt)}
            </div>
          </div>
          <span className={`pill ${st.cls}`}>{st.label}</span>
        </div>

        {/* The reason to press any button on this card: how many people get told. */}
        <div className="rt-reach">
          <Msym name="group" />
          <span><b>{active}</b> customer{active === 1 ? '' : 's'} get told when this changes</span>
          <span className="rt-reach-sep" />
          <span><b>{pkgs.length}</b> parcel{pkgs.length === 1 ? '' : 's'} loaded</span>
        </div>

        <div className="rt-actions">
          {r.status === 'scheduled' && (
            <Button size="sm" icon="upcoming" onClick={() => setEvKind('depart')}>Mark departed</Button>
          )}
          {(r.status === 'departed' || r.status === 'delayed') && (
            <Button size="sm" icon="flag" onClick={() => setEvKind('arrive')}>Mark arrived</Button>
          )}
          {r.status !== 'arrived' && (
            <Button size="sm" variant="outlined" icon="warning" className="btn-danger-outline"
              onClick={() => setEvKind('delay')}>
              Report delay
            </Button>
          )}
          <div className="rt-more">
            <Button size="sm" variant="text" icon="playlist_add" onClick={() => setAttachOpen(true)}>Attach</Button>
            <Button size="sm" variant="text" icon="campaign" onClick={() => setBcOpen(true)}>Broadcast</Button>
          </div>
        </div>

        {r.events.length > 0 && (
          <>
            <button type="button" className="rt-toggle" onClick={() => setHistOpen((v) => !v)}>
              <Msym name={histOpen ? 'expand_less' : 'expand_more'} />
              {histOpen ? 'Hide' : 'Show'} history ({r.events.length})
            </button>
            {histOpen && (
              <ul className="tline rt-tline">
                {[...r.events].reverse().map((ev, i) => (
                  <li key={i}>
                    <span className={`node ${ev.type === 'delay' ? 'delay-node' : 'done'}`}>
                      <Msym name={ev.type === 'delay' ? 'priority_high' : 'check'} />
                    </span>
                    <div className="t-head">{ev.title} <span className="t-time">{fmtDT(ev.ts)}</span></div>
                    {(ev.note && ev.note !== ev.title) && <div className="t-note">{ev.note}</div>}
                    {ev.revisedEtaHours ? <div className="t-note">+{ev.revisedEtaHours} hrs added to ETA</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* depart / arrive note dialogs */}
      <NoteDialog
        open={evKind === 'depart'}
        onClose={() => setEvKind(null)}
        title={`Departure — ${r.code}`}
        label="Note shown to customers"
        initial={`Departed ${r.origin}. Will update on arrival.`}
        cta={`Notify ${active} customer(s)`}
        onSubmit={(note) => {
          postRouteEvent(r.id, { type: 'depart', title: `Departed ${r.origin}`, note });
          toast(`Departure sent to ${active} customer(s).`);
        }}
      />
      <NoteDialog
        open={evKind === 'arrive'}
        onClose={() => setEvKind(null)}
        title={`Arrival — ${r.code}`}
        label="Note shown to customers"
        initial={`Reached ${r.destination}. Delivery scheduled shortly.`}
        cta={`Notify ${active} customer(s)`}
        onSubmit={(note) => {
          postRouteEvent(r.id, { type: 'arrive', title: `Arrived at ${r.destination}`, note });
          toast('Arrival broadcast sent.');
        }}
      />

      {/* delay dialog */}
      <DelayDialog open={evKind === 'delay'} onClose={() => setEvKind(null)} r={r} count={active} />

      {/* attach dialog */}
      <AttachDialog open={attachOpen} onClose={() => setAttachOpen(false)} r={r} />

      {/* broadcast */}
      <BroadcastDialog open={bcOpen} onClose={() => setBcOpen(false)} r={r} />
    </Card>
  );
}

function NoteDialog({ open, onClose, title, label, initial, cta, onSubmit }) {
  const [val, setVal] = useState(initial || '');
  React.useEffect(() => { if (open) setVal(initial || ''); }, [open, initial]);
  return (
    <Dialog open={open} onClose={onClose} title={title}
      actions={<>
        <button className="btn btn-text" onClick={onClose}>Cancel</button>
        <button className="btn btn-filled" onClick={() => { onSubmit(val.trim() || ''); onClose(); }}>{cta}</button>
      </>}>
      <TextField label={label} value={val} onChange={setVal} />
    </Dialog>
  );
}

function DelayDialog({ open, onClose, r, count }) {
  const toast = useToast();
  const [reason, setReason] = useState(REASONS[0]);
  const [extra, setExtra] = useState('');
  const [hours, setHours] = useState('4');
  React.useEffect(() => { if (open) { setExtra(''); setHours('4'); } }, [open]);
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Report delay — ${r.code}`}>
      <p className="t-body-sm muted" style={{ marginBottom: 14 }}>
        Every customer with a parcel on <b>{r.carrierCode}</b> ({r.origin} → {r.destination}) gets one alert.
        No need to touch individual parcels.
      </p>
      <SelectField label="Reason" value={reason} onChange={setReason}
        options={REASONS.map((x) => ({ value: x, label: x }))} />
      <TextField label="Extra details (optional)" value={extra} onChange={setExtra} helper="e.g., Revised arrival 11 PM tonight" style={{ margin: '12px 0' }} />
      <TextField label="Expected delay (hours)" type="number" value={hours} onChange={(v) => setHours(v.replace(/\D/g, ''))} style={{ width: 180 }} />
      <div className="dlg-actions" style={{ marginTop: 18 }}>
        <button className="btn btn-text" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            const note = extra.trim() ? `${reason}. ${extra.trim()}` : reason;
            postRouteEvent(r.id, { type: 'delay', title: reason, note, revisedEtaHours: Number(hours) || 0 });
            toast(`Delay alert sent to ${count} customer(s).`);
            onClose();
          }}
        >
          Send delay alert to {count} customer(s)
        </button>
      </div>
    </Dialog>
  );
}

function AttachDialog({ open, onClose, r }) {
  const data = useDB();
  const [lotsSel, setLotsSel] = useState<Record<string, boolean>>({});
  const [pkgSel, setPkgSel] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  React.useEffect(() => { if (open) { setLotsSel({}); setPkgSel({}); setSearch(''); } }, [open]);
  if (!open) return null;
  const all = data.bookings.filter(
    (b) => b.status !== 'delivered' && !(b.lotId && r.lotIds.includes(b.lotId))
  );
  const q = search.trim().toLowerCase();
  const singles = q
    ? all.filter((b) => (b.docket + b.name + b.to).toLowerCase().includes(q))
    : all;
  return (
    <Dialog open onClose={onClose} size="lg" title={`Attach to ${r.code}`}
      actions={<>
        <button className="btn btn-text" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-filled"
          onClick={() => {
            attachToRoute(r.id, {
              lotIds: Object.keys(lotsSel).filter((k) => lotsSel[k]),
              bookingIds: Object.keys(pkgSel).filter((k) => pkgSel[k]),
            });
            onClose();
          }}
        >Attach</button>
      </>}>
      <div className="t-label-md muted" style={{ marginBottom: 8 }}>LOTS</div>
      {!data.lots.length && <p className="t-body-sm muted">No lots created yet.</p>}
      {data.lots.map((l) => (
        <label key={l.id} className="u-between" style={{ border: '1px solid var(--md-outline-variant)', borderRadius: 10, padding: '9px 14px', marginBottom: 8, cursor: 'pointer' }}>
          <span><b className="mono t-body-sm">{l.code}</b> <span>{l.name}</span></span>
          <Checkbox checked={!!lotsSel[l.id]} onChange={(v) => setLotsSel((s) => ({ ...s, [l.id]: v }))} label="" right />
        </label>
      ))}
      <div className="u-between" style={{ margin: '16px 0 8px', gap: 12, flexWrap: 'wrap' }}>
        <span className="t-label-md muted">INDIVIDUAL PARCELS ({singles.length} of {all.length})</span>
        <TextField label="Search parcels" value={search} onChange={setSearch} trailing="search" style={{ width: 220 }} />
      </div>
      <div className="attach-scroll">
      {!singles.length && <p className="t-body-sm muted">No parcels match that search.</p>}
      {singles.map((b) => (
        <label key={b.id} className="u-between" style={{ border: '1px solid var(--md-outline-variant)', borderRadius: 10, padding: '9px 14px', marginBottom: 8, cursor: 'pointer' }}>
          <span><b className="mono t-body-sm">{b.docket}</b> <span>{b.name}</span> <span className="muted t-body-sm">→ {b.to}</span></span>
          <Checkbox checked={!!pkgSel[b.id]} onChange={(v) => setPkgSel((s) => ({ ...s, [b.id]: v }))} label="" right />
        </label>
      ))}
      </div>
    </Dialog>
  );
}

function BroadcastDialog({ open, onClose, r }) {
  const toast = useToast();
  const [text, setText] = useState('');
  if (!open) return null;
  const n = bookingsOfRoute(r).filter((b) => b.status !== 'delivered').length;
  return (
    <Dialog open onClose={onClose} title={`Broadcast to ${r.code} customers`}
      actions={<>
        <button className="btn btn-text" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-filled"
          onClick={() => {
            const t = text.trim(); if (!t) return;
            bookingsOfRoute(r).forEach((b) => { if (b.status !== 'delivered') queueMsg(b.phone, t); });
            setText('');
            toast('Broadcast queued.');
            onClose();
          }}
        >Send</button>
      </>}>
      <p className="t-body-sm muted" style={{ marginBottom: 12 }}>{n} customer(s) will receive this message.</p>
      <TextField label="Message" value={text} onChange={setText} />
    </Dialog>
  );
}

function PlanRouteDialog({ open, onClose }) {
  const toast = useToast();
  const data = useDB();
  const biz = data.business;
  const d = new Date(); d.setHours(21, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const defT = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const [form, setForm] = useState({ origin: '', destination: '', mode: 'Flight', carrierCode: '', departAt: defT });
  const [lotSel, setLotSel] = useState<Record<string, boolean>>({});
  React.useEffect(() => {
    if (open) { setForm((f) => ({ ...f, origin: biz.origin, departAt: defT })); setLotSel({}); }
  }, [open]);

  if (!open) return null;
  return (
    <Dialog open onClose={onClose} size="lg" title="Plan dispatch route"
      actions={<>
        <button className="btn btn-text" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-filled"
          onClick={() => {
            if (!form.destination.trim() || !form.carrierCode.trim()) { toast('Destination and carrier code are required.'); return; }
            createRoute({
              origin: form.origin.trim() || biz.origin,
              destination: form.destination.trim(),
              mode: form.mode,
              carrierCode: form.carrierCode.trim(),
              departAt: new Date(form.departAt).getTime() || Date.now(),
              lotIds: Object.keys(lotSel).filter((k) => lotSel[k]),
              bookingIds: [],
            });
            toast('Route scheduled.');
            onClose();
          }}
        >Schedule route</button>
      </>}>
      <div className="grid2">
        <TextField label="From" value={form.origin} onChange={(v) => setForm((f) => ({ ...f, origin: v }))} />
        <TextField label="Destination city" value={form.destination} onChange={(v) => setForm((f) => ({ ...f, destination: v }))} list="city-list" required />
        <SelectField label="Mode" value={form.mode} onChange={(v) => setForm((f) => ({ ...f, mode: v }))}
          options={['Flight', 'Train', 'Road', 'Ship'].map((m) => ({ value: m, label: m }))} />
        <TextField label="Carrier code" value={form.carrierCode} onChange={(v) => setForm((f) => ({ ...f, carrierCode: v }))} helper="AI-888 / GJ-04-TR-1234" />
        <TextField label="Departure" type="datetime-local" value={form.departAt} onChange={(v) => setForm((f) => ({ ...f, departAt: v }))} style={{ gridColumn: 'span 2' }} />
      </div>
      <div className="t-label-md muted" style={{ margin: '16px 0 8px' }}>ATTACH LOTS</div>
      {!data.lots.length && <p className="t-body-sm muted">No lots yet.</p>}
      {data.lots.map((l) => (
        <label key={l.id} className="u-between" style={{ border: '1px solid var(--md-outline-variant)', borderRadius: 10, padding: '9px 14px', marginBottom: 8, cursor: 'pointer' }}>
          <span><b className="mono t-body-sm">{l.code}</b> <span>{l.name}</span></span>
          <Checkbox checked={!!lotSel[l.id]} onChange={(v) => setLotSel((s) => ({ ...s, [l.id]: v }))} label="" right />
        </label>
      ))}
    </Dialog>
  );
}
