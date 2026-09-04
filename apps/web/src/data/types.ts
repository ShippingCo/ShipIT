/* ============================================================
   The ShippingCo domain model.

   These types describe what a courier business actually has: parcels, the lots they
   travel in, the routes those lots ride on, the money owed, and the WhatsApp
   conversation each customer is having. They were written by reading store.ts, so they
   describe the data the app really holds today rather than an idealised version of it.

   Two things to know before changing anything here:

   1. Optional fields are not laziness. A booking made at the counter today has a `tax`
      record and a `payment` record; one restored from a browser that last ran an older
      version of the app may not. `normalizeBookings()` in store.ts backfills those on
      load, which is exactly why the fields are optional in the type — the compiler
      should force every reader to cope with a record that predates the field.

   2. Timestamps are epoch milliseconds throughout, never Date objects and never
      strings. They survive JSON.stringify into localStorage unchanged, which is the
      only reason the store can round-trip through a string at all.

   When the Postgres schema is designed, this file is the starting point and moves to
   packages/shared — the browser and the server have to agree on these shapes.
   ============================================================ */

/* ---------- closed sets ---------- */

/** The happy path, in order, plus the two ways delivery goes wrong. */
export type ParcelStatus =
  | 'booked'
  | 'checked_in'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_attempt'
  | 'rto';

export type ServiceType = 'Standard' | 'Express' | 'Same-city';

/** 'paid' at the counter, or 'topay' — collected from the recipient on delivery. */
export type PaymentMode = 'paid' | 'topay';

/** Place of supply: same state means CGST + SGST, different state means IGST. */
export type SupplyKind = 'intra' | 'inter';

export type RouteStatus = 'scheduled' | 'departed' | 'arrived' | 'delayed';

export type RouteEventKind = 'info' | 'depart' | 'arrive' | 'delay';

export type GstMode = 'courier18' | 'gta5' | 'gta18' | 'none';

/** Who wrote a WhatsApp message: the assistant, or the customer. */
export type ChatSender = 'bot' | 'me';

/** What can be attached to a booking at the counter. */
export type AttachmentKind = 'image' | 'video' | 'audio';

/** Message language. The seed business runs English; Hindi templates exist alongside. */
export type MessageLang = 'en' | 'hi';

/* ---------- pieces of a booking ---------- */

/** Charges are stored split because the receipt prints them split. */
export interface Charges {
  packing: number;
  freight: number;
}

/**
 * GST computed once, at booking time, and stored — so every later screen reads a
 * number rather than recomputing one and disagreeing with the printed receipt.
 * Exactly one of (cgst + sgst) or igst is non-zero.
 */
export interface Tax {
  rate: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Payment {
  mode: PaymentMode;
  settled: boolean;
  /** When it was collected. Null while still outstanding. */
  settledTs: number | null;
}

/**
 * What the government e-way portal issued against a consignment. `validUntil` is
 * derived from `distanceKm` at one day per 200 km, so it is stored rather than
 * recomputed — the distance can be edited later without silently moving the expiry.
 */
export interface EwayRecord {
  no: string;
  vehicleNo: string;
  distanceKm: number | null;
  validUntil: number | null;
}

/** One line in a parcel's history. Append-only: entries are never edited or removed. */
export interface TimelineEntry {
  ts: number;
  status: ParcelStatus;
  title: string;
  note?: string;
}

/** A photo, clip or voice note attached to a booking, stored inline as a data URL. */
export interface Attachment {
  kind: AttachmentKind;
  url: string;
  name?: string;
  /** Original file size in bytes, kept so the UI can show what it is costing. */
  size?: number;
}

/* ---------- the records themselves ---------- */

export interface Booking {
  id: string;
  docket: string;

  /* the customer, denormalised onto the parcel — a counter booking is taken from
     whoever is standing there, and there is no customer account to attach it to */
  name: string;
  phone: string;
  to: string;
  address: string;

  weightKg: number;
  serviceType: ServiceType;
  /** Declared value of the contents; drives whether an e-way bill is needed. */
  goodsValue?: number;

  amount: Charges;
  tax?: Tax;
  supply?: SupplyKind;
  payment?: Payment;

  status: ParcelStatus;
  lotId: string | null;
  timeline: TimelineEntry[];
  createdAt: number;

  /** Estimated days in transit, and the resulting arrival instant. */
  etaDays: number;
  etaTs?: number;
  deliveredTs?: number;

  /* delivery OTP: live code, attempts spent against it, and the code that was
     eventually accepted (kept for the record once `otp` is cleared) */
  otp?: string | null;
  otpAttempts?: number;
  otpUsed?: string;

  /* failed-delivery recovery */
  failureReason?: string;
  attempts?: number;
  firstFailedTs?: number;

  eway?: EwayRecord | null;
  /** Superseded by `eway`; migrated and deleted on load. Never write this. */
  ewayBillNo?: string;

  photo?: string | null;
  attachments?: Attachment[];
}

/** Parcels for one destination, travelling together. */
export interface Lot {
  id: string;
  code: string;
  name: string;
  destination?: string | null;
  note?: string;
  createdAt: number;
}

export interface RouteEvent {
  ts: number;
  type: RouteEventKind;
  title: string;
  note?: string;
  /** Set on a delay event; pushes the ETA of every parcel on the route. */
  revisedEtaHours?: number;
}

/**
 * A physical movement — a flight, a train, a truck — carrying lots and loose parcels.
 * Named DispatchRoute because `Route` already means something in react-router.
 */
export interface DispatchRoute {
  id: string;
  code: string;
  origin: string;
  destination: string;
  mode: string;
  carrierCode: string;
  departAt: number;
  lotIds: string[];
  bookingIds: string[];
  status: RouteStatus;
  events: RouteEvent[];
}

export interface ChatMessage {
  from: ChatSender;
  text: string;
  ts: number;
}

export interface Chat {
  updatesOptIn: boolean;
  msgs: ChatMessage[];
}

/** A message the business has queued for a customer. */
export interface OutboxMessage {
  id: string;
  phone: string;
  text: string;
  ts: number;
  /** Whether the operator has seen it in the automation feed. */
  bizSeen?: boolean;
  /** Set once the simulated WhatsApp view has drained it into the chat. */
  delivered?: boolean;
}

/** A conversation the assistant handed back to a human, and why. */
export interface Escalation {
  id: string;
  phone: string;
  text: string;
  ts: number;
  reason: string;
  resolved: boolean;
  resolvedTs?: number;
}

export interface Business {
  name: string;
  tagline: string;
  phone: string;
  address: string;
  gstin: string;
  /** The city the business dispatches from; sets place of supply. */
  origin: string;
  botName: string;
  msgLang: MessageLang | string;
  gstMode: GstMode | string;
  /** Shop logo as a data URL, shown on the receipt and in both app headers. */
  logo?: string | null;
}

/** What the assistant has done, for the dashboard's value proposition. */
export interface BotStats {
  handled: number;
  thanks: number;
  escalated: number;
}

/** Counters behind human-readable codes: SBC104211, LOT-MUM-01, RT-102. */
export interface Sequences {
  docket: number;
  lot: number;
  route: number;
}

/** The whole persisted state. One JSON object in localStorage under `shippingco_v1`. */
export interface Database {
  v: number;
  business: Business;
  bookings: Booking[];
  lots: Lot[];
  routes: DispatchRoute[];
  /** Keyed by normalised phone number, e.g. '+447700900001'. */
  chats: Record<string, Chat | undefined>;
  outbox: OutboxMessage[];
  stats: BotStats;
  escalations: Escalation[];
  seq: Sequences;
}

/* ---------- shapes returned by the store, not stored by it ---------- */

/** Input to `addBooking` — what the counter form collects, before any derivation. */
export interface NewBookingInput {
  docket?: string;
  name: string;
  phone: string;
  to: string;
  address?: string;
  weightKg?: number | string;
  serviceType?: ServiceType;
  packing?: number | string;
  freight?: number | string;
  paymentMode?: PaymentMode;
  lotId?: string | null;
  photo?: string | null;
  attachments?: Attachment[];
  goodsValue?: number;
}

export interface NewRouteInput {
  origin: string;
  destination: string;
  mode: string;
  carrierCode: string;
  departAt?: number;
  lotIds?: string[];
  bookingIds?: string[];
}

export type OtpFailureReason = 'missing' | 'locked' | 'wrong';

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: OtpFailureReason; left?: number };

export interface GstModeOption {
  value: GstMode;
  label: string;
  rate: number;
  note: string;
}

/** A parcel that failed delivery, with its remaining window before return-to-sender. */
export interface RecoveryItem {
  booking: Booking;
  hoursLeft: number;
  attempts: number;
  expiring: boolean;
}

/** Meta's 24-hour customer-service window. */
export interface ReplyWindow {
  open: boolean;
  hoursLeft: number;
}

export interface CityTotal {
  city: string;
  n: number;
  value: number;
}

export interface RateTotal {
  rate: number;
  n: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gst: number;
}

/** Everything the accountant asks for, for one date range. */
export interface Report {
  rows: Booking[];
  count: number;
  gross: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  byRate: RateTotal[];
  collected: { n: number; value: number };
  pending: { n: number; value: number };
  byCity: CityTotal[];
}

export interface ReachSummary {
  people: number;
  sent: number;
  handled: number;
  thanks: number;
  needHuman: number;
}
