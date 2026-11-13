import {businessDay,dayStart} from '../../operations/business-dates';
import React, { useState } from 'react';

import { Msym } from '../../components/m3/Icon';


import {DashboardView,type DashboardRange} from '../../components/workspace/DashboardView';
import { useDB } from '../../context/AppContext';
import {
  bookingsOfRoute, toPaySummary, reachSummary, openEscalations,
  recoveryQueue, fmtMoney, grossOf } from '../../data/store';

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



/* Every stage keeps its own icon and is always drawn, even at zero. A pipeline whose
   shape changes with the data cannot be learned; one that stays put can be read by
   position alone once the operator has seen it a few times. */
const STAGES = [
  { key: 'booked', label: 'At the counter', icon: 'receipt_long' },
  { key: 'checked_in', label: 'At hub', icon: 'warehouse' },
  { key: 'dispatched', label: 'Dispatched', icon: 'local_shipping' },
  { key: 'in_transit', label: 'On the way', icon: 'alt_route' },
  { key: 'out_for_delivery', label: 'Out for delivery', icon: 'moped' },
];


const DAY_MS = 864e5;

/* Counts up to the real value. Motion here points at information, it does not decorate. */

export default function Dashboard() {
  const data = useDB();
  const [range, setRange] = useState<DashboardRange>(7);
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


  const todayBookings = data.bookings.filter((b) => b.createdAt >= startOfToday);



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



  /* ---------- 6. the trailing month, which the chart ranges read ---------- */
  const series = Array.from({ length: 30 }, (_, i) => {
    const from = startOfToday - (29 - i) * DAY_MS;
    return {
      day: new Date(from).toISOString().slice(0, 10),
      n: data.bookings.filter((b) => b.createdAt >= from && b.createdAt < from + DAY_MS).length,
      label: new Date(from).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'narrow' }),
      full: new Date(from).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short' }),
    };
  });
  const shown = series.slice(-range);
  const busiest = (() => {
    const byDay = new Map<number, { sum: number; n: number }>();
    shown.forEach((point) => {
      const index = new Date(point.day + 'T12:00:00Z').getUTCDay();
      const entry = byDay.get(index) || { sum: 0, n: 0 };
      byDay.set(index, { sum: entry.sum + point.n, n: entry.n + 1 });
    });
    const means = [...byDay.entries()].map(([index, entry]) => ({ index, mean: entry.sum / entry.n }));
    if (!means.length) return 'No bookings in this period yet.';
    const top = means.reduce((a, b) => (b.mean > a.mean ? b : a), means[0]!);
    if (top.mean <= 0) return 'No bookings in this period yet.';
    const name = new Date(Date.UTC(2024, 0, 7 + top.index)).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
    return `Busiest on ${name}s.`;
  })();

  /* ---------- 7. the four figures, and the one list that needs a person ---------- */
  const lastWeekSameDay = data.bookings.filter(
    (b) => b.createdAt >= startOfToday - 7 * DAY_MS && b.createdAt < startOfToday - 6 * DAY_MS).length;
  const change = lastWeekSameDay > 0
    ? Math.round(((todayBookings.length - lastWeekSameDay) / lastWeekSameDay) * 100) : null;
  const weekdayName = new Date(startOfToday).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' });
  const askedTotal = reach.handled + reach.needHuman;

  const todo = queue.slice(0, 3).map((item) => ({
    key: item.key,
    icon: item.icon,
    tone: (item.tone === 'error' ? 'danger' : 'warning') as 'danger' | 'warning',
    title: item.title,
    detail: `Decide what to do: ${item.cta.toLowerCase()}.`,
    go: item.go,
  }));

  const peakBucket = Math.max(1, ...buckets.map((b) => b.value));

  return <DashboardView
    date={new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'long'})}
    asOf={new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit'})}
    branch="Pune — Kothrud"
    newBooking="/business/booking"
    contextAction={<a href="#/customer" target="_blank" rel="noreferrer" className="btn btn-text"><Msym name="chat"/>Customer WhatsApp</a>}
    notices={[]}
    tiles={[
      {key:'booked',icon:'note_add',label:'Booked today',value:String(todayBookings.length),
        foot:change===null?`nothing last ${weekdayName}`
          :change===0?`the same as last ${weekdayName}`
          :<><span className={'delta '+(change>0?'up':'down')}><Msym name={change>0?'arrow_upward':'arrow_downward'}/>{Math.abs(change)}%</span> vs last {weekdayName}</>,
        spark:series.slice(-7).map((point)=>point.n),go:'/business/packages?booked=today'},
      {key:'money',icon:'currency_rupee',label:'Still to collect',value:fmtMoney(toPay.amount),
        foot:toPay.count>0
          ?`across ${toPay.count} delivered parcel${toPay.count===1?'':'s'} · ${fmtMoney(buckets[2]!.value)} over a week old`
          :'everything delivered is paid',
        go:'/business/packages?filter=topay'},
      {key:'assistant',icon:'forum',label:'Answered by ShipIT',accent:true,value:String(reach.handled),
        foot:'customers you did not have to call',go:'/business/feed'},
      {key:'needs',icon:todo.length?'warning':'check_circle',label:'Needs you',
        value:todo.length?String(queue.length):'Nothing',danger:queue.length>0,quiet:queue.length===0,
        missing:queue.length===0,
        foot:queue.length?'ShipIT could not handle these':'everything is moving',
        go:queue[0]?.go??'/business/packages'},
    ]}
    stages={[...stages.map((stage)=>({key:stage.key,icon:stage.icon,label:stage.label,n:stage.n,go:'/business/packages?filter='+stage.key})),
      {key:'delivered',icon:'task_alt',label:'Delivered',n:data.bookings.filter((b)=>b.status==='delivered').length,go:'/business/packages?filter=delivered'},
      {key:'rto',icon:'assignment_return',label:'Returned',n:data.bookings.filter((b)=>b.status==='rto').length,go:'/business/packages?filter=rto',alert:true}]}
    journeyTotal={data.bookings.length}
    series={shown} range={range} onRange={setRange} seriesCaption={busiest}
    money={toPay.amount>0?{bars:buckets.map((b)=>({key:b.key,label:b.label.replace(/ old$/,''),full:b.label,
      share:(b.value/peakBucket)*100,amount:fmtMoney(b.value)})),
      caption:buckets[2]!.value>0
        ?`${fmtMoney(buckets[2]!.value)} of ${fmtMoney(toPay.amount)} has been waiting more than a week.`
        :'Everything owed is less than a week old.'}:null}
    moneyFoot={toPay.amount>0?undefined:<p className="chart-caption">Every delivered parcel is paid. Nothing to chase.</p>}
    value={{range:'this week',cells:[
      {key:'reached',value:String(reach.people),label:'customers messaged on WhatsApp'},
      {key:'answered',value:String(reach.handled),label:'questions answered without you'},
      {key:'share',value:askedTotal>0?Math.round(reach.handled/askedTotal*100)+'%':'—',
        label:askedTotal>0?`handled start to finish (${reach.handled} of ${askedTotal})`:'handled start to finish'},
      {key:'hours',value:reach.handled>0?'≈ '+Math.max(1,Math.round(reach.handled*2.5/60))+' hrs':'—',
        label:'of phone calls you did not take',
        basis:`An estimate: ${reach.handled} answered questions at two and a half minutes of phone time each.`},
      {key:'thanks',value:String(reach.thanks),label:'customers said thank you',tone:'happy'},
      {key:'human',value:String(reach.needHuman),label:'passed to you to finish',tone:'warn'},
    ]}}
    todo={todo} todoTotal={queue.length} todoGo="/business/packages"
  />;
}
