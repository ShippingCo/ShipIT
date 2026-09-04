import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { TextField, TextArea, SelectField } from '../../components/m3/Input';
import { Button, IconButton, Checkbox } from '../../components/m3/Button';
import { Card, StatusPill, EmptyState } from '../../components/m3/Surface';
import { Journey } from '../../components/m3/Journey';
import { Dialog } from '../../components/m3/Dialog';
import { useToast } from '../../components/m3/Snackbar';
import { useDB } from '../../context/AppContext';
import { updateStatus, verifyDeliveryOTP, confirmDelivered, assignToLot, queueMsg, activeDelayFor, recordPayment, resendDeliveryOTP, revealOTP, markFailedAttempt, markRTO, FAILURE_REASONS, OTP_MAX_ATTEMPTS, fmtMoney, fmtDT, prettyPhone, grossOf } from '../../data/store';
import { printReceipt } from '../../utils/receipt';
import { SearchBar, FilterChips, DateFilter, dateWindow } from '../../components/m3/Controls';
import type { Booking, ParcelStatus } from '../../data/types';
import type { CustomRange, DatePreset } from '../../components/m3/Controls';

/* The dashboard's parcel-journey block links straight to a single stage. Those stages
   are not standing filter chips, so they are handled as filters in their own right and
   surfaced as an extra chip while active — otherwise the list would quietly narrow with
   nothing in the chip row explaining why. */
const STAGE_LABELS = {
  booked: 'Booked', checked_in: 'At hub', dispatched: 'Dispatched',
  in_transit: 'On the way', out_for_delivery: 'Out for delivery',
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'topay', label: 'To Pay' },
];

function payChip(b) {
  const settled = b.payment ? b.payment.settled : true;
  return <span className={`pill ${settled ? 'st-delivered' : 'pill-warn'}`}>{settled ? 'Paid' : 'To Pay'}</span>;
}

export default function PackagesPage() {
  const data = useDB();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(params.get('filter') || 'all');
  const [openId, setOpenId] = useState(params.get('open') || null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'createdAt', dir: -1 });
  const [range, setRange] = useState<DatePreset>('all');
  const [custom, setCustom] = useState<CustomRange>({ from: '', to: '' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [lotOpen, setLotOpen] = useState(false);
  const [bulkLot, setBulkLot] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (params.get('filter') || params.get('open')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byFilter = (rows, f) => {
    if (f === 'active') return rows.filter((b) => !['delivered', 'rto'].includes(b.status));
    if (f === 'delivered') return rows.filter((b) => b.status === 'delivered');
    if (f === 'delayed') return rows.filter((b) => b.status !== 'delivered' && (!!activeDelayFor(b) || b.status === 'failed_attempt'));
    if (f === 'topay') return rows.filter((b) => b.payment && !b.payment.settled);
    if (STAGE_LABELS[f]) return rows.filter((b) => b.status === f);
    return rows;
  };

  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    const [from, to] = dateWindow(range, custom);
    return data.bookings.filter(
      (b) => b.createdAt >= from && b.createdAt <= to
        && (!s || (b.name + b.phone + b.docket + b.to).toLowerCase().includes(s)),
    );
  }, [data, q, range, custom]);

  const chipOptions = useMemo(
    () => (STAGE_LABELS[filter]
      ? [...FILTERS, { value: filter, label: STAGE_LABELS[filter] }]
      : FILTERS),
    [filter],
  );

  /* Counts live on the chips, so the pile is visible before clicking into it. */
  const counts = useMemo(
    () => Object.fromEntries(chipOptions.map((f) => [f.value, byFilter(searched, f.value).length])),
    [searched, chipOptions],
  );

  const list = useMemo(() => {
    const rows = [...byFilter(searched, filter)];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const va = key === 'amount' ? grossOf(a) : key === 'docket' ? a.docket : a.createdAt;
      const vb = key === 'amount' ? grossOf(b) : key === 'docket' ? b.docket : b.createdAt;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return rows;
  }, [searched, filter, sort]);

  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  const pickedRows = pickedIds.map((id) => data.bookings.find((b) => b.id === id)).filter((b): b is Booking => !!b);
  const allShown = list.length > 0 && list.every((b) => picked[b.id]);

  const toggleSort = (key: string) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'docket' ? 1 : -1 }));
  const sortIcon = (key: string) => (sort.key !== key ? 'unfold_more' : sort.dir === 1 ? 'arrow_upward' : 'arrow_downward');

  function bulkAdvance(next: ParcelStatus, label: string) {
    const eligible = pickedRows.filter((b) => b.status !== next && b.status !== 'delivered');
    eligible.forEach((b) => updateStatus(b.id, next));
    setPicked({});
    toast(`${eligible.length} parcel${eligible.length === 1 ? '' : 's'} ${label}. Customers notified.`);
  }
  function bulkLotAssign() {
    const n = pickedIds.length;
    pickedIds.forEach((id) => assignToLot(id, bulkLot || null));
    setPicked({}); setLotOpen(false); setBulkLot('');
    toast(`${n} parcel${n === 1 ? '' : 's'} moved.`);
  }

  return (
    <div className="page">
      <div className="toolbar">
        <SearchBar
          value={q} onChange={setQ} autoFocus
          placeholder="Search docket, name, phone or city" label="Search packages"
        />
        <DateFilter preset={range} onPreset={setRange} custom={custom} onCustom={setCustom} />
      </div>

      <FilterChips options={chipOptions} value={filter} onChange={setFilter} counts={counts} />

      {/* one action, many parcels */}
      {pickedIds.length > 0 && (
        <div className="bulkbar">
          <span className="bulkbar-n">{pickedIds.length} selected</span>
          <Button size="sm" variant="outlined" icon="warehouse" onClick={() => bulkAdvance('checked_in', 'checked in')}>Check in at hub</Button>
          <Button size="sm" variant="outlined" icon="local_shipping" onClick={() => bulkAdvance('dispatched', 'dispatched')}>Dispatch</Button>
          <Button size="sm" variant="outlined" icon="layers" onClick={() => setLotOpen(true)}>Move to lot</Button>
          <button type="button" className="bulkbar-clear" onClick={() => setPicked({})}>Clear</button>
        </div>
      )}

      <Card>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="tbl-check">
                  <Checkbox
                    checked={allShown}
                    onChange={(v) => setPicked(v ? Object.fromEntries(list.map((b) => [b.id, true])) : {})}
                    label=""
                  />
                </th>
                <th><button type="button" className="th-sort" onClick={() => toggleSort('docket')}>Docket <Msym name={sortIcon('docket')} /></button></th>
                <th>Customer</th>
                <th>To</th>
                <th>Lot</th>
                <th className="ta-r"><button type="button" className="th-sort is-r" onClick={() => toggleSort('amount')}>Amount <Msym name={sortIcon('amount')} /></button></th>
                <th>Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => {
                const lot = b.lotId ? data.lots.find((l) => l.id === b.lotId) : null;
                const d = activeDelayFor(b);
                return (
                  <tr key={b.id} className={picked[b.id] ? 'is-picked' : undefined} onClick={() => setOpenId(b.id)}>
                    <td className="tbl-check" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={!!picked[b.id]} onChange={(v) => setPicked((s) => ({ ...s, [b.id]: v }))} label="" />
                    </td>
                    <td className="mono cell-main">{b.docket}</td>
                    <td><div className="cell-main">{b.name}</div><div className="cell-sub">{prettyPhone(b.phone)}</div></td>
                    <td>{b.to}</td>
                    <td className="muted t-body-sm">{lot ? lot.code : '—'}</td>
                    <td className="ta-r">{fmtMoney(grossOf(b))}</td>
                    <td>{payChip(b)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <StatusPill status={b.status} />
                        {d && b.status !== 'delivered' && <StatusPill status="delayed" labelOverride="Delayed" />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.length && (
            <EmptyState
              icon={q ? 'search_off' : 'inventory_2'}
              title={q ? 'Nothing matches that search' : 'No packages here'}
              sub={q ? 'Try a docket number, name or phone.' : 'Parcels appear here as soon as they are booked.'}
              action={q ? <Button variant="outlined" style={{ marginTop: 12 }} onClick={() => setQ('')}>Clear search</Button> : undefined}
            />
          )}
        </div>
      </Card>

      <Dialog open={lotOpen} onClose={() => setLotOpen(false)} title={`Move ${pickedIds.length} parcel(s)`}
        actions={<>
          <button className="btn btn-text" onClick={() => setLotOpen(false)}>Cancel</button>
          <button className="btn btn-filled" onClick={bulkLotAssign}>Move</button>
        </>}>
        <SelectField
          label="Lot" value={bulkLot} onChange={setBulkLot} trailing="layers"
          options={[{ value: '', label: 'Remove from lot' }, ...data.lots.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))]}
        />
      </Dialog>

      {openId && <PackageDetailDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Timeline({ booking }) {
  const items = [...booking.timeline].reverse();
  return (
    <ul className="tline">
      {items.map((t, i) => {
        const isDelay = /delay/i.test(t.title);
        return (
          <li key={i}>
            <span className={`node ${isDelay ? 'delay-node' : t.status === 'booked' && i === items.length - 1 ? '' : 'done'}`}>
              <Msym name={isDelay ? 'priority_high' : 'check'} />
            </span>
            <div className="t-head">{t.title} <span className="t-time">{fmtDT(t.ts)}</span></div>
            {t.note && <div className="t-note">{t.note}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function PackageDetailDialog({ id, onClose }) {
  const data = useDB();
  const toast = useToast();
  const b = data.bookings.find((x) => x.id === id);
  const [otpInput, setOtpInput] = useState('');
  const [msgText, setMsgText] = useState('');
  const [shownOtp, setShownOtp] = useState<string | null>(null);
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState(FAILURE_REASONS[0]);

  if (!b) return null;
  const lot = b.lotId ? data.lots.find((l) => l.id === b.lotId) : null;

  /* The one or two moves that make sense from where this parcel actually is. */
  const actionsFor: Array<{ label: string; next: ParcelStatus; icon: string }> = [];
  if (b.status === 'booked') actionsFor.push({ label: 'Check In at Hub', next: 'checked_in', icon: 'warehouse' });
  if (b.status === 'checked_in') actionsFor.push({ label: 'Dispatch', next: 'dispatched', icon: 'local_shipping' });
  if (['dispatched', 'in_transit'].includes(b.status)) actionsFor.push({ label: 'Out for Delivery', next: 'out_for_delivery', icon: 'mark_email_read' });
  if (b.status === 'failed_attempt') actionsFor.push({ label: 'Try Delivery Again', next: 'out_for_delivery', icon: 'replay' });

  function advance(next: ParcelStatus) {
    updateStatus(id, next);
    toast('Status updated. Customer notified on WhatsApp.');
  }

  function verify() {
    if (!otpInput.trim()) return;
    const res = verifyDeliveryOTP(id, otpInput);
    if (!res.ok) {
      toast(
        res.reason === 'locked'
          ? `Too many wrong tries. Reveal the OTP or mark the delivery failed.`
          : `Wrong OTP — ${res.left} tr${res.left === 1 ? 'y' : 'ies'} left.`,
        { tone: 'err' },
      );
      return;
    }
    confirmDelivered(id);
    toast('Delivered & verified.');
    setOtpInput('');
  }

  return (
    <Dialog open onClose={onClose} size="lg"
      title={<span className="u-row mono" style={{ fontSize: 19 }}>{b.docket} <StatusPill status={b.status} /></span>}>
      {/* Where the parcel is, before any of the detail — readable without reading. */}
      <div className="jrn-wrap">
        <Journey
          status={b.status}
          timeline={b.timeline}
          format={(ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        />
      </div>

      <div className="grid2" style={{ gap: 20 }}>
        <div>
          {b.photo ? (
            <img src={b.photo} alt="" style={{ width: '100%', borderRadius: 'var(--shape-md)', border: '1px solid var(--md-outline-variant)' }} />
          ) : (
            <div className="ph-box u-center u-col" style={{ height: 130, borderRadius: 'var(--shape-md)', gap: 4 }}>
              <Msym name="image" style={{ fontSize: 30 }} />
              <span className="t-body-sm">No parcel photo</span>
            </div>
          )}

          <div className="t-body-sm" style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            {[
              ['Customer', `${b.name} · ${prettyPhone(b.phone)}`],
              ['Address', b.address || '—'],
              ['Service', `${b.serviceType} · ${b.weightKg} kg`],
              ['Amount', fmtMoney(grossOf(b))],
              ['Payment', b.payment && !b.payment.settled ? 'To Pay' : 'Paid'],
              ['Lot', lot ? `${lot.code} — ${lot.name}` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="u-between" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 6 }}>
                <span className="muted">{k}</span>
                <span style={{ textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>

          <SelectField
            label="Move to lot"
            value={b.lotId || ''}
            onChange={(v) => { assignToLot(id, v); toast(v ? 'Moved to lot.' : 'Removed from lot.'); }}
            options={[{ value: '', label: 'Not in a lot' }, ...data.lots.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))]}
            trailing="layers"
            style={{ marginTop: 12 }}
          />

          {actionsFor.length > 0 && (
            <div className="u-row u-wrap" style={{ marginTop: 12 }}>
              {actionsFor.map((a) => (
                <Button key={a.next} size="sm" icon={a.icon} onClick={() => advance(a.next)}>{a.label}</Button>
              ))}
            </div>
          )}

          {b.payment && !b.payment.settled && (
            <div style={{ marginTop: 10 }}>
              <Button
                size="sm" variant="tonal" icon="payments"
                onClick={() => { recordPayment(id); toast(`Recorded ${fmtMoney(grossOf(b))} for ${b.docket}.`); }}
              >
                Record payment — {fmtMoney(grossOf(b))}
              </Button>
            </div>
          )}

          {b.status === 'out_for_delivery' && (
            <Card pad className="otp-panel">
              <div className="otp-head">
                <Msym name="lock" />
                <span>Ask the customer for their OTP</span>
              </div>
              <div className="u-row u-wrap" style={{ marginTop: 10 }}>
                <TextField label="Enter OTP" value={otpInput} inputMode="numeric"
                  onChange={(v) => setOtpInput(v.replace(/\D/g, '').slice(0, 4))} style={{ width: 140 }} />
                <Button size="sm" onClick={verify}>Confirm Delivery</Button>
                <Button size="sm" variant="text" icon="send"
                  onClick={() => { resendDeliveryOTP(id); toast('Same OTP sent again.'); }}>
                  Resend
                </Button>
              </div>

              {/* The code is never printed by default — revealing it is a logged override. */}
              <div className="otp-reveal">
                <span className="otp-mask">{shownOtp || '••••'}</span>
                {!shownOtp && (
                  <button type="button" className="otp-reveal-btn"
                    onClick={() => { setShownOtp(revealOTP(id)); toast('OTP revealed — noted in the timeline.'); }}>
                    Reveal (recorded)
                  </button>
                )}
              </div>
              {(b.otpAttempts || 0) > 0 && (
                <p className="otp-warn">{b.otpAttempts} of {OTP_MAX_ATTEMPTS} wrong tries used</p>
              )}

              <Button size="sm" variant="danger" icon="report" style={{ marginTop: 12 }}
                onClick={() => setFailOpen(true)}>
                Could not deliver
              </Button>
            </Card>
          )}

          {b.status === 'failed_attempt' && (
            <Card pad className="otp-panel" style={{ marginTop: 12 }}>
              <div className="otp-head">
                <Msym name="report" />
                <span>Delivery failed — {b.failureReason || 'no reason recorded'}</span>
              </div>
              <p className="otp-warn">{b.attempts || 1} attempt{(b.attempts || 1) === 1 ? '' : 's'} so far. Customer was told on WhatsApp.</p>
              <Button size="sm" variant="danger" icon="keyboard_return" style={{ marginTop: 10 }}
                onClick={() => { markRTO(id); toast('Marked as returning to sender.'); }}>
                Return to sender
              </Button>
            </Card>
          )}

          <Dialog open={failOpen} onClose={() => setFailOpen(false)} title={`Could not deliver ${b.docket}?`}
            actions={<>
              <button className="btn btn-text" onClick={() => setFailOpen(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => {
                markFailedAttempt(id, failReason);
                setFailOpen(false);
                toast('Marked failed. Customer notified.');
              }}>Record failed attempt</button>
            </>}>
            <p className="t-body-sm muted" style={{ marginBottom: 12 }}>
              The customer is told the reason automatically, so they can reschedule.
            </p>
            <SelectField label="Reason" value={failReason} onChange={setFailReason}
              options={FAILURE_REASONS.map((r) => ({ value: r, label: r }))} />
          </Dialog>
        </div>

        <div>
          <div className="section-label" style={{ margin: '0 0 10px' }}>Timeline<span className="rule" /></div>
          <Timeline booking={b} />

          <hr className="divider" />
          <div className="u-row" style={{ marginBottom: 8 }}>
            <Msym name="forward_to_inbox" className="muted" />
            <span className="t-title-md">Send custom WhatsApp update</span>
          </div>
          <TextArea label="Message to customer" value={msgText} onChange={setMsgText} rows={2} placeholder="Your parcel reaches Mumbai hub tonight…" />
          <div className="dlg-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            <Button
              size="sm" variant="tonal" icon="send"
              disabled={!msgText.trim()}
              onClick={() => { queueMsg(b.phone, msgText.trim()); setMsgText(''); toast('Message queued to customer.'); }}
            >
              Send now
            </Button>
            <Button size="sm" variant="text" icon="print" onClick={() => printReceipt(b.docket)}>Print receipt</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
