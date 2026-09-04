import React, { useEffect, useState } from 'react';
import { Msym } from '../../components/m3/Icon';
import { TextField, TextArea, SelectField } from '../../components/m3/Input';
import { Button, IconButton, Checkbox } from '../../components/m3/Button';
import { Card, EmptyState, StatusPill } from '../../components/m3/Surface';
import { IconTile } from '../../components/m3/Controls';
import { Dialog, ConfirmDialog } from '../../components/m3/Dialog';
import { useToast } from '../../components/m3/Snackbar';
import { useDB } from '../../context/AppContext';
import type { Booking, Lot } from '../../data/types';
import { db, createLot, deleteLot, assignToLot, bookingsOfLot, routeOfLot, ungroupedParcels, pendingDestinations, queueMsg, fmtMoney, fmtDT, grossOf } from '../../data/store';

export default function LotsPage() {
  const data = useDB();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [addForLot, setAddForLot] = useState<Lot | null>(null);
  const [msgForLot, setMsgForLot] = useState<Lot | null>(null);
  const [msgText, setMsgText] = useState('');
  const [delLot, setDelLot] = useState<Lot | null>(null);

  return (
    <div className="page">
      <div className="page-actions">
        <Button icon="add" onClick={() => setCreateOpen(true)}>Create Lot</Button>
      </div>

      <div className="grid3">
        {data.lots.map((l) => {
          const members = bookingsOfLot(l.id);
          const dests = [...new Set(members.map((b) => b.to))];
          const route = routeOfLot(l.id);
          const live = members.filter((b) => b.status !== 'delivered').length;
          const delivered = members.length - live;
          const pct = members.length ? Math.round((delivered / members.length) * 100) : 0;
          return (
            <Card key={l.id} className="lot">
              <div className="lot-head">
                <IconTile name="layers" size="lg" />
                <div className="u-grow" style={{ minWidth: 0 }}>
                  <div className="lot-name">{l.name}</div>
                  <div className="lot-code mono">{l.code}</div>
                </div>
                <IconButton icon="delete" label="Delete lot" size="sm" onClick={() => setDelLot(l)} />
              </div>

              {/* A lot exists to ride a route. Say which one, or say it is stranded. */}
              <div className={`lot-route${route ? '' : ' is-warn'}`}>
                <Msym name={route ? 'alt_route' : 'error_outline'} />
                {route ? (
                  <span><b className="mono">{route.code}</b> → {route.destination} · {fmtDT(route.departAt)}</span>
                ) : (
                  <span>{members.length ? 'Not on a route yet' : 'Empty lot'}</span>
                )}
              </div>

              <div className="lot-body">
                <div className="lot-figs">
                  <div>
                    <span className="lot-fig">{members.length}</span>
                    <span className="lot-fig-l">parcels</span>
                  </div>
                  <div>
                    <span className="lot-fig">{dests.length || '—'}</span>
                    <span className="lot-fig-l">cities</span>
                  </div>
                  <div>
                    <span className="lot-fig">{live}</span>
                    <span className="lot-fig-l">moving</span>
                  </div>
                </div>

                {members.length > 0 && (
                  <div className="lot-progress" title={`${delivered} of ${members.length} delivered`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}

                {dests.length > 0 && (
                  <div className="lot-dests">
                    <Msym name="pin_drop" />
                    <span>{dests.slice(0, 3).join(' · ')}{dests.length > 3 ? ` +${dests.length - 3}` : ''}</span>
                  </div>
                )}
              </div>

              <div className="lot-actions">
                <Button size="sm" icon="playlist_add" onClick={() => setAddForLot(l)}>Add parcels</Button>
                <Button
                  size="sm" variant="outlined" icon="forward_to_inbox"
                  disabled={!live}
                  onClick={() => { setMsgForLot(l); setMsgText(''); }}
                >
                  Message{live > 0 ? ` ${live}` : ''}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {!data.lots.length && (
        <Card variant="outlined">
          <EmptyState
            icon="layers"
            title="No lots yet"
            sub={"Lots group many customers' parcels travelling together — e.g., everything on tonight's Mumbai flight. Create one to unlock batch updates."}
            action={<Button icon="add" style={{ marginTop: 12 }} onClick={() => setCreateOpen(true)}>Create your first lot</Button>}
          />
        </Card>
      )}

      <CreateLotDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(lot, n) => toast(`${lot.code} created with ${n} parcel${n === 1 ? '' : 's'}.`)}
      />

      {/* add parcels */}
      <AddParcelsDialog lot={addForLot} onClose={() => setAddForLot(null)} onDone={(n) => { toast(`${n} parcel(s) added.`); }} />

      {/* message lot */}
      <Dialog open={!!msgForLot} onClose={() => setMsgForLot(null)} title={`Message lot ${msgForLot?.code || ''}`}
        actions={<>
          <button className="btn btn-text" onClick={() => setMsgForLot(null)}>Cancel</button>
          <button
            className="btn btn-filled"
            onClick={() => {
              const t = msgText.trim(); if (!t || !msgForLot) return;
              let n = 0;
              bookingsOfLot(msgForLot.id).forEach((b) => { if (b.status !== 'delivered') { queueMsg(b.phone, t); n++; } });
              setMsgForLot(null); setMsgText('');
              toast(`${n} customer(s) messaged.`);
            }}
          >Send to lot</button>
        </>}>
        <p className="t-body-sm muted" style={{ marginBottom: 12 }}>
          {msgForLot ? bookingsOfLot(msgForLot.id).filter((b) => b.status !== 'delivered').length : 0} customer(s) will receive this instantly.
        </p>
        <TextArea label="Message" value={msgText} onChange={setMsgText} rows={3} placeholder="Your parcel reaches Mumbai hub tonight at 11 PM…" />
      </Dialog>

      <ConfirmDialog
        open={!!delLot}
        onClose={() => setDelLot(null)}
        danger
        title={`Delete ${delLot?.code}?`}
        body="Parcels inside stay safe — they just become ungrouped."
        confirmLabel="Delete lot"
        onConfirm={() => { if (delLot) { deleteLot(delLot.id); toast('Lot deleted.'); } }}
      />
    </div>
  );
}

function AddParcelsDialog({ lot, onClose, onDone }) {
  const data = useDB();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  if (!lot) return null;
  const candidates = data.bookings.filter((b) => b.lotId !== lot.id && b.status !== 'delivered');
  return (
    <Dialog open onClose={onClose} size="lg" title={`Add parcels to ${lot.code}`}
      actions={<>
        <button className="btn btn-text" onClick={onClose}>Done</button>
        <button className="btn btn-filled" onClick={() => {
          const ids = Object.keys(selected).filter((k) => selected[k]);
          ids.forEach((id) => assignToLot(id, lot.id));
          onDone(ids.length);
          setSelected({});
          onClose();
        }}>Save</button>
      </>}>
      {!candidates.length && <p className="t-body-md muted">All parcels are already grouped.</p>}
      {candidates.map((b) => (
        <label key={b.id} className="u-between" style={{ border: '1px solid var(--md-outline-variant)', borderRadius: 10, padding: '9px 14px', marginBottom: 8, cursor: 'pointer' }}>
          <span>
            <b className="mono t-body-sm">{b.docket}</b> <span>{b.name}</span>
            <span className="muted t-body-sm"> → {b.to}</span>
          </span>
          <Checkbox checked={!!selected[b.id]} onChange={(v) => setSelected((s) => ({ ...s, [b.id]: v }))} label="" />
        </label>
      ))}
    </Dialog>
  );
}

/**
 * Creating a lot is destination-first, because that is how an operator thinks:
 * "everything going to Mumbai tonight goes in one bag". Picking the city
 * pre-selects the loose parcels for it, names the lot, and offers the routes
 * heading that way — so one dialog does what used to take two.
 */
function CreateLotDialog({ open, onClose, onCreated }) {
  const data = useDB();
  const [city, setCity] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [routeId, setRouteId] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [touchedName, setTouchedName] = useState(false);

  const dests = pendingDestinations();
  const loose = ungroupedParcels();

  useEffect(() => {
    if (!open) return;
    const first = dests[0]?.city || '';
    setCity(first); setNote(''); setRouteId(''); setTouchedName(false);
  }, [open]);

  /* Picking a city selects its loose parcels and names the lot — both overridable. */
  useEffect(() => {
    if (!open) return;
    setPicked(Object.fromEntries(loose.filter((b) => b.to === city).map((b) => [b.id, true])));
    if (!touchedName) {
      const day = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      setName(city ? `${city} · ${day}` : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, open]);

  if (!open) return null;

  const ids = Object.keys(picked).filter((k) => picked[k]);
  const rows = ids.map((id) => loose.find((b) => b.id === id)).filter((b): b is Booking => !!b);
  const value = rows.reduce((n, b) => n + grossOf(b), 0);
  const weight = rows.reduce((n, b) => n + (Number(b.weightKg) || 0), 0);

  /* Routes heading to this city first, then everything else still open. */
  const routes = [...data.routes]
    .filter((r) => r.status !== 'arrived')
    .sort((a, b) => Number(b.destination === city) - Number(a.destination === city));

  const others = loose.filter((b) => b.to !== city);

  return (
    <Dialog open onClose={onClose} size="lg" title="New lot"
      actions={<>
        <button className="btn btn-text" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-filled"
          disabled={!ids.length}
          onClick={() => {
            const lot = createLot(name, { destination: city, bookingIds: ids, routeId: routeId || undefined, note });
            onCreated(lot, ids.length);
            onClose();
          }}
        >
          Create with {ids.length} parcel{ids.length === 1 ? '' : 's'}
        </button>
      </>}>

      {dests.length === 0 ? (
        <EmptyState icon="inbox" title="No loose parcels"
          sub="Every moving parcel is already in a lot. Book a parcel first, or add one to an existing lot." />
      ) : (
        <>
          <span className="field-legend">Where is this lot going?</span>
          <div className="chips-row" style={{ marginTop: 8 }}>
            {dests.map((d) => (
              <button
                key={d.city} type="button"
                className={`fchip${city === d.city ? ' on' : ''}`}
                onClick={() => setCity(d.city)}
              >
                {d.city}<span className="fchip-n">{d.n}</span>
              </button>
            ))}
          </div>

          <div className="form-grid" style={{ marginTop: 4 }}>
            <TextField
              label="Lot name" value={name}
              onChange={(v) => { setName(v); setTouchedName(true); }}
            />
            <SelectField
              label="Put on a route" value={routeId} onChange={setRouteId}
              options={[
                { value: '', label: 'Decide later' },
                ...routes.map((r) => ({
                  value: r.id,
                  label: `${r.code} · ${r.origin} → ${r.destination} · ${fmtDT(r.departAt)}`,
                })),
              ]}
            />
            <TextField
              label="Note for your staff" value={note} onChange={setNote}
              className="span2"
            />
          </div>

          <div className="lotpick">
            <div className="lotpick-head">
              <span className="field-legend">Parcels in this lot</span>
              <button type="button" className="lotpick-all"
                onClick={() => setPicked(Object.fromEntries(loose.filter((b) => b.to === city).map((b) => [b.id, true])))}>
                Select all {city}
              </button>
            </div>

            <ul className="lotpick-list">
              {loose.filter((b) => b.to === city).map((b) => (
                <li key={b.id}>
                  <Checkbox checked={!!picked[b.id]} onChange={(v) => setPicked((s) => ({ ...s, [b.id]: v }))}
                    ariaLabel={`Include ${b.docket}`} label="" />
                  <span className="mono lotpick-dk">{b.docket}</span>
                  <span className="u-grow u-truncate">{b.name}</span>
                  <span className="lotpick-w">{b.weightKg} kg</span>
                  <StatusPill status={b.status} />
                </li>
              ))}
            </ul>

            {others.length > 0 && (
              <details className="lotpick-more">
                <summary>Add parcels going elsewhere ({others.length})</summary>
                <ul className="lotpick-list">
                  {others.map((b) => (
                    <li key={b.id}>
                      <Checkbox checked={!!picked[b.id]} onChange={(v) => setPicked((s) => ({ ...s, [b.id]: v }))}
                        ariaLabel={`Include ${b.docket}`} label="" />
                      <span className="mono lotpick-dk">{b.docket}</span>
                      <span className="u-grow u-truncate">{b.name}</span>
                      <span className="lotpick-to">→ {b.to}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="lotsum">
            <span><b>{ids.length}</b> parcels</span>
            <span><b>{weight.toFixed(1)}</b> kg</span>
            <span><b>{fmtMoney(value)}</b> value</span>
          </div>
        </>
      )}
    </Dialog>
  );
}
