import {businessDay,dayStart,weekMonday} from '../../operations/business-dates';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { Card, EmptyState } from '../../components/m3/Surface';
import { Ring } from '../../components/m3/Meter';
import {DashboardView} from '../../components/workspace/DashboardView';
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

  const startOfToday = Date.parse(dayStart(businessDay()));
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
    const from = Date.parse(dayStart(weekMonday(businessDay()))) + i * DAY_MS;
    return {
      key: from,
      label: new Date(from).toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata',weekday: 'narrow' }),
      full: new Date(from).toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata',weekday: 'long', day: 'numeric', month: 'short' }),
      n: data.bookings.filter((b) => b.createdAt >= from && b.createdAt < from + DAY_MS).length,
      today: from===startOfToday,
    };
  });
  const deltaVsYesterday = todayBookings.length - data.bookings.filter(b=>b.createdAt>=startOfToday-DAY_MS&&b.createdAt<startOfToday).length;

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

  return <DashboardView
    date={new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'long'})}
    contextAction={<a href="#/customer" target="_blank" rel="noreferrer" className="btn btn-text"><Msym name="chat"/>Customer WhatsApp</a>}
    queue={queue} emptyQueueTitle="All good — nothing needs you" emptyQueueNote="Every parcel and every customer is up to date."
    assistant={<Card pad className="agent">
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
      </Card>}
    metrics={[
      {key:'moving',icon:'local_shipping',label:'Parcels moving',tone:'info',value:<Count to={moving}/>,foot:moving>0?'with you right now':'nothing in transit',go:'/business/packages'},
      {key:'money',icon:'currency_rupee',label:'Money to collect',tone:toPay.amount>0?'warning':'ok',value:<Count to={toPay.amount} format={fmtMoney}/>,foot:toPay.count>0?`from ${toPay.count} delivered parcel${toPay.count===1?'':'s'}`:'everything is paid',go:'/business/packages?filter=topay'},
      {key:'booked',icon:'note_add',label:'Booked today',tone:'info',value:<Count to={todayBookings.length}/>,delta:deltaVsYesterday,go:'/business/packages?booked=today'},
      {key:'delivered',icon:'task_alt',label:'Delivered today',tone:'ok',value:<Count to={deliveredToday}/>,foot:deliveredToday>0?'reached the customer':'none delivered yet',go:'/business/packages?filter=delivered'},
    ]}
    stages={stages.map(stage=>({...stage,go:'/business/packages?filter='+stage.key}))}
    week={week.map(day=>({...day,day:String(day.key)}))}
    moneyAge={<Card>
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
          </Card>}
    routes={todayRoutes.map(route=>({id:route.id,icon:MODE_ICON[route.mode]||'route',title:route.origin+' → '+route.destination,detail:route.code+' · '+bookingsOfRoute(route).length+' parcels · '+fmtDT(route.departAt),status:ROUTE_STATUS(route).label,statusClass:ROUTE_STATUS(route).cls,go:'/business/routes'}))}
    recent={data.bookings.slice(0,6).map(booking=>({id:booking.id,icon:activeDelayFor(booking)&&booking.status!=='delivered'?'priority_high':STATUS_ICON[booking.status]||'inventory_2',title:<><span className="mono bk-dk">{booking.docket}</span><span className="bk-to">to {booking.to}</span></>,detail:booking.name+' · '+prettyPhone(booking.phone)+' · '+ago(booking.createdAt),amount:fmtMoney(grossOf(booking)),status:booking.payment&&!booking.payment.settled?'To Pay':'Paid',paymentDue:Boolean(booking.payment&&!booking.payment.settled),tone:activeDelayFor(booking)&&booking.status!=='delivered'?'is-late':booking.status==='delivered'?'is-done':undefined,go:'/business/packages?open='+encodeURIComponent(booking.id)}))}
    newBooking="/business/booking"
  />;
}
