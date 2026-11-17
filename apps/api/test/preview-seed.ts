/**
 * A richer, fictional data set for the workflow preview (`pnpm preview:seeded`).
 *
 * Runs only inside the guarded disposable fixture (counter-demo.ts). Every record goes
 * through the real services and HTTP routes, so the data obeys the same rules as data an
 * operator would create: priced quotes, tax calculations, versions, idempotency keys and
 * custody transitions. Names, phones and addresses are invented; phone numbers use the
 * reserved 555-01xx range so none can belong to a real person.
 */
import { randomUUID } from 'node:crypto';
import { createRouteService } from '../src/modules/routes/service.ts';
import { input as pricingInput } from './pricing-support.ts';
import { taxFacts } from './tax-support.ts';
import { org, A } from './audit-support.ts';
import type { attachmentSetup } from './attachment-support.ts';
import type { FastifyInstance } from 'fastify';

type Setup = Awaited<ReturnType<typeof attachmentSetup>>;
type Actor = { id: string; token: string };
/** The few response fields the seed reads back, across the routes it calls. */
interface Reply {
  id: string; version: number;
  parcels?: { id: string; version?: number }[];
  payment_obligation?: { total_paise: number };
  lots?: { id: string; version: number }[];
}

const people = [
  ['Aarav Mehta', '12 Ashok Nagar, Pune'], ['Diya Sharma', '4 Rose Villa, Baner, Pune'], ['Kabir Rao', '88 MG Road, Pune'],
  ['Ananya Iyer', '7 Lake View, Kothrud, Pune'], ['Vihaan Patel', '23 Sunrise Society, Aundh, Pune'], ['Ishita Kulkarni', '5 Shivaji Path, Pune'],
  ['Reyansh Gupta', '61 Station Road, Pune'], ['Meera Joshi', '14 Hill Crest, Kharadi, Pune'], ['Arjun Nair', '30 Market Lane, Hadapsar, Pune'],
  ['Saanvi Desai', '9 Garden Court, Wakad, Pune'], ['Rohan Bhat', '2 Temple Street, Camp, Pune'], ['Tara Menon', '47 Riverside, Viman Nagar, Pune'],
  ['Shree Ganesh Traders', 'Shop 3, Market Yard, Pune'], ['Laxmi Textiles', '18 Cloth Market, Pune'], ['Om Sai Electronics', '6 Lamington Road Annex, Pune'],
] as const;
const recipients = [
  ['Neha Kapoor', '11 Marine Drive, Mumbai'], ['Raj Malhotra', '3 Sector 15, Noida'], ['Pooja Reddy', '20 Banjara Hills, Hyderabad'],
  ['Amit Verma', '8 Civil Lines, Jaipur'], ['Sneha Pillai', '15 MG Road, Kochi'], ['Vikram Singh', '42 Model Town, Delhi'],
  ['Kavya Rao', '9 Indiranagar, Bengaluru'], ['Farhan Khan', '27 Park Street, Kolkata'], ['Nisha Jain', '5 CG Road, Ahmedabad'],
];
const phone = (n: number) => `+1 202-555-01${String(n % 100).padStart(2, '0')}`;

export async function seedPreview(app: FastifyInstance, s: Setup, actor: Actor) {
  // Through the fixture's own server, exactly as the browser talks to it: same pricing
  // clock, same CSRF bootstrap, same cookies.
  await app.ready();
  const query = new URLSearchParams({ organization_id: org, franchise_id: A });
  const boot = await app.inject({ url: '/auth/bootstrap', headers: { origin: 'http://localhost:5174' } });
  const csrf = boot.cookies[0]!;
  const headers = { 'content-type': 'application/json', origin: 'http://localhost:5174', 'x-csrf-token': boot.json().csrf_token as string };
  // Some commands are rate limited per actor, as they are in production. The seed waits
  // and sends the same command again rather than skipping it.
  const post = async (path: string, body: unknown, token = actor.token, attempt = 0): Promise<Reply> => {
    const key = randomUUID();
    const response = await app.inject({ method: 'POST', url: `${path}${path.includes('/organizations/') ? '' : `?${query}`}`, headers: { ...headers, 'idempotency-key': key },
      cookies: { shipit_session: token, [csrf.name]: csrf.value }, payload: JSON.stringify(body), remoteAddress: `127.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
    if (response.statusCode === 429 && attempt < 30) {
      const wait = Number(response.headers['retry-after'] ?? 5) * 1000 || 5000;
      await new Promise(resolve => setTimeout(resolve, Math.min(wait, 20000)));
      return post(path, body, token, attempt + 1);
    }
    if (response.statusCode >= 300) throw new Error(`SEED ${path} ${response.statusCode} ${response.body.slice(0, 300)}`);
    return response.json() as Reply;
  };

  // ---- customers ------------------------------------------------------------------
  const customers: { id: string; version: number }[] = [];
  for (const [index, [name, address]] of people.entries()) {
    const created = await post(`/api/v1/organizations/${org}/franchises/${A}/customers`, { name, phone: phone(10 + index), address });
    customers.push({ id: created.id, version: created.version ?? 1 });
  }

  // ---- bookings: varied freight, one to three parcels each --------------------------
  // The fixture publishes one rate (SYN_DEST, standard, 999 g). Freight varies through the
  // owner's commercial override, and a booking's parcels split the quoted weight.
  type Parcel = { id: string; version: number; booking: string; gross: number };
  const parcels: Parcel[] = [];
  const bookings: { id: string; gross: number }[] = [];
  const freights = [8500, 12000, 15500, 22000, 9900, 31000, 13400, 18800, 26500, 11200, 45000, 7600];
  const total = 40;
  for (let i = 0; i < total; i += 1) {
    const customer = customers[i % customers.length]!;
    const freight = freights[i % freights.length]!;
    const pricing = { ...pricingInput, override: { freight_paise: freight, reason_code: 'commercial_exception' as const } };
    const quote = await post('/api/v1/pricing/quote', pricing);
    const intentBody = { quote_id: quote.id, pricing_input: pricing, facts: taxFacts };
    const intent = await post('/api/v1/tax/intents', intentBody);
    const calculation = await post('/api/v1/tax/calculations', { intent_id: intent.id });
    const split = i % 5 === 0 ? [333, 333, 333] : i % 3 === 0 ? [500, 499] : [999];
    const recipient = recipients[i % recipients.length]!;
    const booked = await post('/api/v1/bookings', {
      customer_id: customer.id, expected_customer_version: customer.version, tax_calculation_id: calculation.id, tax_intent: intentBody,
      parcels: split.map((weight, n) => ({ weight_grams: weight, recipient: { name: recipient[0], phone: phone(50 + ((i + n) % 40)), address: recipient[1] } })),
    });
    const gross = booked.payment_obligation?.total_paise ?? 0;
    bookings.push({ id: booked.id, gross });
    for (const parcel of booked.parcels ?? []) parcels.push({ id: parcel.id, version: parcel.version ?? 1, booking: booked.id, gross });
  }

  // ---- movement: check in most, dispatch some, put a few on the road --------------
  const hub = randomUUID(); // one named hub's reference, as the console mints it
  const checkIn = parcels.slice(0, Math.floor(parcels.length * 0.7));
  for (const parcel of checkIn) {
    const result = await post(`/api/v1/parcels/${parcel.id}/check-in`, { expected_version: parcel.version, evidence_ref: randomUUID(), location_ref: hub });
    parcel.version = result.version;
  }
  const routes = createRouteService(s.pool, s.keys.browser);
  const run = (id: string | null, body: unknown, op: Parameters<typeof routes.execute>[7]) => {
    const key = randomUUID();
    return routes.execute(actor.token, id, null, { organization_id: org, franchise_id: A }, key, ['idempotency-key', key], body, op, randomUUID());
  };
  const dispatched: Parcel[] = [];
  const legs = [
    { origin: 'Pune hub', destination: 'Mumbai', carrier_code: 'MH-12-AB-4521', at: '2099-01-01T09:00:00+05:30', take: 8 },
    { origin: 'Pune hub', destination: 'Bengaluru', carrier_code: 'KA-01-CD-7788', at: '2099-01-01T13:30:00+05:30', take: 6 },
  ];
  let cursor = Math.floor(checkIn.length * 0.35);
  for (const leg of legs) {
    const batch = checkIn.slice(cursor, cursor + leg.take); cursor += leg.take;
    if (!batch.length) break;
    let route = await run(null, { origin: leg.origin, destination: leg.destination, mode: 'road', carrier_code: leg.carrier_code, scheduled_departure_at: leg.at }, 'routes.create');
    for (const parcel of batch) route = await run(route.id, { parcel_id: parcel.id, expected_version: route.version }, 'routes.parcel.attach');
    route = await run(route.id, { expected_version: route.version }, 'routes.finalize');
    for (const parcel of batch) {
      const result = await post(`/api/v1/parcels/${parcel.id}/dispatch`, { expected_version: parcel.version, evidence_ref: randomUUID(), manifest_id: route.current_manifest_id });
      parcel.version = result.version; dispatched.push(parcel);
    }
    // The first leg has left: its parcels are on the way.
    if (leg === legs[0]) for (const parcel of batch.slice(0, 5)) {
      try {
        const result = await post(`/api/v1/parcels/${parcel.id}/transit`, { expected_version: parcel.version, evidence_ref: randomUUID(), route_id: route.id });
        parcel.version = result.version;
      } catch { /* a route that has not departed keeps its parcels dispatched */ }
    }
  }

  // ---- lots: group some of what is waiting at the hub -----------------------------
  const waiting = checkIn.filter(parcel => !dispatched.includes(parcel));
  const lotPlans = [
    { name: 'Mumbai evening van', destination_key: 'SYN_DEST', take: 5 },
    { name: 'Hyderabad bulk', destination_key: 'SYN_DEST', take: 4 },
  ];
  let lotCursor = 0;
  for (const plan of lotPlans) {
    let lot = await post('/api/v1/lots', { name: plan.name, destination_key: plan.destination_key });
    for (const parcel of waiting.slice(lotCursor, lotCursor + plan.take)) {
      try { const result = await post(`/api/v1/lots/${lot.id}/parcels`, { expected_version: lot.version, parcel_id: parcel.id }); lot = result.lots?.find(value => value.id === lot.id) ?? lot; }
      catch { /* a parcel the lot cannot take is left ungrouped */ }
    }
    lotCursor += plan.take;
  }

  // ---- money: some paid in full, some part-paid, the rest owed ---------------------
  let paid = 0, partly = 0;
  for (const [index, booking] of bookings.entries()) {
    if (!booking.gross) continue;
    const amount = index % 3 === 0 ? booking.gross : index % 5 === 1 ? Math.floor(booking.gross / 2) : 0;
    if (!amount) continue;
    try {
      await post(`/api/v1/bookings/${booking.id}/payments`, { amount_paise: amount, currency: 'INR', context: 'to_pay', method: index % 2 ? 'upi' : 'cash', collection_reference: randomUUID() }, s.local.token);
      if (amount === booking.gross) paid += 1; else partly += 1;
    } catch { /* a booking that cannot take a payment yet stays owed */ }
  }

  return { customers: customers.length, bookings: bookings.length, parcels: parcels.length, checkedIn: checkIn.length, dispatched: dispatched.length, paid, partly };
}
