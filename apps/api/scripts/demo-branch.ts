/**
 * Local demo branch: `pnpm demo:seed` and `pnpm demo:remove`.
 *
 * Seeds a fictional "Demo branch" inside the local developer organization so every screen
 * has something to open, and removes all of it again. Local developer database only: the
 * same guard as `pnpm db:access` (NODE_ENV=development, SHIPIT_ENVIRONMENT=developer, a
 * loopback `shipit_developer` database). Deploying never copies local data.
 *
 * Seeding goes through the running local API (`pnpm api`) exactly as the browser does
 * (sessions, CSRF, idempotency keys, rate limits), so every record obeys the product's rules.
 * Only three things are done directly, because the product has no HTTP route for them:
 * creating the branch (an internal tenancy service), and creating the fictional staff
 * accounts with their memberships and short-lived sessions. The sessions are revoked at
 * the end. The staff have no phone or e-mail, so nobody can sign in as them.
 *
 * Names, phones and addresses are invented; phones use the reserved 555-01xx range.
 * Removal deletes every row that belongs to the branch or to its demo staff, in one
 * transaction, as the local container's bootstrap superuser (audit tables are append-only
 * to the application itself).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createPool, type DatabasePool } from '@shippingco/db';
import { localAccessConfiguration } from '../../../packages/db/src/local-access.ts';
import { digest } from '../src/modules/auth/crypto.ts';
import { createTenancyService } from '../src/modules/tenancy/service.ts';

const env = process.env;
const DEMO_CODE = 'DEMO';
const DEMO_NAME = 'Demo branch';
const API = env.DEMO_API_URL ?? `http://127.0.0.1:${env.PORT ?? '3000'}`;
const ORIGIN = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',')[0]!.trim();

/** Stable ids for the fictional staff, so removal can find them without a side table. */
const demoId = (name: string) => {
  const h = createHash('sha256').update('shipit-demo-user:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const staff = {
  admin: { id: demoId('admin'), roles: ['franchise_admin', 'operator', 'dispatcher', 'accountant'] },
  approver: { id: demoId('approver'), roles: ['franchise_admin'] },
  counter: { id: demoId('counter'), roles: ['operator'] },
  accountant: { id: demoId('accountant'), roles: ['accountant'] },
  agentOne: { id: demoId('agent-1'), roles: ['delivery_agent'] },
  agentTwo: { id: demoId('agent-2'), roles: ['delivery_agent'] },
} as const;
type StaffName = keyof typeof staff;

function log(message: string) { console.log(`· ${message}`); }

// ---- database ------------------------------------------------------------------------
function pools() {
  const config = localAccessConfiguration(env, true);
  return { runtime: createPool(config.runtime), owner: createPool(config.owner!) };
}
async function organization(db: DatabasePool) {
  const rows = (await db.query<{ id: string; display_name: string }>('SELECT id,display_name FROM shipit.organizations ORDER BY created_at')).rows;
  const chosen = env.DEMO_ORGANIZATION_ID ? rows.find(r => r.id === env.DEMO_ORGANIZATION_ID) : rows.length === 1 ? rows[0] : undefined;
  if (!chosen) throw new Error(rows.length ? 'Several organizations: set DEMO_ORGANIZATION_ID to the one to use.' : 'No organization yet: sign in and finish onboarding first.');
  return chosen;
}
async function existingDemo(db: DatabasePool, org: string) {
  return (await db.query<{ id: string }>('SELECT id FROM shipit.franchises WHERE organization_id=$1 AND franchise_code=$2', [org, DEMO_CODE])).rows[0]?.id ?? null;
}

// ---- removal -------------------------------------------------------------------------
function superuserSql(sql: string) {
  const container = env.LOCAL_DB_CONTAINER || 'shipit-postgres-local';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid LOCAL_DB_CONTAINER');
  const user = execFileSync('docker', ['exec', container, 'printenv', 'POSTGRES_USER'], { encoding: 'utf8' }).trim();
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'shipit_developer', '-tA'],
    { input: sql, encoding: 'utf8' });
}
async function remove() {
  const { runtime, owner } = pools();
  try {
    const org = await organization(owner);
    const franchise = await existingDemo(owner, org.id);
    const ids = [...(franchise ? [franchise] : []), ...Object.values(staff).map(s => s.id)];
    for (const id of ids) if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Unexpected id');
    const list = ids.map(id => `'${id}'::uuid`).join(',');
    // Every base table: rows of the demo branch (franchise_id) and rows that carry a demo id
    // in any uuid column (staff accounts, their sessions and memberships, the branch itself).
    const out = superuserSql(`BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE demo_ids(id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO demo_ids VALUES ${ids.map(id => `('${id}')`).join(',')};
DO $$
DECLARE t record; c record; n bigint; total bigint := 0;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='shipit' AND table_type='BASE TABLE' LOOP
    FOR c IN SELECT column_name FROM information_schema.columns
      WHERE table_schema='shipit' AND table_name=t.table_name AND data_type='uuid' LOOP
      EXECUTE format('DELETE FROM shipit.%I WHERE %I IN (SELECT id FROM demo_ids)', t.table_name, c.column_name);
      GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'removed %', total;
  -- Nothing may still point at the branch or its staff.
  FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='shipit' AND table_type='BASE TABLE' LOOP
    FOR c IN SELECT column_name FROM information_schema.columns
      WHERE table_schema='shipit' AND table_name=t.table_name AND data_type='uuid' LOOP
      EXECUTE format('SELECT count(*) FROM shipit.%I WHERE %I IN (SELECT id FROM demo_ids)', t.table_name, c.column_name) INTO n;
      IF n > 0 THEN RAISE EXCEPTION 'demo rows remain in %', t.table_name; END IF;
    END LOOP;
  END LOOP;
END $$;
SELECT 'ok';
COMMIT;`);
    void list;
    if (!out.includes('ok')) throw new Error('Removal did not finish.');
    console.log(franchise ? `Removed "${DEMO_NAME}" and its demo staff from ${org.display_name}.` : 'No demo branch found; demo staff accounts (if any) removed.');
  } finally { await runtime.close(); await owner.close(); }
}

// ---- HTTP, as the browser talks to the API ---------------------------------------------
/** The reply fields the seed reads back, across every route it calls. Request bodies are plain objects. */
interface Json {
  id: string; version: number; revision_id?: string; resource_id?: string; request_id?: string; receipt_id?: string; attempt_id?: string;
  csrf_token: string; current_manifest_id?: string; source_version?: number; source_digest?: string; expected_version?: number; payment_version?: number;
  payment_obligation?: { total_paise: number }; parcels?: Json[]; lots?: Json[]; items?: Json[]; beneficiaries?: Json[]; debtor?: { id: string; version: number };
  [key: string]: unknown;
}
class Client {
  private csrf = ''; private cookie = ''; private started = 0;
  private token: string; private org: string; private franchise: string;
  constructor(token: string, org: string, franchise: string) { this.token = token; this.org = org; this.franchise = franchise; }
  async start() {
    const boot = await fetch(API + '/auth/bootstrap', { headers: { origin: ORIGIN } });
    if (!boot.ok) throw new Error(`API not reachable at ${API} (start it with pnpm api).`);
    this.csrf = ((await boot.json()) as Json).csrf_token;
    this.cookie = boot.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    this.started = Date.now();
    return this;
  }
  private url(path: string) {
    if (path.includes('/organizations/')) return API + path;
    return API + path + (path.includes('?') ? '&' : '?') + new URLSearchParams({ organization_id: this.org, franchise_id: this.franchise });
  }
  async send(method: string, path: string, body?: unknown, attempt = 0): Promise<Json> {
    // The browser binding behind the CSRF token lasts 10 minutes; renew it as the browser would.
    if (Date.now() - this.started > 8 * 60_000) await this.start();
    const response = await fetch(this.url(path), {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': this.csrf, 'idempotency-key': randomUUID(),
        cookie: `${this.cookie}; shipit_session=${this.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if ((response.status === 429 || response.status === 503) && attempt < 40) {
      const wait = Math.min(Number(response.headers.get('retry-after') ?? 3) * 1000 || 3000, 20000);
      await new Promise(resolve => setTimeout(resolve, wait));
      return this.send(method, path, body, attempt + 1);
    }
    const text = await response.text();
    if (response.status >= 300) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as Json;
  }
  post(path: string, body: unknown = {}) { return this.send('POST', path, body); }
  get(path: string) { return this.send('GET', path); }
}
/** One step that may fail without stopping the seed; the reason is printed. */
async function attempt<T>(label: string, work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch (error) { console.warn(`  skipped ${label}: ${(error as Error).message.slice(0, 300)}`); return null; }
}

// ---- data ----------------------------------------------------------------------------
const people = [
  ['Aarav Mehta', '12 Ashram Road, Ahmedabad'], ['Diya Shah', '4 Law Garden, Ahmedabad'], ['Kabir Rao', '88 CG Road, Ahmedabad'],
  ['Ananya Iyer', '7 Satellite Road, Ahmedabad'], ['Vihaan Patel', '23 Navrangpura, Ahmedabad'], ['Ishita Desai', '5 Paldi, Ahmedabad'],
  ['Reyansh Gupta', '61 Station Road, Ahmedabad'], ['Meera Joshi', '14 Bodakdev, Ahmedabad'], ['Arjun Nair', '30 Maninagar, Ahmedabad'],
  ['Saanvi Trivedi', '9 Vastrapur, Ahmedabad'], ['Rohan Bhatt', '2 Thaltej, Ahmedabad'], ['Tara Menon', '47 Prahlad Nagar, Ahmedabad'],
  ['Shree Ganesh Traders', 'Shop 3, Kalupur Market, Ahmedabad'], ['Laxmi Textiles', '18 Revdi Bazaar, Ahmedabad'], ['Om Sai Electronics', '6 Relief Road, Ahmedabad'],
] as const;
const recipients = [
  ['Neha Kapoor', '11 Marine Drive, Mumbai', 'MUMBAI'], ['Raj Malhotra', '3 Sector 15, Noida', 'DELHI'], ['Pooja Reddy', '20 Banjara Hills, Hyderabad', 'HYDERABAD'],
  ['Amit Verma', '8 Civil Lines, Jaipur', 'JAIPUR'], ['Sneha Pillai', '15 MG Road, Kochi', 'KOCHI'], ['Vikram Singh', '42 Model Town, Delhi', 'DELHI'],
  ['Kavya Rao', '9 Indiranagar, Bengaluru', 'BENGALURU'], ['Farhan Khan', '27 Park Street, Kolkata', 'KOLKATA'], ['Nisha Jain', '5 FC Road, Pune', 'PUNE'],
] as const;
const phone = (n: number) => `+1 202-555-01${String(n % 100).padStart(2, '0')}`;

async function seed() {
  const { runtime, owner } = pools();
  const sessions: string[] = [];
  try {
    const org = await organization(owner);
    if (await existingDemo(owner, org.id)) throw new Error(`"${DEMO_NAME}" already exists. Run pnpm demo:remove first to seed it again.`);
    log(`organization: ${org.display_name}`);

    // 1. The branch, through the tenancy service as an internal service actor.
    const tenancy = createTenancyService({ database: runtime, authorizer: { authorize: async action => ({ action, organizationId: org.id,
      permittedFranchiseIds: [], actor: { type: 'service', id: 'demo-seed' }, correlationId: randomUUID() }) } });
    const branch = await tenancy.createFranchise({ display_name: DEMO_NAME, franchise_code: DEMO_CODE });
    const F = branch.id as string;
    log(`branch: ${DEMO_NAME}`);

    // 2. Fictional staff: accounts, memberships scoped to the demo branch, and a session each.
    const tokens = {} as Record<StaffName, string>;
    for (const [name, member] of Object.entries(staff) as [StaffName, typeof staff[StaffName]][]) {
      await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1) ON CONFLICT DO NOTHING', [member.id]);
      for (const role of member.roles) {
        const membership = randomUUID();
        await owner.query('INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)', [membership, member.id, org.id, role]);
        await owner.query('INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id) VALUES($1,$2,$3)', [membership, org.id, F]);
      }
      const token = randomBytes(32).toString('base64url'), session = randomUUID();
      await owner.query(`INSERT INTO shipit.auth_sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at)
        VALUES($1,$2,$3,1,clock_timestamp()+interval '2 hours',clock_timestamp()+interval '2 hours')`, [session, member.id, digest(token)]);
      sessions.push(session); tokens[name] = token;
    }
    log(`staff: ${Object.keys(staff).length} fictional accounts (no sign-in possible)`);
    const as = async (name: StaffName) => new Client(tokens[name], org.id, F).start();
    const admin = await as('admin'), counter = await as('counter'), approver = await as('approver');

    // 3. Tax: Gujarat courier supplier, as the counter's tax settings screen saves it.
    const taxPath = `/api/v1/organizations/${org.id}/franchises/${F}/tax/settings`;
    const tax = await admin.get(taxPath);
    await admin.post(taxPath, { mode: 'courier18', supplier_state: '24', supplier_gstin: '24ABCDE1234F1Z9', expected_version: tax.version ?? tax.expected_version ?? 1 });
    log('tax settings');

    // 4. Customers.
    const customers: { id: string; version: number }[] = [];
    for (const [index, [name, address]] of people.entries()) {
      const created = await counter.post(`/api/v1/organizations/${org.id}/franchises/${F}/customers`, { name, phone: phone(10 + index), address });
      customers.push({ id: created.id, version: created.version ?? 1 });
    }
    log(`customers: ${customers.length}`);

    // 5. Bookings, priced at the counter (freight and packing typed in), one to three parcels.
    const bookings: { id: string; gross: number; customer: string }[] = [];
    const parcels: { id: string; version: number; booking: string; destination: string }[] = [];
    const freights = [8500, 12000, 15500, 22000, 9900, 31000, 13400, 18800, 26500, 11200, 45000, 7600];
    for (let i = 0; i < 36; i += 1) {
      const customer = customers[i % customers.length]!, recipient = recipients[i % recipients.length]!;
      const split = i % 6 === 0 ? [1000, 1000, 1000] : i % 4 === 0 ? [1500, 1000] : [1000 + (i % 5) * 500];
      const weight = split.reduce((n, w) => n + w, 0);
      const pricing = { destination_key: recipient[2], service: i % 3 === 0 ? 'express' : 'standard', weight_grams: weight,
        charges: { freight_paise: freights[i % freights.length]!, packing_paise: i % 4 === 0 ? 3000 : 0 } };
      const result = await attempt(`booking ${i + 1}`, async () => {
        const quote = await counter.post('/api/v1/pricing/quote', pricing);
        const intentBody = { quote_id: quote.id, pricing_input: pricing, facts: { service_recipient_ref: 'DEMO_BUYER', registration: 'unregistered',
          recipient_state: null, recipient_gstin: null, handover_state: '24', evidence_ref: 'DEMO_HANDOVER', special_case: 'none' } };
        const intent = await counter.post('/api/v1/tax/intents', intentBody);
        const calculation = await counter.post('/api/v1/tax/calculations', { intent_id: intent.id });
        return counter.post('/api/v1/bookings', { customer_id: customer.id, expected_customer_version: customer.version, tax_calculation_id: calculation.id,
          tax_intent: intentBody, parcels: split.map((weight_grams, n) => ({ weight_grams, docket: `DEMO${String(i * 3 + n + 1).padStart(5, '0')}`,
            recipient: { name: recipient[0], phone: phone(50 + ((i + n) % 40)), address: recipient[1] } })) });
      });
      if (!result) continue;
      bookings.push({ id: result.id, gross: result.payment_obligation?.total_paise ?? 0, customer: customer.id });
      for (const parcel of result.parcels ?? []) parcels.push({ id: parcel.id, version: parcel.version ?? 1, booking: result.id, destination: recipient[2] });
    }
    log(`bookings: ${bookings.length} with ${parcels.length} parcels`);
    if (!bookings.length) throw new Error('No booking could be created; see the reasons above.');

    // 6. Money in: a cash drawer and a UPI account; some bookings paid in full, some part-paid.
    const accounts = {
      cash: await admin.post('/api/v1/receiving-accounts', { name: 'Counter cash', methods: ['cash'], other_method_name: null, active: true, expected_version: 0 }),
      upi: await admin.post('/api/v1/receiving-accounts', { name: 'Shop UPI', methods: ['upi'], other_method_name: null, active: true, expected_version: 0 }),
    };
    let paid = 0, partly = 0;
    const paidBookings: typeof bookings = [];
    for (const [index, booking] of bookings.entries()) {
      if (!booking.gross) continue;
      const amount = index % 3 === 0 ? booking.gross : index % 5 === 1 ? Math.floor(booking.gross / 2) : 0;
      if (!amount) continue;
      const method = index % 2 ? 'upi' : 'cash', account = accounts[method];
      const done = await attempt(`payment for booking ${index + 1}`, () => counter.post('/api/v1/money-receipts', {
        customer_id: booking.customer, account_id: account.id, expected_account_version: account.version, method, amount_paise: amount, currency: 'INR',
        receiver_id: staff.counter.id, custodian_id: staff.counter.id, occurred_at: new Date(Date.now() - 60_000).toISOString(), external_reference: null,
        allocations: [{ booking_id: booking.id, amount_paise: amount, context: 'to_pay', expected_payment_version: 0 }] }));
      if (done) { if (amount === booking.gross) { paid += 1; paidBookings.push(booking); } else partly += 1; }
    }
    log(`payments: ${paid} paid in full, ${partly} part-paid, the rest owed`);

    // 7. Movement: check most parcels in at the hub, group some into bags, put two trips on the road.
    const hub = randomUUID();
    const checkedIn = parcels.slice(0, Math.floor(parcels.length * 0.75));
    for (const parcel of checkedIn) {
      const r = await attempt('check-in', () => counter.post(`/api/v1/parcels/${parcel.id}/check-in`, { expected_version: parcel.version, evidence_ref: randomUUID(), location_ref: hub }));
      if (r) parcel.version = r.version;
    }
    log(`checked in: ${checkedIn.length}`);
    const dispatched: typeof parcels = [];
    const legs = [
      { origin: 'Ahmedabad hub', destination: 'Mumbai', carrier_code: 'GJ-01-AB-4521', hours: 2, take: 8 },
      { origin: 'Ahmedabad hub', destination: 'Delhi', carrier_code: 'GJ-01-CD-7788', hours: 6, take: 6 },
    ];
    let cursor = Math.floor(checkedIn.length * 0.4);
    for (const leg of legs) {
      const batch = checkedIn.slice(cursor, cursor + leg.take); cursor += leg.take;
      if (!batch.length) break;
      await attempt(`trip to ${leg.destination}`, async () => {
        let route = await admin.post('/api/v1/routes', { origin: leg.origin, destination: leg.destination, mode: 'road', carrier_code: leg.carrier_code,
          scheduled_departure_at: new Date(Date.now() + leg.hours * 3600_000).toISOString() });
        for (const parcel of batch) route = await admin.post(`/api/v1/routes/${route.id}/parcels`, { parcel_id: parcel.id, expected_version: route.version });
        route = await admin.post(`/api/v1/routes/${route.id}/finalize`, { expected_version: route.version });
        for (const parcel of batch) {
          const r = await attempt('dispatch', () => admin.post(`/api/v1/parcels/${parcel.id}/dispatch`, { expected_version: parcel.version, evidence_ref: randomUUID(), manifest_id: route.current_manifest_id }));
          if (r) { parcel.version = r.version; dispatched.push(parcel); }
        }
        if (leg === legs[0]) for (const parcel of batch.slice(0, 5)) {
          const r = await attempt('in transit', () => admin.post(`/api/v1/parcels/${parcel.id}/transit`, { expected_version: parcel.version, evidence_ref: randomUUID(), route_id: route.id }));
          if (r) parcel.version = r.version;
        }
      });
    }
    log(`trips: ${legs.length}, parcels dispatched: ${dispatched.length}`);
    const waiting = checkedIn.filter(parcel => !dispatched.includes(parcel));
    // A bag holds parcels for one destination: one bag per city that has parcels waiting.
    const byCity = new Map<string, typeof parcels>();
    for (const parcel of waiting) byCity.set(parcel.destination, [...(byCity.get(parcel.destination) ?? []), parcel]);
    let bags = 0;
    for (const [city, group] of [...byCity].sort((a, b) => b[1].length - a[1].length).slice(0, 3)) {
      await attempt(`bag for ${city}`, async () => {
        let lot = await admin.post('/api/v1/lots', { name: `${city[0]}${city.slice(1).toLowerCase()} van`, destination_key: city });
        for (const parcel of group.slice(0, 6)) {
          const r = await attempt('bag parcel', () => admin.post(`/api/v1/lots/${lot.id}/parcels`, { expected_version: lot.version, parcel_id: parcel.id }));
          if (r) lot = r.lots?.find((value: Json) => value.id === lot.id) ?? lot;
        }
        bags += 1;
      });
    }
    log(`bags: ${bags}`);

    // ---- stage two: the money features ------------------------------------------------
    const day = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const unpaid = bookings.filter(b => !paidBookings.includes(b));

    // 8. Credit customers: two monthly accounts, one with its own rates, a statement for this month.
    const accountsMade: (Json & { debtor: { id: string; version: number } })[] = [];
    for (const [n, plan] of [{ customer: 12, name: 'Shree Ganesh Traders — monthly', limit: 2500000, state: 'active' },
      { customer: 13, name: 'Laxmi Textiles — monthly', limit: 1000000, state: 'active' },
      { customer: 14, name: 'Om Sai Electronics — on hold', limit: 500000, state: 'held' }].entries()) {
      const debtor = customers[plan.customer]!;
      const made = await attempt(`customer account ${n + 1}`, () => admin.post('/api/v1/customer-accounts', {
        expected_version: 0, debtor_customer_id: debtor.id, shipping_customer_ids: [debtor.id], name: plan.name,
        billing_contact: { name: people[plan.customer]![0], phone: phone(10 + plan.customer).replace(/[ -]/g, ''), authorization_ref: 'DEMO_ATTESTATION' },
        closing_day: 31, due_days: 15, credit_limit_paise: plan.limit, state: plan.state, reason: 'Owner approved monthly terms' }));
      if (made) accountsMade.push({ ...made, debtor });
    }
    // A published price list, so account bookings (priced from rates, not typed in) can be quoted.
    await attempt('price list', async () => {
      const path = `/api/v1/organizations/${org.id}/franchises/${F}/pricing/versions`;
      const rules = ['MUMBAI', 'DELHI', 'BENGALURU', 'HYDERABAD', 'KOLKATA', 'PUNE', 'JAIPUR', 'KOCHI'].flatMap((destination_key, n) =>
        (['standard', 'express'] as const).flatMap(service => [
          { destination_key, service, min_weight_grams: 1, max_weight_grams: 1000, freight_paise: (service === 'express' ? 14000 : 9000) + n * 500, packing_paise: 1500 },
          { destination_key, service, min_weight_grams: 1001, max_weight_grams: null, freight_paise: (service === 'express' ? 22000 : 15000) + n * 700, packing_paise: 2500 }]));
      const draft = await admin.post(path, { effective_from: new Date(Date.now() + 10_000).toISOString(), effective_to: new Date(Date.now() + 365 * 86400_000).toISOString(),
        quote_validity_seconds: 600, override_tolerance_paise: 500, approval_ref: 'DEMO_PRICE_LIST', source_ref: 'DEMO_RATE_CARD', rules });
      await admin.post(`${path}/${draft.id}/publish`, { expected_version: draft.version ?? 1 });
    });
    const firstAccount = accountsMade[0];
    if (firstAccount) {
      await attempt('account rates', () => admin.post(`/api/v1/customer-accounts/${firstAccount.id}/rates`, { expected_version: 0,
        effective_from: new Date(Date.now() + 15_000).toISOString(), effective_to: new Date(Date.now() + 365 * 86400_000).toISOString(), approval_ref: 'DEMO_RATE',
        rules: ['MUMBAI', 'DELHI', 'BENGALURU'].map(destination_key => ({ destination_key, service: 'standard', min_weight_grams: 1, max_weight_grams: null, freight_paise: 9000, packing_paise: 0 })) }));
      // Three bookings on account, priced from the account's own rates.
      await new Promise(resolve => setTimeout(resolve, 17_000)); // rates start in the future, never in the past
      let onAccount = 0;
      for (let i = 0; i < 3; i += 1) {
        const recipient = recipients[[0, 1, 6][i]!]!;
        const pricing = { destination_key: recipient[2], service: 'standard', weight_grams: 1200, customer_account_id: firstAccount.id };
        const made = await attempt(`account booking ${i + 1}`, async () => {
          const quote = await counter.post('/api/v1/pricing/quote', pricing);
          const intentBody = { quote_id: quote.id, pricing_input: pricing, facts: { service_recipient_ref: 'DEMO_BUYER', registration: 'unregistered',
            recipient_state: null, recipient_gstin: null, handover_state: '24', evidence_ref: 'DEMO_HANDOVER', special_case: 'none' } };
          const intent = await counter.post('/api/v1/tax/intents', intentBody);
          const calculation = await counter.post('/api/v1/tax/calculations', { intent_id: intent.id });
          return counter.post('/api/v1/bookings', { customer_id: firstAccount.debtor.id, expected_customer_version: firstAccount.debtor.version, tax_calculation_id: calculation.id,
            tax_intent: intentBody, parcels: [{ weight_grams: 1200, docket: `DEMOAC${i + 1}`, recipient: { name: recipient[0], phone: phone(90 + i), address: recipient[1] } }] });
        });
        if (made) onAccount += 1;
      }
      const first = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()) + '-01';
      const statement = await attempt('account statement', async () => {
        const preview = await admin.post('/api/v1/account-statements/preview', { account_id: firstAccount.id, from_day: first, to_day: day() });
        return admin.post('/api/v1/account-statements', { account_id: firstAccount.id, from_day: first, to_day: day(),
          expected_version: (preview.version ?? 1) - 1, source_digest: preview.source_digest });
      });
      log(`customer accounts: ${accountsMade.length}, bookings on account: ${onAccount}, statements: ${statement ? 1 : 0}`);
    }

    // 9. Cashbook: where cash is kept, an opening float, expenses waiting, approved and rejected.
    const position = async () => (await admin.get('/api/v1/cashbook/position')).source_version;
    const drawer = await attempt('cash drawer', () => admin.post('/api/v1/cashbook/locations', { account_id: accounts.cash.id, expected_account_version: accounts.cash.version,
      custodian_id: staff.counter.id, name: 'Counter drawer', active: true, expected_version: 0 }));
    const bank = await attempt('UPI location', () => admin.post('/api/v1/cashbook/locations', { account_id: accounts.upi.id, expected_account_version: accounts.upi.version,
      custodian_id: null, name: 'Shop UPI account', active: true, expected_version: 0 }));
    let cashRequests = 0;
    if (drawer && bank) {
      const request = (body: Record<string, unknown>, by: Client = counter) => attempt(`cashbook ${body.kind}`, async () => by.post('/api/v1/cashbook/requests', {
        payment_method: null, target_location_id: null, target_revision_id: null, category: null, payee: null, currency: 'INR',
        responsible_employee_id: staff.counter.id, occurred_at: ago(30), expected_source_version: await position(), ...body }));
      const decide = (made: Json | null, decision: 'approved' | 'rejected', reason: string) => made && attempt(`cashbook ${decision}`, () =>
        approver.post(`/api/v1/cashbook/requests/${made.id}/decisions`, { decision, reason, expected_version: made.version ?? 1 }));
      const fromDrawer = { source_location_id: drawer.id, source_revision_id: drawer.revision_id };
      const float = await request({ kind: 'opening_float', ...fromDrawer, amount_paise: 500000, reason: 'Opening cash for the week' }, admin);
      await decide(float, 'approved', 'Counted the float with the operator');
      const expenses = [
        { category: 'supplies', payee: 'Shree Packaging Store', amount_paise: 85000, reason: 'Tape, boxes and bubble wrap' },
        { category: 'transport', payee: 'Local auto rickshaw', amount_paise: 25000, reason: 'Pickup run to Kalupur market' },
        { category: 'utilities', payee: 'Torrent Power', amount_paise: 320000, reason: 'Shop electricity bill' },
        { category: 'maintenance', payee: 'Ramesh Electricals', amount_paise: 60000, reason: 'Fan repair at the counter' },
        { category: 'other', payee: 'Tea stall', amount_paise: 12000, reason: 'Tea for the loading team' },
      ];
      for (const [n, expense] of expenses.entries()) {
        const made = await request({ kind: 'expense', payment_method: 'cash', ...fromDrawer, ...expense });
        if (made) cashRequests += 1;
        if (n === 0 || n === 2) await decide(made, 'approved', 'Bill checked against the receipt');
        if (n === 3) await decide(made, 'rejected', 'No bill attached; resubmit with the invoice');
      }
      const deposit = await request({ kind: 'deposit', ...fromDrawer, target_location_id: bank.id, target_revision_id: bank.revision_id, amount_paise: 200000, reason: 'Evening deposit to the shop account' }, admin);
      if (deposit) cashRequests += 2;
    }
    log(`cashbook: 2 places cash is kept, ${cashRequests} requests (approved, waiting and rejected)`);

    // 10. Agent settlements: fee terms, a cash count and statement per agent, one approved.
    let statements = 0;
    for (const [n, agent] of [staff.agentOne, staff.agentTwo].entries()) {
      const term = await attempt(`fee terms for agent ${n + 1}`, () => admin.post(`/api/v1/agent-settlements/agents/${agent.id}/fee-terms`, { expected_version: 0,
        basis: n === 0 ? 'agreed_period' : 'per_delivery', amount_paise: n === 0 ? 400000 : 3500, currency: 'INR', valid_from: ago(24 * 60),
        valid_until: new Date(Date.now() + 180 * 86400_000).toISOString(), active: true }));
      if (term && n === 0) await attempt('agreed fee earning', () => admin.post('/api/v1/agent-settlements/fee-earnings/agreed', { term_revision_id: term.resource_id ?? term.revision_id ?? term.id }));
      const capture = await attempt(`cash count for agent ${n + 1}`, () => admin.post('/api/v1/agent-settlements/cash-captures', {
        agent_id: agent.id, day: day(), counted_at: ago(20), counted_paise: n === 0 ? 245000 : 118000, reason: 'End of day cash handed over' }));
      if (!capture) continue;
      const submission = await attempt(`statement for agent ${n + 1}`, () => admin.post('/api/v1/agent-settlements/submissions', {
        capture_id: capture.resource_id ?? capture.id, previous_submission_id: null, expected_version: 0, reason: 'Cash, COD and fee statement for today' }));
      if (!submission) continue;
      statements += 1;
      if (n === 0) await attempt('approve statement', () => approver.post(`/api/v1/agent-settlements/submissions/${submission.resource_id ?? submission.id}/decisions`, {
        kind: 'approve', expected_version: submission.version ?? 1, reason: 'Counted cash matches the statement' }));
    }
    await attempt('COD seller', async () => {
      await admin.post('/api/v1/agent-settlements/cod-beneficiaries', { expected_version: 0, name: 'Laxmi Textiles (COD seller)', active: true });
      const list = await admin.get('/api/v1/agent-settlements/finance/beneficiaries');
      const seller = (list.items ?? list.beneficiaries ?? [])[0];
      const target = parcels.find(p => p.booking === unpaid[0]?.id);
      if (seller && target) await admin.post('/api/v1/agent-settlements/cod-obligations', { booking_id: target.booking, parcel_id: target.id, expected_version: 0,
        beneficiary_id: seller.id, beneficiary_revision_id: seller.revision_id, amount_paise: 150000, currency: 'INR', active: true });
    });
    log(`agent settlements: fee terms for 2 agents, ${statements} statements (one approved), a COD seller`);

    // 11. Approvals and refunds: the policy, then discounts and a refund in every state.
    await attempt('approval policy', () => admin.post('/api/v1/finance/policy/revisions', { expected_version: 0, enabled: true, discount_review_threshold_paise: null, allow_self_approval: false }));
    const propose = async (booking: { id: string }, body: Record<string, unknown>) => attempt(`financial ${body.kind}`, async () => {
      const proposal = await counter.get(`/api/v1/finance/bookings/${booking.id}/proposal`);
      return counter.post('/api/v1/finance/requests', { booking_id: booking.id, expected_version: proposal.expected_version ?? proposal.version ?? 0,
        payment_version: proposal.payment_version ?? 0, ...body });
    });
    const decideFinance = (made: Json | null, outcome: 'approved' | 'rejected') => made && attempt(`financial ${outcome}`, () =>
      approver.post(`/api/v1/finance/requests/${made.id}/decisions`, { expected_version: made.version ?? 0, outcome }));
    let financial = 0;
    const discountA = await propose(unpaid[0]!, { kind: 'discount', reason: 'customer_agreement', pre_tax: 2000, taxable: 2000 }); if (discountA) financial += 1;
    const discountB = await propose(unpaid[1]!, { kind: 'discount', reason: 'service_recovery', pre_tax: 1500, taxable: 1500 }); if (discountB) financial += 1;
    const correction = await propose(unpaid[2]!, { kind: 'correction', reason: 'incorrect_charge', pre_tax: 1000, taxable: 1000 }); if (correction) financial += 1;
    const approved = await decideFinance(discountB, 'approved');
    if (approved) await attempt('apply discount', () => admin.post(`/api/v1/finance/requests/${discountB!.id}/apply`, { expected_version: (discountB!.version ?? 0) + 1 }));
    await decideFinance(correction, 'rejected');
    log(`approvals and refunds: policy on, ${financial} requests (waiting, approved and applied, rejected)`);

    // 12. An advance: money taken before any booking, part of it asked back and approved.
    await attempt('advance and refund', async () => {
      const advance = await counter.post('/api/v1/money-receipts', { customer_id: customers[3]!.id, account_id: accounts.upi.id, expected_account_version: accounts.upi.version,
        method: 'upi', amount_paise: 100000, currency: 'INR', receiver_id: staff.counter.id, custodian_id: staff.counter.id, occurred_at: ago(90),
        external_reference: 'DEMO-UPI-ADVANCE', allocations: [] });
      const receipt = advance.receipt_id ?? advance.id;
      const ask = await admin.post(`/api/v1/money-receipts/${receipt}/advance-refunds`, { expected_receipt_version: 1, amount_paise: 40000, reason: 'Customer cancelled the second shipment' });
      await approver.post(`/api/v1/money-receipts/${receipt}/advance-refunds/${ask.id ?? ask.request_id}/approve`, { expected_version: ask.version ?? 1, reason: 'Checked the cancelled shipment' });
    });
    log('advance payment with a refund approved');

    // 13. Shipment costs and e-way bills on a few bookings.
    let costs = 0, eways = 0;
    for (const [n, booking] of bookings.slice(0, 4).entries()) {
      const made = await attempt('shipment cost', () => admin.post('/api/v1/shipment-costs', { source_id: null, expected_version: 0, category: ['courier', 'packing', 'agent', 'payment'][n],
        state: 'actual', amount_paise: [6000, 1500, 2500, 800][n], effective_at: ago(120), reason: 'Supplier invoice', reference: `DEMO-INV-${n + 1}`,
        supplier: ['Blue Line Couriers', 'Shree Packaging Store', 'Demo agent fees', 'UPI gateway'][n], document: randomUUID(), line: '1',
        expense_id: null, rate_import_id: null, rate_booking_id: null, allocations: [{ booking_id: booking.id, parcel_id: null, amount_paise: [6000, 1500, 2500, 800][n] }] }));
      if (made) costs += 1;
    }
    for (const [n, booking] of bookings.slice(4, 7).entries()) {
      const made = await attempt('e-way bill', () => counter.post(`/api/v1/bookings/${booking.id}/eway`, {
        declaration: { value_paise: [7500000, 5200000, 12000000][n], source_ref: 'DEMO_DECLARATION' },
        external: { issuer: 'NIC_EWAY_PORTAL', reference: `DEMO-EWB-${1001 + n}`, source_ref: 'DEMO_SOURCE', issued_at: ago(60),
          official_valid_until: new Date(Date.now() + 2 * 86400_000).toISOString(), validity_evidence_ref: 'DEMO_EVIDENCE' },
        vehicle_number: 'GJ01AB4521', distance_km: [530, 940, 1210][n] }));
      if (made) eways += 1;
    }
    log(`shipment costs: ${costs}, e-way bills: ${eways}`);

    // 14. Deliveries: hand a few checked-in parcels to an agent; one attempt fails. (Completing a
    // delivery needs the customer's WhatsApp code, so none are marked delivered.)
    let started = 0, failed = 0;
    const agentClient = await as('agentOne');
    for (const [n, parcel] of waiting.slice(-4).entries()) {
      const run = await attempt('delivery start', () => admin.post(`/api/v1/deliveries/${parcel.id}/start`, {
        expected_version: parcel.version, agent_id: staff.agentOne.id, handover_evidence_ref: randomUUID() }));
      if (!run) break;
      started += 1; parcel.version = run.version ?? parcel.version + 1;
      if (n === 0) {
        const r = await attempt('failed attempt', () => agentClient.post(`/api/v1/parcels/${parcel.id}/failed-attempt`, {
          expected_version: parcel.version, evidence_ref: randomUUID(), attempt_id: run.attempt_id, reason_code: 'customer_unavailable' }));
        if (r) failed += 1;
      }
    }
    log(started ? `deliveries: ${started} out with an agent, ${failed} failed attempt` : 'deliveries: skipped (delivery proof is not configured locally)');
    void approver;
    console.log(`\nDone. Switch the Franchise picker to "${DEMO_NAME}" in the app. Remove it all with: pnpm demo:remove`);
  } finally {
    // The demo staff keep no live session.
    for (const id of sessions) await owner.query('UPDATE shipit.auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL', [id]).catch(() => {});
    await runtime.close(); await owner.close();
  }
}

const command = process.argv[2];
try {
  if (command === 'seed') await seed();
  else if (command === 'remove') await remove();
  else { console.error('Use: pnpm demo:seed | pnpm demo:remove'); process.exitCode = 2; }
} catch (error) {
  console.error(`demo ${command} failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
