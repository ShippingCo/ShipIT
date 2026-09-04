import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { Card, EmptyState } from '../../components/m3/Surface';
import { Button } from '../../components/m3/Button';
import { Ring } from '../../components/m3/Meter';
import { KpiCard } from '../../components/m3/Kpi';
import { useDB } from '../../context/AppContext';
import {
  bookingsOfRoute, activeDelayFor, toPaySummary, reachSummary, openEscalations,
  recoveryQueue, fmtMoney, fmtDT, prettyPhone, grossOf } from '../../data/store';

/*
  The dashboard, written for the person who actually uses it: an SME courier operator
  in India who may not read English fluently, standing at a counter with a customer in
  front of them.

  That reader cannot be asked to decode an axis, a legend or a smooth trend line, so
  this screen contains no abstract chart at all. Everything is either a COUNTED THING
  with its own icon, or a CHUNKY BAR with the number printed beside it. Words are the
  third channel — after icon and number — and never the only one.

  Colour is carried by OUTLINES, never by fills. Every icon disc stays white like the
  rest of the app and takes its meaning from a tinted ring and glyph — red where
  something needs the operator, amber for money still to collect, green for done, blue
  along the parcel journey to show how far things have actually got. Solid fills are
  reserved for the two places where the fill IS the quantity: the week columns and the
  money-ageing bars.

  Blocks, in the order an operator asks the question — except for the second, which is
  placed on the operator's behalf: what the assistant did is the product's whole claim,
  so it sits above the numbers rather than at the bottom of the page.
    1. Is anything wrong?        5. The week, and how old the money is
    2. What the assistant did    6. What goes out today
    3. The four numbers          7. The last few bookings
    4. Where are my parcels?
*/

const ROUTE_STATUS = (r) =>
  r.status === 'delayed' ? { cls: 'st-delayed', label: 'Delayed' }
  : r.status === 'departed' ? { cls: 'st-dispatched', label: 'Departed' }
  : r.status === 'arrived' ? { cls: 'st-delivered', label: 'Arrived' }
  : { cls: 'st-booked', label: 'Scheduled' };

const MODE_ICON = { Flight: 'flight', Train: 'train', Road: 'local_shipping', Ship: 'directions_boat' };

/* Every stage keeps its own icon and is always drawn, even at zero. A pipeline whose
   shape changes with the data cannot be learned; one that stays put can be read by
   position alone once the operator has seen it a few times. */
const STAGES = [
  { key: 'booked', label: 'Booked', icon: 'receipt_long' },
  { key: 'checked_in', label: 'At hub', icon: 'warehouse' },
  { key: 'dispatched', label: 'Dispatched', icon: 'local_shipping' },
  { key: 'in_transit', label: 'On the way', icon: 'alt_route' },
  { key: 'out_for_delivery', label: 'Out for delivery', icon: 'moped' },
];

/* Each booking row is led by the icon for the stage it is in, reusing exactly the
   glyphs from the parcel-journey block above so the two teach each other. */
const STATUS_ICON = {
  booked: 'receipt_long', checked_in: 'warehouse', dispatched: 'local_shipping',
  in_transit: 'alt_route', out_for_delivery: 'moped', delivered: 'task_alt',
  failed_attempt: 'priority_high', rto: 'keyboard_return',
};

const DAY_MS = 864e5;

function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

/* Counts up to the real value. Motion here points at information, it does not decorate. */
function Count({ to, format = (n) => n }) {
  const [n, setN] = useState(() => (reduceMotion() ? to : 0));
  useEffect(() => {
    if (reduceMotion() || !to) { setN(to); return; }
    let raf; let start;
    const step = (t) => {
      if (start === undefined) start = t;
      const p = Math.min(1, (t - start) / 650);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{format(n)}</>;
}

export default function Dashboard() {
  const data = useDB();
  const nav = useNavigate();
  if (!data) return null;

  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const toPay = toPaySummary();
  const outForDelivery = data.bookings.filter((b) => b.status === 'out_for_delivery');
  const reach = reachSummary();
  const escalated = openEscalations();
  const recovery = recoveryQueue();

  /* ---------- 1. what needs doing — one self-contained line each ---------- */

  /**
   * One row in the needs-attention block. `rank` orders the block: 0 is the most
   * urgent, and the whole list is sorted by it so the operator reads top-down.
   */
  interface QueueItem {
    key: string;
    rank: number;
    icon: string;
    /** Colour role. Omitted where the row is informational rather than a problem. */
    tone?: string;
    title: string;
    cta: string;
    /** Route this row navigates to when clicked. */
    go: string;
  }

  const queue: QueueItem[] = [];
  data.routes.filter((r) => r.status === 'delayed').forEach((r) => {
    const affected = bookingsOfRoute(r).filter((b) => b.status !== 'delivered').length;
    queue.push({
      key: 'delay-' + r.id, rank: 0, icon: 'warning', tone: 'error',
      title: `${r.code} ${r.origin} to ${r.destination} is late — ${affected} parcel${affected === 1 ? '' : 's'} affected`,
      cta: 'Tell customers', go: '/business/routes',
    });
  });
  data.bookings
    .filter((b) => b.status === 'out_for_delivery' && b.etaTs && b.etaTs < Date.now())
    .forEach((b) => {
      queue.push({
        key: 'late-' + b.id, rank: 0, icon: 'error', tone: 'error',
        title: `${b.docket} has not reached ${b.name} in ${b.to}`,
        cta: 'Open', go: '/business/packages',
      });
    });
  /* Industry data: ~40-50% of failed deliveries are still saveable if the customer
     is contacted within hours, and carriers allow ~3 attempts inside 72 hours. */
  if (recovery.length > 0) {
    const urgent = recovery.filter((r) => r.expiring).length;
    queue.push({
      key: 'recover', rank: 0, icon: 'assignment_return', tone: 'error',
      title: `${recovery.length} delivery${recovery.length === 1 ? '' : 'ies'} failed — ${urgent > 0 ? `${urgent} return to sender within 24h` : 'still saveable today'}`,
      cta: 'Recover', go: '/business/packages?filter=delayed',
    });
  }
  if (toPay.count > 0) {
    queue.push({
      key: 'topay', rank: 1, icon: 'currency_rupee', tone: 'warning',
      title: `${fmtMoney(toPay.amount)} to collect from ${toPay.count} delivered parcel${toPay.count === 1 ? '' : 's'}`,
      cta: 'Collect', go: '/business/packages?filter=topay',
    });
  }
  if (outForDelivery.length > 0) {
    queue.push({
      key: 'otp', rank: 1, icon: 'moped', tone: 'warning',
      title: `${outForDelivery.length} parcel${outForDelivery.length === 1 ? '' : 's'} out for delivery — take the OTP to close`,
      cta: 'Verify OTP', go: '/business/packages',
    });
  }
  if (escalated.length > 0) {
    queue.push({
      key: 'escalated', rank: 0, icon: 'support_agent', tone: 'error',
      title: `${escalated.length} customer${escalated.length === 1 ? '' : 's'} the assistant could not help — ${escalated.length === 1 ? 'needs' : 'need'} a person`,
      cta: 'Reply', go: '/business/feed',
    });
  }
  const ungrouped = data.bookings.filter((b) => !b.lotId && b.status !== 'delivered');
  if (ungrouped.length >= 2) {
    queue.push({
      key: 'lot', rank: 2, icon: 'layers',
      title: `${ungrouped.length} parcels are not grouped into a lot`,
      cta: 'Group', go: '/business/lots',
    });
  }
  queue.sort((a, b) => a.rank - b.rank);

  /* ---------- 2 & 3. the numbers, and the pipeline ---------- */
  const stages = STAGES.map((s) => ({
    ...s,
    n: data.bookings.filter((b) => b.status === s.key).length,
  }));
  const moving = stages.reduce((n, s) => n + s.n, 0);

  const todayBookings = data.bookings.filter((b) => b.createdAt >= startOfToday);
  const deliveredToday = data.bookings.filter(
    (b) => b.status === 'delivered' && (b.deliveredTs || 0) >= startOfToday).length;

  const week = Array.from({ length: 7 }, (_, i) => {
    const from = startOfToday - (6 - i) * DAY_MS;
    return {
      key: from,
      label: new Date(from).toLocaleDateString('en-IN', { weekday: 'narrow' }),
      full: new Date(from).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }),
      n: data.bookings.filter((b) => b.createdAt >= from && b.createdAt < from + DAY_MS).length,
      today: i === 6,
    };
  });
  const weekPeak = Math.max(1, ...week.map((d) => d.n));
  const deltaVsYesterday = todayBookings.length - week[5].n;

  /* ---------- 4b. how old the unpaid money is ---------- */
  const unsettled = data.bookings.filter((b) => b.payment && !b.payment.settled && b.status === 'delivered');
  const buckets = [
    { key: 'fresh', label: 'Less than 3 days old', tone: 'good', value: 0 },
    { key: 'warn', label: '4 to 7 days old', tone: 'warning', value: 0 },
    { key: 'old', label: 'More than a week old', tone: 'critical', value: 0 },
  ];
  unsettled.forEach((b) => {
    const days = Math.floor((Date.now() - (b.deliveredTs || b.createdAt)) / DAY_MS);
    (days <= 3 ? buckets[0] : days <= 7 ? buckets[1] : buckets[2]).value += grossOf(b);
  });
  const ageMax = Math.max(1, ...buckets.map((b) => b.value));

  /* ---------- 5. the assistant's claim ---------- */
  const asked = reach.handled + reach.needHuman;
  const autoRate = asked > 0 ? (reach.handled / asked) * 100 : null;

  const todayRoutes = data.routes.filter((r) => r.departAt < startOfToday + DAY_MS);

  return (
    <div className="page page-glance">
      <div className="ctxbar">
        <span className="ctxbar-date">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <a href="#/customer" target="_blank" rel="noreferrer" className="btn btn-text">
          <Msym name="chat" /> Customer WhatsApp
        </a>
      </div>

      {/* ============ 1. IS ANYTHING WRONG? ============
          Deliberately the largest thing on the page. If an operator reads only one
          block before serving the next customer, it has to be this one. */}
      <Card className={`glance${queue.length ? '' : ' is-clear'}`}>
        <div className="glance-head">
          <span className="glance-ic">
            <Msym name={queue.length ? 'priority_high' : 'check'} />
          </span>
          <div>
            <h2 className="glance-t">
              {queue.length === 0 ? 'All good — nothing needs you' : (
                <>
                  <b>{queue.length}</b> thing{queue.length === 1 ? '' : 's'}
                  {queue.length === 1 ? ' needs' : ' need'} you now
                </>
              )}
            </h2>
            <div className="glance-sub">
              {queue.length === 0
                ? 'Every parcel and every customer is up to date.'
                : 'Most urgent first.'}
            </div>
          </div>
        </div>

        {queue.map((q) => (
          <div key={q.key} className={`glance-row${q.tone ? ' tone-' + q.tone : ''}`}>
            <span className="glance-row-ic"><Msym name={q.icon} /></span>
            <span className="glance-row-t u-grow">{q.title}</span>
            <Button variant="outlined" onClick={() => nav(q.go)}>{q.cta}</Button>
          </div>
        ))}
      </Card>

      {/* ============ 2. WHAT THE ASSISTANT DID FOR YOU ============
          Second on the page on purpose. This is the product's whole claim, and it has to
          be seen before the operator gets absorbed in their own numbers. */}
      <div className="section-label" style={{ marginTop: 22 }}>Your assistant</div>
      <Card pad className="agent">
        {autoRate !== null && (
          <div className="agent-hero">
            <Ring value={autoRate} size={104} label="on its own" />
            <div style={{ minWidth: 0 }}>
              <div className="agent-claim">
                {reach.handled} of {asked} customer question{asked === 1 ? '' : 's'} answered without you
              </div>
              <div className="agent-claim-sub">
                {reach.needHuman > 0
                  ? `${reach.needHuman} still needs a person.`
                  : 'Nothing is waiting on you right now.'}
              </div>
            </div>
          </div>
        )}

        <div className="bot-grid">
          {[
            { k: 'people', icon: 'group', label: 'Customers reached', n: reach.people },
            { k: 'sent', icon: 'send', label: 'Updates sent for you', n: reach.sent },
            { k: 'thanks', icon: 'favorite', label: 'Said thank you', n: reach.thanks },
            { k: 'human', icon: 'support_agent', label: 'Need a person', n: reach.needHuman,
              alert: reach.needHuman > 0 },
          ].map((c) => (
            <div key={c.k} className={`bot-cell${c.alert ? ' is-alert' : ''}`}>
              <div className="bot-top">
                <span className="bot-ic"><Msym name={c.icon} /></span>
                <span className="bot-l">{c.label}</span>
              </div>
              <div className="bot-n"><Count to={c.n} /></div>
            </div>
          ))}
        </div>

        <button type="button" className="card-foot-link agent-cta" onClick={() => nav('/business/feed')}>
          Open conversations
        </button>
      </Card>

      {/* ============ 3. THE FOUR NUMBERS ============ */}
      <div className="kpi4">
        <KpiCard
          icon="local_shipping" label="Parcels moving" tone="info"
          value={<Count to={moving} />}
          foot={moving > 0 ? 'with you right now' : 'nothing in transit'}
          onClick={() => nav('/business/packages')}
        />
        <KpiCard
          icon="currency_rupee" label="Money to collect"
          tone={toPay.amount > 0 ? 'warning' : 'ok'}
          value={<Count to={toPay.amount} format={fmtMoney} />}
          foot={toPay.count > 0
            ? `from ${toPay.count} delivered parcel${toPay.count === 1 ? '' : 's'}`
            : 'everything is paid'}
          onClick={() => nav('/business/packages?filter=topay')}
        />
        <KpiCard
          icon="note_add" label="Booked today" tone="info"
          value={<Count to={todayBookings.length} />}
          delta={deltaVsYesterday}
          onClick={() => nav('/business/booking')}
        />
        <KpiCard
          icon="task_alt" label="Delivered today" tone="ok"
          value={<Count to={deliveredToday} />}
          foot={deliveredToday > 0 ? 'reached the customer' : 'none delivered yet'}
          onClick={() => nav('/business/packages?filter=delivered')}
        />
      </div>

      {/* ============ 4. WHERE ARE MY PARCELS? ============
          Five fixed positions, each with its own icon and its own count — readable
          without a word of English once the shape has been seen twice. */}
      <div className="section-label" style={{ marginTop: 22 }}>Where your parcels are</div>
      <Card>
        <div className="pipe">
          {stages.map((s, i) => (
            <button
              key={s.key} type="button"
              className={`pipe-step is-link${s.n > 0 ? ' has' : ''}`}
              onClick={() => nav(`/business/packages?filter=${s.key}`)}
              aria-label={`${s.n} parcel${s.n === 1 ? '' : 's'} ${s.label}`}
            >
              {i < stages.length - 1 && (
                <span className={`pipe-link${s.n > 0 ? ' is-on' : ''}`} aria-hidden="true" />
              )}
              <span className="pipe-ic"><Msym name={s.icon} /></span>
              <span className="pipe-n"><Count to={s.n} /></span>
              <span className="pipe-l">{s.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* ============ 5. THE WEEK, AND THE AGE OF THE MONEY ============ */}
      <div className="glance-band">
        <div>
          <div className="section-label">This week</div>
          <Card>
            <div className="wk">
              {week.map((d) => (
                <div key={d.key} className={`wk-col${d.today ? ' is-today' : ''}`} title={`${d.full}: ${d.n}`}>
                  <span className="wk-n">{d.n}</span>
                  <span className="wk-bar" style={{ height: `${Math.max(4, (d.n / weekPeak) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="wk" style={{ height: 'auto', padding: '0 20px' }}>
              {week.map((d) => (
                <span key={d.key} className="wk-d">{d.label}</span>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <div className="section-label">How old that money is</div>
          <Card>
            {toPay.amount > 0 ? (
              <div className="age">
                {buckets.map((b) => (
                  <div key={b.key} className={`age-row age-${b.tone}`}>
                    <div className="age-top">
                      <span className="age-dot" />
                      <span className="age-lbl">{b.label}</span>
                      <span className="age-val">{fmtMoney(b.value)}</span>
                    </div>
                    <div className="age-track">
                      <div className="age-fill" style={{ width: `${(b.value / ageMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="verified" title="Every parcel is paid"
                sub="Nothing is waiting to be collected." />
            )}
          </Card>
        </div>
      </div>

      {/* ============ 6. TODAY'S DISPATCH ============ */}
        <div style={{ marginTop: 22 }}>
          <div className="section-label">Today's dispatch</div>
          <Card>
            {todayRoutes.length === 0 ? (
              <EmptyState icon="alt_route" title="Nothing going out today"
                sub="Plan a route to update every customer on it at once." />
            ) : (
              <>
                {todayRoutes.map((r) => {
                  const st = ROUTE_STATUS(r);
                  const pkgs = bookingsOfRoute(r);
                  return (
                    <div key={r.id} className="li clickable" onClick={() => nav('/business/routes')}>
                      <Msym name={MODE_ICON[r.mode] || 'route'} size={24} className="row-ic" />
                      <div className="u-grow" style={{ minWidth: 0 }}>
                        <div className="li-head">{r.origin} → {r.destination}</div>
                        <div className="li-sub">
                          <span className="mono">{r.code}</span> · {pkgs.length} parcel{pkgs.length === 1 ? '' : 's'} · {fmtDT(r.departAt)}
                        </div>
                      </div>
                      <span className={`pill ${st.cls}`}>{st.label}</span>
                    </div>
                  );
                })}
                <button className="card-foot-link" onClick={() => nav('/business/routes')}>View all routes</button>
              </>
            )}
          </Card>
        </div>

  
      {/* ============ 7. THE LAST FEW BOOKINGS ============ */}
      <div className="section-label" style={{ marginTop: 22 }}>Recent bookings</div>
      <Card>
        {data.bookings.slice(0, 6).map((b) => {
          const late = activeDelayFor(b) && b.status !== 'delivered';
          const settled = b.payment ? b.payment.settled : true;
          const done = b.status === 'delivered';
          return (
            <div key={b.id} className="bk" onClick={() => nav(`/business/packages?open=${encodeURIComponent(b.id)}`)}>
              <span className={`bk-ic${late ? ' is-late' : done ? ' is-done' : ''}`}>
                <Msym name={late ? 'priority_high' : STATUS_ICON[b.status] || 'inventory_2'} />
              </span>
              <span className="bk-main">
                <span className="bk-l1">
                  <span className="mono bk-dk">{b.docket}</span>
                  <span className="bk-to">to {b.to}</span>
                </span>
                <span className="bk-l2">{b.name} · {prettyPhone(b.phone)} · {ago(b.createdAt)}</span>
              </span>
              <span className="bk-right">
                <span className="bk-amt">{fmtMoney(grossOf(b))}</span>
                <span className={`bk-pay${settled ? '' : ' is-due'}`}>{settled ? 'Paid' : 'To Pay'}</span>
              </span>
            </div>
          );
        })}
        {!data.bookings.length && (
          <EmptyState icon="note_add" title="No bookings yet"
            sub="Your first docket reaches the customer's WhatsApp instantly."
            action={<Button icon="add" style={{ marginTop: 12 }} onClick={() => nav('/business/booking')}>New Booking</Button>} />
        )}
        {data.bookings.length > 6 && (
          <button className="card-foot-link" onClick={() => nav('/business/packages')}>View all packages</button>
        )}
      </Card>
    </div>
  );
}
