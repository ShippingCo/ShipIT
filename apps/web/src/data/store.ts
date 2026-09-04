/* ============================================================
   Data layer — localStorage-backed store shared by both apps.
   Business actions automatically queue WhatsApp notifications,
   so opening the customer view shows live automation.
   ============================================================ */

import { msg } from './messages';
import type {
  Attachment, Booking, BotStats, Business, Charges, Chat, ChatMessage, CityTotal, Database,
  DispatchRoute, Escalation, EwayRecord, GstModeOption, Lot, MessageLang, NewBookingInput,
  NewRouteInput, OtpResult, OutboxMessage, ParcelStatus, Payment, RateTotal, ReachSummary,
  RecoveryItem, ReplyWindow, Report, RouteEvent, ServiceType, SupplyKind, Tax, TimelineEntry,
} from './types';

const KEY = 'shippingco_v1';
const LEGACY_KEY = 'setu_courier_v2';

/*
   Every phone number in this file comes from +44 7700 900xxx.

   That block is reserved by Ofcom, the UK communications regulator, for use in drama
   and documentation. It is never allocated to a subscriber, so these numbers cannot
   ring a real person no matter who reads this repository or what they do with it.
   India has no equivalent reservation — any well-formed Indian mobile number belongs
   to somebody, or will one day — which is why the demo data does not use one.

   Keep any new demo number inside this block. The one exception is the number the
   test suite types into the booking form: that field validates Indian mobiles, as it
   should, so it uses an all-nines placeholder instead.
*/
export const DEFAULT_BUSINESS: Business = {
  name: 'Shree Balaji Courier Service',
  tagline: 'Ahmedabad • Since 2011',
  phone: '+44 7700 900000',
  address: 'Shop 12, Ring Road, Navrangpura, Ahmedabad 380009',
  gstin: '24ABCDE1234F1Z5',
  origin: 'Ahmedabad',
  botName: 'Balaji Assist',
  msgLang: 'en',
  gstMode: 'courier18',
};

export const GST_MODES: GstModeOption[] = [
  { value: 'courier18', label: 'Courier / express service — 18%', rate: 0.18,
    note: 'SAC 996812. You charge GST on the invoice and can claim input credit.' },
  { value: 'gta5', label: 'Goods Transport Agency — 5% (no input credit)', rate: 0.05,
    note: 'Concessional GTA rate. For notified recipients this is paid by them under reverse charge.' },
  { value: 'gta18', label: 'Goods Transport Agency — 18% (with input credit)', rate: 0.18,
    note: 'GTA forward charge with full input tax credit.' },
  { value: 'none', label: 'Not registered / GST not charged', rate: 0,
    note: 'No GST is added to bookings.' },
];

/* An e-way bill is generally needed once consignment value reaches Rs 50,000.
   Several states set a higher limit for movement inside the state (Maharashtra and
   Tamil Nadu use Rs 1,00,000), so this is a prompt to check, never an assertion. */
export const EWAY_THRESHOLD = 50000;

export const CITIES: string[] = ['Mumbai', 'Delhi', 'Pune', 'Surat', 'Vadodara', 'Jaipur', 'Bengaluru', 'Hyderabad', 'Indore', 'Nagpur', 'Kolkata', 'Chennai', 'Lucknow', 'Rajkot', 'Gandhinagar'];

/* City → state decides the place of supply: same state = CGST + SGST,
   different state = IGST. That is the standard Indian tax-invoice split. */
export const STATE_OF_CITY: Record<string, string | undefined> = {
  Ahmedabad: 'Gujarat', Gandhinagar: 'Gujarat', Rajkot: 'Gujarat', Surat: 'Gujarat', Vadodara: 'Gujarat',
  Mumbai: 'Maharashtra', Pune: 'Maharashtra', Nagpur: 'Maharashtra',
  Delhi: 'Delhi',
  Jaipur: 'Rajasthan',
  Indore: 'Madhya Pradesh',
  Bengaluru: 'Karnataka',
  Hyderabad: 'Telangana',
  Chennai: 'Tamil Nadu',
  Kolkata: 'West Bengal',
  Lucknow: 'Uttar Pradesh',
};

export const stateOfCity = (city: string): string | null => STATE_OF_CITY[city] || null;

/** 'intra' (CGST + SGST) or 'inter' (IGST). Unknown cities stay intra, matching counter defaults. */
export function placeOfSupply(toCity: string): SupplyKind {
  const biz = db().business || DEFAULT_BUSINESS;
  const o = STATE_OF_CITY[biz.origin];
  const d = STATE_OF_CITY[toCity];
  return o && d ? (o === d ? 'intra' : 'inter') : 'intra';
}

export const STATUS_FLOW: ParcelStatus[] = ['booked', 'checked_in', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'];
export const EXCEPTION_STATUSES: ParcelStatus[] = ['failed_attempt', 'rto'];
export const FAILURE_REASONS: string[] = [
  'Customer not available',
  'Address not found',
  'Customer refused delivery',
  'Cash not ready (To Pay)',
  'Shop/office closed',
];
export const STATUS_LABEL: Record<ParcelStatus, string> = {
  booked: 'Booked',
  checked_in: 'Checked In at Hub',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  failed_attempt: 'Delivery Failed',
  rto: 'Returning to Sender',
};

const ETA_MAP: Record<string, number | undefined> = { Mumbai: 1, Pune: 1, Surat: 1, Vadodara: 1, Gandhinagar: 1, Rajkot: 2, Indore: 2, Jaipur: 2, Delhi: 2, Nagpur: 2, Hyderabad: 3, Bengaluru: 4, Chennai: 4, Kolkata: 4, Lucknow: 3 };

let cache: Database | null = null;
const listeners = new Set<() => void>();

export const getSnapshot = (): Database => cache ?? load();
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function db(): Database { return cache ?? load(); }

function notifyAndPersist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { console.warn('persist failed', e); }
  /* A fresh object identity is what tells useSyncExternalStore the snapshot changed. */
  if (cache) cache = { ...cache };
  listeners.forEach((fn) => fn());
}
export const save = notifyAndPersist;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      try {
        if (e.newValue && e.newValue !== 'null') { cache = JSON.parse(e.newValue); listeners.forEach((fn) => fn()); }
      } catch {}
    }
  });
  load();
}

/* Persisted JSON is untrusted input: it may be from an older version, hand-edited, or
   truncated. Everything downstream assumes the shape, so prove it here or reseed. */
function looksValid(o: unknown): o is Database {
  const d = o as Partial<Database> | null;
  return !!d && typeof d === 'object'
    && Array.isArray(d.bookings) && Array.isArray(d.lots)
    && Array.isArray(d.routes) && Array.isArray(d.outbox)
    && !!d.business && !!d.seq;
}

function normalizeBookings() {
  const d = db();
  const rate = (GST_MODES.find((m) => m.value === (d.business?.gstMode || 'courier18')) || GST_MODES[0]).rate;
  d.bookings.forEach((b: Booking) => {
    if (!b.payment) b.payment = { mode: 'paid', settled: true, settledTs: null };
    const intra = placeOfSupply(b.to) === 'intra';
    if (!b.supply) b.supply = intra ? 'intra' : 'inter';
    if (!b.tax) b.tax = taxOn(b.amount.packing, b.amount.freight, rate, intra);
    else if ((b.tax as Partial<Tax>).cgst === undefined) {
      /* records created before the CGST/SGST/IGST model — backfill the split only */
      const t = b.tax;
      if (intra && t.gst > 0) {
        t.cgst = Math.round((t.gst / 2) * 100) / 100;
        t.sgst = Math.round((t.gst - t.cgst) * 100) / 100;
        t.igst = 0;
      } else {
        t.cgst = 0; t.sgst = 0; t.igst = t.gst || 0;
      }
    }
    /* legacy flat e-way number moves into the structured record */
    if (!b.eway && b.ewayBillNo) b.eway = { no: b.ewayBillNo, vehicleNo: '', distanceKm: null, validUntil: null };
    delete b.ewayBillNo;
  });
}

function load(): Database {
  try {
    if (!localStorage.getItem(KEY)) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) localStorage.setItem(KEY, legacy);
    }
    const raw = localStorage.getItem(KEY);
    if (raw && raw !== 'null') {
      const parsed = JSON.parse(raw);
      if (looksValid(parsed)) { cache = parsed; normalizeBookings(); return cache; }
    }
  } catch {}
  cache = seedData();
  normalizeBookings();
  notifyAndPersist();
  return cache as Database;
}

/* ---------- seed ---------- */
function seedData(): Database {
  const t = Date.now();
  const biz = { ...DEFAULT_BUSINESS };
  const lotMum: Lot = { id: 'lot_mum_01', code: 'LOT-MUM-01', name: 'Mumbai Metro Batch', createdAt: t - 26 * 36e5 };
  const lotDel: Lot = { id: 'lot_del_01', code: 'LOT-DEL-01', name: 'Delhi North Batch', createdAt: t - 20 * 36e5 };

  const routes: DispatchRoute[] = [
    {
      id: 'rte_mum_102', code: 'RT-102', origin: 'Ahmedabad', destination: 'Mumbai', mode: 'Flight',
      carrierCode: 'AI-888', departAt: t + 5 * 36e5, lotIds: [lotMum.id], bookingIds: [], status: 'scheduled',
      events: [{ ts: t - 36e5, type: 'info', title: 'Route scheduled', note: 'Cargo slot confirmed.' }],
    },
    {
      id: 'rte_del_201', code: 'RT-201', origin: 'Ahmedabad', destination: 'Delhi', mode: 'Train',
      carrierCode: 'ADI-NDL EXP', departAt: t - 30 * 36e5, lotIds: [lotDel.id], bookingIds: [], status: 'delayed',
      events: [
        { ts: t - 30 * 36e5, type: 'info', title: 'Departed Ahmedabad', note: 'Loaded 1 lot.' },
        { ts: t - 4 * 36e5, type: 'delay', title: 'Heavy fog near Kota', note: 'Running ~6h late. Revised arrival 11 PM tonight.', revisedEtaHours: 6 },
      ],
    },
  ];

  type TlTuple = [number, ParcelStatus, string, string?];
  const mkTl = (arr: TlTuple[]): TimelineEntry[] =>
    arr.map(([ts, status, title, note]) => ({ ts, status, title, note }));
  const H = 36e5;

  const bookings: Booking[] = [
    {
      id: 'bkg_ravi', docket: 'SBC104201', name: 'Ravi Patel', phone: '+447700900001', to: 'Mumbai',
      address: 'B-402, Sunrise Apartments, Andheri West, Mumbai 400058', weightKg: 2.5, serviceType: 'Express',
      amount: { packing: 50, freight: 340 }, status: 'checked_in', lotId: lotMum.id, otp: null, etaDays: 1,
      goodsValue: 78000,
      eway: { no: '291004556231', vehicleNo: 'GJ-04-FX-2210', distanceKm: 530, validUntil: t + 2 * 864e5 },
      timeline: mkTl([[t - 22 * H, 'checked_in', 'Parcel received at hub', 'Weight verified 2.5 kg'], [t - 24 * H, 'booked', 'Booking created at counter']]),
      createdAt: t - 24 * H,
    },
    {
      id: 'bkg_meera', docket: 'SBC104202', name: 'Meera Iyer', phone: '+447700900002', to: 'Mumbai',
      address: '7, Hill Road, Bandra West, Mumbai 400050', weightKg: 6, serviceType: 'Standard',
      amount: { packing: 80, freight: 420 }, status: 'checked_in', lotId: lotMum.id, otp: null, etaDays: 1,
      goodsValue: 145000,
      timeline: mkTl([[t - 21 * H, 'checked_in', 'Parcel received at hub', 'Fragile — glassware'], [t - 23 * H, 'booked', 'Booking created at counter']]),
      createdAt: t - 23 * H,
    },
    {
      id: 'bkg_arjun', docket: 'SBC104198', name: 'Arjun Mehta', phone: '+447700900003', to: 'Delhi',
      address: '12, Model Town Phase 2, Delhi 110009', weightKg: 4, serviceType: 'Standard',
      amount: { packing: 60, freight: 380 }, status: 'in_transit', lotId: lotDel.id, otp: null, etaDays: 1,
      goodsValue: 62500,
      eway: { no: '291004556198', vehicleNo: '', distanceKm: 940, validUntil: t + 4 * 864e5 },
      payment: { mode: 'topay', settled: false, settledTs: null },
      timeline: mkTl([
        [t - 4 * H, 'in_transit', 'Delay: running 6h late', 'Heavy fog near Kota. Revised arrival 11 PM tonight.'],
        [t - 29 * H, 'in_transit', 'In transit', 'Departed Ahmedabad'],
        [t - 30 * H, 'dispatched', 'Dispatched via ADI-NDL EXP', 'Lot LOT-DEL-01'],
        [t - 30 * H, 'checked_in', 'Parcel received at hub'],
        [t - 31 * H, 'booked', 'Booking created at counter'],
      ]),
      createdAt: t - 31 * H,
    },
    {
      id: 'bkg_priya', docket: 'SBC104171', name: 'Priya Desai', phone: '+447700900004', to: 'Surat',
      address: 'A-9, Vesu Canal Road, Surat 395007', weightKg: 1.2, serviceType: 'Express',
      amount: { packing: 30, freight: 150 }, status: 'delivered', lotId: null, otpUsed: '4821',
      goodsValue: 9500,
      payment: { mode: 'topay', settled: false, settledTs: null },
      etaDays: 1,
      timeline: mkTl([
        [t - 27 * H, 'delivered', 'Delivered', 'OTP verified. Received by Priya Desai.'],
        [t - 28 * H, 'out_for_delivery', 'Out for delivery', 'OTP 4821 sent to customer'],
        [t - 46 * H, 'dispatched', 'Dispatched via GJ-04-TR-8821', 'Direct truck'],
        [t - 50 * H, 'checked_in', 'Parcel received at hub'],
        [t - 52 * H, 'booked', 'Booking created at counter'],
      ]),
      createdAt: t - 52 * H, deliveredTs: t - 27 * H,
    },
    {
      id: 'bkg_karan', docket: 'SBC104210', name: 'Karan Shah', phone: '+447700900005', to: 'Vadodara',
      address: '22, Alkapuri Society, Vadodara 390007', weightKg: 0.8, serviceType: 'Standard',
      amount: { packing: 20, freight: 90 }, status: 'booked', lotId: null, otp: null, etaDays: 1,
      goodsValue: 51200,
      timeline: mkTl([[t - 2 * H, 'booked', 'Booking created at counter']]),
      createdAt: t - 2 * H,
    },
  ];

  const chats: Record<string, Chat> = {
    '+447700900001': { updatesOptIn: true, msgs: [
      { from: 'bot', text: `Namaste Ravi ji 🙏 Welcome to *${biz.name}*.\nI am ${biz.botName}, your delivery assistant.\n\nAsk me things like:\n• "Where is my parcel?"\n• "When will it be delivered?"\n• "Any delay?"\nType *MENU* anytime.`, ts: t - 24 * H },
      { from: 'bot', text: `✅ Booking confirmed!\nDocket: *SBC104201*\nFrom: Ahmedabad → Mumbai\nAmount: ₹390\n\nYou'll get automatic updates here.`, ts: t - 24 * H + 60000 },
      { from: 'bot', text: `📦 Update: Your parcel *SBC104201* has been *received* at our Ahmedabad hub. Scheduled on tonight's dispatch.`, ts: t - 22 * H },
    ] },
    '+447700900003': { updatesOptIn: true, msgs: [
      { from: 'bot', text: `Namaste Arjun ji 🙏 Welcome to *${biz.name}* — I am ${biz.botName}.`, ts: t - 31 * H },
      { from: 'bot', text: `🚚 Update: Parcel *SBC104198* dispatched to Delhi via ADI-NDL EXP.`, ts: t - 30 * H },
      { from: 'bot', text: `⚠️ *Delay Alert*: Your parcel *SBC104198* is running ~6 hours late due to heavy fog near Kota. Revised arrival in Delhi: 11 PM tonight. Sorry for the inconvenience 🙏`, ts: t - 4 * H },
    ] },
    '+447700900004': { updatesOptIn: true, msgs: [
      { from: 'bot', text: `Namaste Priya ji! Your parcel *SBC104171* is *out for delivery* today.\n🔐 Share this OTP only when you receive the parcel: *4821*`, ts: t - 28 * H },
      { from: 'bot', text: `✅ Delivered! Parcel *SBC104171* was handed over after OTP verification. Thank you!`, ts: t - 27 * H },
    ] },
  };

  bookings.forEach((b) => {
    if (!b.etaTs) b.etaTs = t + b.etaDays * 864e5;
    if (!b.payment) b.payment = { mode: 'paid', settled: true, settledTs: null };
  });

  return {
    v: 3, business: biz, bookings, lots: [lotMum, lotDel], routes, chats, outbox: [],
    /* Seeded so a fresh demo already shows what the assistant has been doing. */
    stats: { handled: 46, thanks: 9, escalated: 3 },
    escalations: [
      {
        id: 'esc_seed_1', phone: '+447700900003', ts: t - 3 * 36e5, resolved: false,
        reason: 'Asked to speak to a person',
        text: 'This is third time delay, I want to talk to your manager',
      },
      {
        id: 'esc_seed_2', phone: '+447700900002', ts: t - 9 * 36e5, resolved: false,
        reason: 'AI could not understand',
        text: 'kal tak nahi aaya to cancel kar dena aur paisa wapas',
      },
    ],
    seq: { docket: 104211, lot: 2, route: 3 },
  };
}

/* ---------- formatting ---------- */
export const uid = (p: string) => p + '_' + Math.random().toString(36).slice(2, 8);
export function normPhone(p: string | null | undefined): string {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  if (p?.startsWith('+')) return p;
  return '+' + d;
}
export function prettyPhone(p: string | null | undefined): string {
  const s = String(p || '').replace(/\D/g, '');
  /* Group Indian numbers the way an operator reads them aloud: +91 XXXXX XXXXX.
     The country code has to be checked and not just the length — every twelve-digit
     number is not an Indian one, and this used to relabel foreign numbers as +91. */
  if (s.length === 12 && s.startsWith('91')) return '+91 ' + s.slice(2, 7) + ' ' + s.slice(7);
  return p || '';
}
export function estimateEtaDays(city: string): number { return ETA_MAP[city] ?? 3; }

/* Suggested freight, so pricing does not depend on which clerk is at the counter.
   ETA days stand in for distance band; the clerk can always override. */
export function suggestFreight(city: string, weightKg: number | string, serviceType?: ServiceType): number {
  const days = estimateEtaDays(city);
  const w = Math.max(0.5, Number(weightKg) || 0);
  let amount = (60 + days * 40) + (25 + days * 8) * w;
  if (serviceType === 'Express') amount *= 1.25;
  else if (serviceType === 'Same-city') amount *= 0.6;
  return Math.round(amount / 10) * 10;
}
export const fmtMoney = (n: number | null | undefined) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const fmtDT = (ts: number) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
export const waFmt = (s: unknown) => esc(s).replace(/\*(.+?)\*/g, '<strong>$1</strong>');

/* ---------- queries ---------- */
export const findBooking = (id: string): Booking | undefined => db().bookings.find((b) => b.id === id);
export const findByDocket = (d: string | null | undefined): Booking | undefined => db().bookings.find((b) => b.docket.toUpperCase() === String(d || '').trim().toUpperCase());
export const bookingsByPhone = (ph: string): Booking[] => db().bookings.filter((b) => b.phone === ph).sort((a, b) => b.createdAt - a.createdAt);
export const allCustomers = (): Array<{ name: string; phone: string }> => {
  const seen: Record<string, boolean> = {};
  return db().bookings.map((b) => ({ name: b.name, phone: b.phone })).filter((c) => (seen[c.phone] ? false : (seen[c.phone] = true)));
};
export const lotById = (id: string): Lot | undefined => db().lots.find((l) => l.id === id);
export const routeById = (id: string): DispatchRoute | undefined => db().routes.find((r) => r.id === id);
export const routeOfLot = (lotId: string): DispatchRoute | null => db().routes.find((r) => r.lotIds.includes(lotId)) || null;
export const bookingsOfLot = (lotId: string): Booking[] => db().bookings.filter((b) => b.lotId === lotId);
export function bookingsOfRoute(route: DispatchRoute): Booking[] {
  const ids = new Set<string>();
  route.lotIds.forEach((lid) => bookingsOfLot(lid).forEach((b) => ids.add(b.id)));
  route.bookingIds.forEach((bid) => findBooking(bid) && ids.add(bid));
  return [...ids].map(findBooking).filter((b): b is Booking => !!b);
}
export function activeDelayFor(b: Booking): { route: DispatchRoute; event: RouteEvent } | null {
  for (const r of db().routes) {
    if (r.status !== 'delayed') continue;
    if (!bookingsOfRoute(r).some((x) => x.id === b.id)) continue;
    const ev = [...r.events].reverse().find((e) => e.type === 'delay');
    if (ev) return { route: r, event: ev };
  }
  return null;
}

/* ---------- mutations ---------- */
export const nextDocket = () => 'SBC' + db().seq.docket++;

/** The suggested docket WITHOUT consuming it — the form lets the clerk type their own. */
export const peekDocket = () => 'SBC' + db().seq.docket;

export function addBooking(data: NewBookingInput): Booking {
  const intra = placeOfSupply(data.to) === 'intra';
  const b: Booking = {
    id: uid('bkg'), docket: data.docket || nextDocket(),
    name: data.name.trim(), phone: normPhone(data.phone), to: data.to.trim(),
    address: data.address?.trim() || '', weightKg: Number(data.weightKg) || 0,
    serviceType: data.serviceType ?? 'Standard',
    amount: { packing: Number(data.packing) || 0, freight: Number(data.freight) || 0 },
    tax: taxOn(data.packing, data.freight, gstRate(), intra),
    supply: intra ? 'intra' : 'inter',
    payment: data.paymentMode === 'topay'
      ? { mode: 'topay', settled: false, settledTs: null }
      : { mode: 'paid', settled: true, settledTs: Date.now() },
    status: 'booked', lotId: data.lotId || null,
    photo: data.photo || (data.attachments || []).find((a) => a.kind === 'image')?.url || null,
    attachments: data.attachments || [],
    timeline: [{ ts: Date.now(), status: 'booked', title: 'Booking created at counter' }],
    otp: null, createdAt: Date.now(), etaDays: estimateEtaDays(data.to),
    etaTs: Date.now() + estimateEtaDays(data.to) * 864e5,
  };
  db().bookings.unshift(b);
  save();
  notifyBookingConfirmed(b);
  return b;
}

export function updateStatus(id: string, status: ParcelStatus, extraNote?: string): Booking | null {
  const b = findBooking(id); if (!b) return null;
  b.status = status;
  let note = extraNote || '';
  if (status === 'out_for_delivery') {
    b.otp = String(Math.floor(1000 + Math.random() * 9000));
    b.otpAttempts = 0;
    note = 'OTP ' + b.otp + ' sent to customer';
  }
  b.timeline.push({ ts: Date.now(), status, title: STATUS_LABEL[status], note });
  save();
  notifyStatusChange(b);
  return b;
}

/* Resend the SAME code. Routing this through updateStatus used to regenerate the OTP,
   leaving the customer holding two different codes. */
export function resendDeliveryOTP(id: string): Booking | null {
  const b = findBooking(id); if (!b || b.status !== 'out_for_delivery') return null;
  if (!b.otp) b.otp = String(Math.floor(1000 + Math.random() * 9000));
  b.timeline.push({ ts: Date.now(), status: b.status, title: 'Delivery OTP resent', note: 'Same code sent again' });
  save();
  queueMsg(b.phone, `🔐 Reminder: your delivery OTP for parcel *${b.docket}* is *${b.otp}*.
Share it only after you receive the parcel.`);
  return b;
}

export const OTP_MAX_ATTEMPTS = 5;

export function verifyDeliveryOTP(id: string, entered: string): OtpResult {
  const b = findBooking(id); if (!b) return { ok: false, reason: 'missing' };
  if ((b.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  const ok = String(b.otp) === String(entered).trim();
  if (!ok) {
    b.otpAttempts = (b.otpAttempts || 0) + 1;
    b.timeline.push({ ts: Date.now(), status: b.status, title: 'Wrong OTP entered', note: `Attempt ${b.otpAttempts} of ${OTP_MAX_ATTEMPTS}` });
    save();
    return { ok: false, reason: 'wrong', left: OTP_MAX_ATTEMPTS - b.otpAttempts };
  }
  return { ok: true };
}

/* Staff can reveal the code for a genuine exception, but it is written to the
   timeline so the bypass is never silent. */
export function revealOTP(id: string): string | null {
  const b = findBooking(id); if (!b || !b.otp) return null;
  b.timeline.push({ ts: Date.now(), status: b.status, title: 'OTP revealed by staff', note: 'Counter override' });
  save();
  return b.otp;
}

export function markFailedAttempt(id: string, reason: string): Booking | null {
  const b = findBooking(id); if (!b) return null;
  b.status = 'failed_attempt';
  b.failureReason = reason;
  b.attempts = (b.attempts || 0) + 1;
  b.otp = null; b.otpAttempts = 0;
  if (!b.firstFailedTs) b.firstFailedTs = Date.now();
  b.timeline.push({ ts: Date.now(), status: 'failed_attempt', title: 'Delivery attempt failed', note: reason });
  save();
  queueMsg(b.phone, msg('failed', { docket: b.docket, reason, attempt: b.attempts }, lang()));
  return b;
}

export function markRTO(id: string): Booking | null {
  const b = findBooking(id); if (!b) return null;
  b.status = 'rto';
  b.timeline.push({ ts: Date.now(), status: 'rto', title: 'Returning to sender', note: `After ${b.attempts || 1} failed attempt(s)` });
  save();
  queueMsg(b.phone, msg('rto', { docket: b.docket, attempts: b.attempts || 1 }, lang()));
  return b;
}

export function recordPayment(id: string): Booking | null | undefined {
  const b = findBooking(id); if (!b || !b.payment || b.payment.settled) return b;
  b.payment.settled = true;
  b.payment.settledTs = Date.now();
  b.timeline.push({
    ts: Date.now(), status: b.status, title: 'Payment received',
    note: fmtMoney(b.amount.packing + b.amount.freight) + ' collected at counter',
  });
  save();
  return b;
}

export function resendDelayAlert(routeId: string): number {
  const r = routeById(routeId); if (!r || r.status !== 'delayed') return 0;
  const ev = [...r.events].reverse().find((e) => e.type === 'delay'); if (!ev) return 0;
  let n = 0;
  bookingsOfRoute(r).forEach((b) => {
    if (b.status === 'delivered') return;
    const chat = db().chats[b.phone];
    if (chat && chat.updatesOptIn === false) return;
    queueMsg(b.phone,
      `⚠️ *Delay Alert*

Parcel *${b.docket}* (${r.origin} → ${r.destination}) is still affected.
Reason: ${ev.title}${ev.note && ev.note !== ev.title ? ' — ' + ev.note : ''}

Sorry for the inconvenience 🙏 Reply *HELP* to talk to our team.`);
    n++;
  });
  if (n) save();
  return n;
}

export function toPaySummary() {
  const list = db().bookings.filter((b) => b.status === 'delivered' && b.payment && !b.payment.settled);
  return {
    count: list.length,
    amount: list.reduce((s, b) => s + b.amount.packing + b.amount.freight, 0),
    ids: list.map((b) => b.id),
  };
}

export function confirmDelivered(id: string): Booking | null {
  const b = findBooking(id); if (!b) return null;
  b.status = 'delivered'; b.deliveredTs = Date.now();
  b.timeline.push({ ts: Date.now(), status: 'delivered', title: 'Delivered', note: 'OTP verified at doorstep' });
  save();
  notifyStatusChange(b);
  return b;
}

/**
 * Create a lot. A lot is a destination + a day + the parcels riding together, so the
 * caller can supply all of that at once rather than making an empty lot and filling
 * it in a second step. The code is derived from the destination so it reads like the
 * codes operators already write by hand (LOT-MUM-01).
 */
export function createLot(name: string, opts: { destination?: string; note?: string; bookingIds?: string[]; routeId?: string } = {}): Lot {
  const d = db();
  const city = String(opts.destination || '').trim();
  const tag = city ? city.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() : 'GEN';
  const seq = d.lots.filter((l) => (l.code || '').startsWith(`LOT-${tag}-`)).length + 1;
  const lot: Lot = {
    id: uid('lot'),
    code: `LOT-${tag}-${String(seq).padStart(2, '0')}`,
    name: String(name || '').trim() || (city ? `${city} batch` : 'Batch'),
    destination: city || null,
    note: opts.note || '',
    createdAt: Date.now(),
  };
  d.lots.unshift(lot);
  (opts.bookingIds || []).forEach((id) => { const b = findBooking(id); if (b) b.lotId = lot.id; });
  if (opts.routeId) {
    const r = routeById(opts.routeId);
    if (r && !r.lotIds.includes(lot.id)) r.lotIds.push(lot.id);
  }
  d.seq.lot = (d.seq.lot || 1) + 1;
  save();
  return lot;
}

/** Parcels not yet in a lot and still moving — the pool a new lot draws from. */
export function ungroupedParcels(): Booking[] {
  return db().bookings.filter((b) => !b.lotId && !['delivered', 'rto'].includes(b.status));
}

/** Destinations that actually have loose parcels waiting, busiest first. */
export function pendingDestinations(): Array<{ city: string; n: number }> {
  const map: Record<string, number> = {};
  ungroupedParcels().forEach((b) => { map[b.to] = (map[b.to] || 0) + 1; });
  return Object.entries(map).map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n);
}

export function deleteLot(id: string) {
  db().bookings.forEach((b) => { if (b.lotId === id) b.lotId = null; });
  db().routes.forEach((r) => { r.lotIds = r.lotIds.filter((x) => x !== id); });
  db().lots = db().lots.filter((l) => l.id !== id); save();
}
export const assignToLot = (bookingId: string, lotId: string | null) => { const b = findBooking(bookingId); if (b) { b.lotId = lotId || null; save(); } };

export function createRoute(data: NewRouteInput): DispatchRoute {
  const r: DispatchRoute = {
    id: uid('rte'), code: 'RT-' + db().seq.route++, origin: data.origin, destination: data.destination,
    mode: data.mode, carrierCode: data.carrierCode, departAt: data.departAt || Date.now(),
    lotIds: data.lotIds || [], bookingIds: data.bookingIds || [], status: 'scheduled', events: [],
  };
  r.events.push({ ts: Date.now(), type: 'info', title: 'Route scheduled', note: `${data.carrierCode} • ${fmtDT(r.departAt)}` });
  db().routes.unshift(r); save();
  notifyRouteEvent(r, r.events[0]);
  return r;
}

export function postRouteEvent(routeId: string, ev: Omit<RouteEvent, 'ts'> & { ts?: number }): DispatchRoute | null {
  const r = routeById(routeId); if (!r) return null;
  /* The caller describes the event; the store stamps it. Building a complete record
     here rather than mutating the argument keeps the timestamp ours to guarantee. */
  const event: RouteEvent = { ...ev, ts: Date.now() };
  r.events.push(event);
  if (event.type === 'delay') r.status = 'delayed';
  else if (/depart/i.test(event.title)) r.status = 'departed';
  else if (/arriv/i.test(event.title)) r.status = 'arrived';
  // move parcel statuses along with physical reality
  const extraHours = event.revisedEtaHours;
  if (event.type === 'delay' && extraHours) {
    bookingsOfRoute(r).forEach((b) => { if (b.status !== 'delivered') b.etaTs = (b.etaTs || Date.now()) + extraHours * 36e5; });
  }
  if (event.type !== 'delay') {
    bookingsOfRoute(r).forEach((b) => {
      if (event.type === 'depart' && ['booked', 'checked_in'].includes(b.status)) {
        b.status = 'dispatched'; b.timeline.push({ ts: event.ts, status: 'dispatched', title: 'Dispatched via ' + r.carrierCode });
      }
      if (event.type === 'arrive' && ['dispatched', 'in_transit'].includes(b.status)) {
        b.status = 'in_transit'; b.timeline.push({ ts: event.ts, status: 'in_transit', title: 'Arrived at ' + r.destination, note: 'Out for delivery soon' });
      }
    });
  }
  save();
  notifyRouteEvent(r, event);
  return r;
}

export function attachToRoute(routeId: string, { lotIds = [], bookingIds = [] }: { lotIds?: string[]; bookingIds?: string[] }) {
  const r = routeById(routeId); if (!r) return;
  lotIds.forEach((l) => !r.lotIds.includes(l) && r.lotIds.push(l));
  bookingIds.forEach((i) => !r.bookingIds.includes(i) && r.bookingIds.push(i));
  save();
}

export function updateBusiness(patch: Partial<Business>) { Object.assign(db().business, patch); save(); }

export function resetDemo() {
  localStorage.removeItem(KEY);
  cache = seedData();
  notifyAndPersist();
}

/* ---------- WhatsApp automation (business action → customer message) ---------- */
export function queueMsg(phone: string, text: string) {
  db().outbox.push({ id: uid('ob'), phone, text, ts: Date.now() });
  save();
}
/* The AI agent's outcomes. Without this the product has no way to show what it does,
   and escalations have nowhere to surface. */
export function logBotTurn(phone: string, intent: string, customerText: string) {
  const d = db();
  if (!d.stats) d.stats = { handled: 0, thanks: 0, escalated: 0 };
  if (!Array.isArray(d.escalations)) d.escalations = [];

  if (intent === 'thanks') {
    d.stats.thanks += 1;
  } else if (intent === 'human' || intent === 'unknown') {
    d.stats.escalated += 1;
    const already = d.escalations.find((e) => e.phone === phone && !e.resolved);
    if (already) {
      already.ts = Date.now();
      already.text = customerText;
    } else {
      d.escalations.unshift({
        id: uid('esc'), phone, text: customerText, ts: Date.now(), resolved: false,
        reason: intent === 'human' ? 'Asked to speak to a person' : 'AI could not understand',
      });
    }
  } else {
    d.stats.handled += 1;
  }
  save();
}

export const openEscalations = (): Escalation[] => (db().escalations || []).filter((e) => !e.resolved);

export function resolveEscalation(id: string): Escalation | undefined {
  const e = (db().escalations || []).find((x) => x.id === id);
  if (e) { e.resolved = true; e.resolvedTs = Date.now(); save(); }
  return e;
}

/* Everyone the business has actually reached on WhatsApp. */
/**
 * GST is computed on the booking itself, so every later screen just reads it.
 * The split follows the Indian invoice layout: intra-state = half CGST + half SGST,
 * inter-state = IGST in full.
 */
export function taxOn(packing: number | string | undefined, freight: number | string | undefined, rate: number, intra = true): Tax {
  const taxable = (Number(packing) || 0) + (Number(freight) || 0);
  const gst = Math.round(taxable * rate * 100) / 100;
  if (!intra || gst === 0) {
    return { rate, taxable, gst, cgst: 0, sgst: 0, igst: gst, total: Math.round((taxable + gst) * 100) / 100 };
  }
  const cgst = Math.round((gst / 2) * 100) / 100;
  const sgst = Math.round((gst - cgst) * 100) / 100;
  return { rate, taxable, gst, cgst, sgst, igst: 0, total: Math.round((taxable + gst) * 100) / 100 };
}

/** What the customer actually pays. Falls back for records made before GST was stored. */
export const grossOf = (b: Booking): number => (b?.tax ? b.tax.total : (b.amount.packing + b.amount.freight));

export const gstRate = () => (GST_MODES.find((m) => m.value === (db().business.gstMode || 'courier18')) || GST_MODES[0]).rate;

/**
 * Everything an accountant asks for at month, quarter or year end.
 * Charges are treated as GST-inclusive, which is how counter pricing actually works:
 * the customer is quoted one number.
 */
export function reportFor(from: number, to: number): Report {
  const rows = db().bookings.filter((b) => b.createdAt >= from && b.createdAt <= to);
  const sum = (list, f) => list.reduce((n, b) => n + f(b), 0);

  const taxable = sum(rows, (b) => (b.tax ? b.tax.taxable : b.amount.packing + b.amount.freight));
  const gst = sum(rows, (b) => (b.tax ? b.tax.gst : 0));
  const cgst = sum(rows, (b) => (b.tax?.cgst || 0));
  const sgst = sum(rows, (b) => (b.tax?.sgst || 0));
  const igst = sum(rows, (b) => (b.tax?.igst || 0));
  const gross = sum(rows, grossOf);

  const collected = rows.filter((b) => !b.payment || b.payment.settled);
  const pending = rows.filter((b) => b.payment && !b.payment.settled);

  const byCity: Record<string, CityTotal> = {};
  rows.forEach((b) => {
    byCity[b.to] = byCity[b.to] || { city: b.to, n: 0, value: 0 };
    byCity[b.to].n += 1;
    byCity[b.to].value += grossOf(b);
  });

  const byRate: Record<string, RateTotal> = {};
  rows.forEach((b) => {
    const r = b.tax ? b.tax.rate : 0;
    byRate[r] = byRate[r] || { rate: r, n: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 };
    byRate[r].n += 1;
    byRate[r].taxable += b.tax ? b.tax.taxable : b.amount.packing + b.amount.freight;
    byRate[r].cgst += b.tax?.cgst || 0;
    byRate[r].sgst += b.tax?.sgst || 0;
    byRate[r].igst += b.tax?.igst || 0;
    byRate[r].gst += b.tax ? b.tax.gst : 0;
  });

  return {
    rows,
    count: rows.length,
    gross, taxable, gst, cgst, sgst, igst,
    byRate: Object.values(byRate).sort((a, b) => b.rate - a.rate),
    collected: { n: collected.length, value: sum(collected, grossOf) },
    pending: { n: pending.length, value: sum(pending, grossOf) },
    byCity: Object.values(byCity).sort((a, b) => b.value - a.value),
  };
}

/** E-way bill is its own concern, so it gets its own query. */
export function ewayList(from: number, to: number): Booking[] {
  return db().bookings
    .filter((b) => b.createdAt >= from && b.createdAt <= to && (Number(b.goodsValue) || 0) >= EWAY_THRESHOLD)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Financial year in India runs April to March. */
export function financialYear(d = new Date()): { from: number; to: number; label: string } {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1).getTime(), to: new Date(y + 1, 2, 31, 23, 59, 59).getTime(), label: `FY ${y}-${String(y + 1).slice(2)}` };
}

/** E-way bill validity: one day per 200 km of movement, minimum one day. */
export const EWAY_KM_PER_DAY = 200;

export const ewayValidDays = (distanceKm: number | null | undefined) => Math.max(1, Math.ceil((Number(distanceKm) || 0) / EWAY_KM_PER_DAY));

/**
 * Records what the portal generated against a consignment: the 12-digit bill
 * number, the Part-B vehicle, and the road distance that sets validity.
 */
export function setEwayBill(id: string, { no = '', vehicleNo = '', distanceKm = null }: { no?: string; vehicleNo?: string; distanceKm?: number | null } = {}): Booking | null {
  const b = findBooking(id); if (!b) return null;
  const rec: EwayRecord = {
    no: String(no || '').trim(),
    vehicleNo: String(vehicleNo || '').trim().toUpperCase(),
    distanceKm: Number(distanceKm) > 0 ? Number(distanceKm) : null,
    validUntil: null,
  };
  if (rec.no) rec.validUntil = Date.now() + ewayValidDays(rec.distanceKm) * 864e5;
  b.eway = rec.no ? rec : null;
  save();
  return b;
}

/** 'none' (below threshold / not needed), 'pending', 'recorded', or 'expired'. */
export function ewayState(b: Booking): 'pending' | 'recorded' | 'expired' {
  if (!b.eway || !b.eway.no) return 'pending';
  return b.eway.validUntil && Date.now() > b.eway.validUntil ? 'expired' : 'recorded';
}

export function reachSummary(): ReachSummary {
  const d = db();
  const phones = new Set(Object.keys(d.chats || {}));
  d.outbox.forEach((m) => phones.add(m.phone));
  const sent = d.outbox.length
    + Object.values(d.chats || {}).reduce((n, c) => n + (c?.msgs || []).filter((m) => m.from === 'bot').length, 0);
  const st = d.stats || { handled: 0, thanks: 0, escalated: 0 };
  return {
    people: phones.size,
    sent,
    handled: st.handled,
    thanks: st.thanks,
    needHuman: openEscalations().length,
  };
}

export const markAllBizSeen = () => { db().outbox.forEach((m) => { m.bizSeen = true; }); save(); };

const lang = (): MessageLang => (db().business.msgLang || 'en') as MessageLang;
const etaFor = (b: Booking) => fmtDT(b.etaTs || Date.now() + b.etaDays * 864e5);

function notifyBookingConfirmed(b: Booking) {
  queueMsg(b.phone, msg('booked', {
    docket: b.docket, origin: db().business.origin, to: b.to,
    service: b.serviceType, amount: fmtMoney(b.amount.packing + b.amount.freight),
    eta: etaFor(b),
  }, lang()));
}

function notifyStatusChange(b: Booking) {
  const biz = db().business;
  const v = { docket: b.docket, origin: biz.origin, to: b.to, otp: b.otp, biz: biz.name };
  if (T_STATUS.includes(b.status)) queueMsg(b.phone, msg(b.status, v, lang()));
}
const T_STATUS: ParcelStatus[] = ['checked_in', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'];

function notifyRouteEvent(route: DispatchRoute, ev: RouteEvent) {
  bookingsOfRoute(route).forEach((b) => {
    if (b.status === 'delivered') return;
    const chat = db().chats[b.phone];
    if (chat?.updatesOptIn === false) return;
    if (ev.type === 'delay') {
      queueMsg(b.phone, msg('delay', {
        docket: b.docket, origin: route.origin, to: route.destination,
        reason: ev.note && ev.note !== ev.title ? `${ev.title} — ${ev.note}` : ev.title,
        extraHours: ev.revisedEtaHours,
      }, lang()));
    } else {
      queueMsg(b.phone, msg('route_update', { docket: b.docket, title: ev.title, note: ev.note }, lang()));
    }
  });
}

/* ---------- delivery recovery ----------
   Research: Indian carriers typically allow ~3 attempts across 24–72 hours before
   returning a parcel, and 40–50% of failed deliveries are still recoverable when
   the customer is contacted within hours. So a failure starts a visible clock. */
export const RTO_WINDOW_HOURS = 72;
export const MAX_ATTEMPTS = 3;

export function recoveryQueue(): RecoveryItem[] {
  return db().bookings
    .filter((b) => b.status === 'failed_attempt')
    .map((b) => {
      const since = Date.now() - (b.firstFailedTs || b.createdAt);
      const hoursLeft = Math.max(0, RTO_WINDOW_HOURS - Math.floor(since / 36e5));
      return { booking: b, hoursLeft, attempts: b.attempts || 1, expiring: hoursLeft <= 24 };
    })
    .sort((a, b) => a.hoursLeft - b.hoursLeft);
}

/* Meta's 24-hour rule: a business may reply freely only within 24 hours of the
   customer's last message; after that it must use an approved template. */
export function replyWindow(phone: string): ReplyWindow {
  const chat = db().chats[phone];
  const last = [...(chat?.msgs || [])].reverse().find((m) => m.from === 'me');
  if (!last) return { open: false, hoursLeft: 0 };
  const hoursLeft = 24 - (Date.now() - last.ts) / 36e5;
  return { open: hoursLeft > 0, hoursLeft: Math.max(0, Math.round(hoursLeft)) };
}

export const Store = {
  db, save, subscribe, getSnapshot, load,
  findBooking, findByDocket, bookingsByPhone, allCustomers,
  lotById, routeById, bookingsOfLot, routeOfLot, bookingsOfRoute, activeDelayFor,
  nextDocket, addBooking, updateStatus, verifyDeliveryOTP, confirmDelivered,
  recordPayment, toPaySummary, resendDelayAlert,
  createLot, deleteLot, assignToLot, ungroupedParcels, pendingDestinations, createRoute, postRouteEvent, attachToRoute,
  resendDeliveryOTP, revealOTP, markFailedAttempt, markRTO,
  updateBusiness, resetDemo, queueMsg, markAllBizSeen,
  logBotTurn, openEscalations, resolveEscalation, reachSummary,
  reportFor, ewayList, financialYear, gstRate, taxOn, grossOf, setEwayBill, ewayState, ewayValidDays,
  peekDocket, placeOfSupply, STATE_OF_CITY, stateOfCity, EWAY_KM_PER_DAY,
  recoveryQueue, replyWindow,
  normPhone, prettyPhone, estimateEtaDays, suggestFreight, fmtMoney, fmtDT, esc, waFmt,
};
