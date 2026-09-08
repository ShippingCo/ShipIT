// Contract-sized test representations, not database rows or public API DTOs.
export const roles = ['org_admin', 'franchise_admin', 'operator', 'dispatcher',
  'delivery_agent', 'accountant', 'read_only'] as const;
export type Role = typeof roles[number];
export const fixtureInstant = '2026-09-08T12:00:00Z';

export function fixtureId(serial: number): string {
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > 999999999999) {
    throw new Error('FIXTURE_ID_OUT_OF_RANGE');
  }
  return `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`;
}
export interface Organization { id: string; name: string }
export interface Scope { organization_id: string; franchise_id: string }
export interface Franchise { id: string; organization_id: string; name: string }
export interface Actor { id: string; membership_id: string; organization_id: string; franchise_id: string | null; role: Role }
export interface Customer extends Scope { id: string; name: string; contact_ref: string }
export interface Booking extends Scope { id: string; customer_id: string; version: number }
export interface Parcel extends Scope { id: string; booking_id: string; docket: string; version: number }

export function createOrganizationFixture(overrides: Partial<Organization> = {}): Organization {
  return { id: fixtureId(1), name: 'Organization Alpha', ...overrides };
}
export function createFranchiseFixture(organization = createOrganizationFixture(), overrides: Partial<Omit<Franchise, 'organization_id'>> = {}): Franchise {
  return { id: fixtureId(11), name: 'Franchise Alpha-1', ...overrides, organization_id: organization.id };
}
export function scopeOf(franchise: Franchise): Scope {
  return { organization_id: franchise.organization_id, franchise_id: franchise.id };
}
export function createActorFixture(organization = createOrganizationFixture(), franchise: Franchise | null = createFranchiseFixture(organization), overrides: Partial<Pick<Actor, 'id' | 'membership_id' | 'role'>> = {}): Actor {
  const role = overrides.role ?? 'operator';
  if (!roles.includes(role)) throw new Error('FIXTURE_UNKNOWN_ROLE');
  if (franchise && franchise.organization_id !== organization.id) throw new Error('FIXTURE_OWNERSHIP_MISMATCH');
  if ((role === 'org_admin') !== (franchise === null)) throw new Error('FIXTURE_ROLE_SCOPE_MISMATCH');
  return { id: fixtureId(101), membership_id: fixtureId(201), ...overrides,
    organization_id: organization.id, franchise_id: franchise?.id ?? null, role };
}
export function createCustomerFixture(franchise = createFranchiseFixture(), overrides: Partial<Pick<Customer, 'id' | 'name' | 'contact_ref'>> = {}): Customer {
  return { id: fixtureId(301), name: 'Fictional Customer Alpha-1', contact_ref: 'contact_synthetic_alpha1', ...overrides, ...scopeOf(franchise) };
}
export function createBookingFixture(customer = createCustomerFixture(), overrides: Partial<Pick<Booking, 'id' | 'version'>> = {}): Booking {
  return { id: fixtureId(401), version: 1, ...overrides, customer_id: customer.id,
    organization_id: customer.organization_id, franchise_id: customer.franchise_id };
}
export function createParcelFixture(booking = createBookingFixture(), overrides: Partial<Pick<Parcel, 'id' | 'docket' | 'version'>> = {}): Parcel {
  return { id: fixtureId(501), docket: 'SYN-SHIPIT-000501', version: 1, ...overrides,
    booking_id: booking.id, organization_id: booking.organization_id, franchise_id: booking.franchise_id };
}
export function createRouteLotReferences(franchise = createFranchiseFixture(), serial = 1) {
  return { ...scopeOf(franchise), route_id: fixtureId(600 + serial), lot_id: fixtureId(700 + serial) };
}

export function createTenantIsolationFixture() {
  const alpha = createOrganizationFixture();
  const beta = createOrganizationFixture({ id: fixtureId(2), name: 'Organization Beta' });
  const alpha1 = createFranchiseFixture(alpha);
  const alpha2 = createFranchiseFixture(alpha, { id: fixtureId(12), name: 'Franchise Alpha-2' });
  const beta1 = createFranchiseFixture(beta, { id: fixtureId(21), name: 'Franchise Beta-1' });
  const actor = (role: Role, serial: number, franchise: Franchise | null = alpha1, organization = alpha) =>
    createActorFixture(organization, franchise, { role, id: fixtureId(100 + serial), membership_id: fixtureId(200 + serial) });
  const actors = {
    alphaOrgAdmin: actor('org_admin', 1, null),
    alpha1FranchiseAdmin: actor('franchise_admin', 2), alpha1Operator: actor('operator', 3),
    alpha1Dispatcher: actor('dispatcher', 4), alpha1DeliveryAgent: actor('delivery_agent', 5),
    alpha1Accountant: actor('accountant', 6), alpha1ReadOnly: actor('read_only', 7),
    alpha2Operator: actor('operator', 8, alpha2), beta1Operator: actor('operator', 9, beta1, beta),
  };
  const shipment = (franchise: Franchise, serial: number) => {
    const customer = createCustomerFixture(franchise, { id: fixtureId(300 + serial),
      name: `Fictional Customer ${franchise.name}`, contact_ref: `contact_synthetic_${serial}` });
    const booking = createBookingFixture(customer, { id: fixtureId(400 + serial) });
    const parcel = createParcelFixture(booking, { id: fixtureId(500 + serial), docket: `SYN-SHIPIT-000${500 + serial}` });
    return { customer, booking, parcel };
  };
  const shipments = { alpha1: shipment(alpha1, 1), alpha2: shipment(alpha2, 2), beta1: shipment(beta1, 3) };
  // These label relationships/expectations only; they do not implement authorization.
  const scenarios = {
    own: { actor: actors.alpha1Operator, resource: shipments.alpha1.parcel, expectation: 'role_action_matrix' },
    sibling: { actor: actors.alpha1Operator, resource: shipments.alpha2.parcel, expectation: 'deny_without_exact_approved_scope' },
    foreign: { actor: actors.alpha1Operator, resource: shipments.beta1.parcel, expectation: 'deny' },
  };
  return { organizations: { alpha, beta }, franchises: { alpha1, alpha2, beta1 }, actors, shipments, scenarios };
}

export function createEventFixture(parcel = createParcelFixture(), overrides: Partial<{
  event_id: string; aggregate_version: number; schema_version: number; occurred_at: string;
}> = {}) {
  // A single accepted catalog fact; feature owners add typed catalog-specific builders.
  return { event_id: 'evt_synthetic_booked_01', event_type: 'parcel.booked', schema_version: 1,
    organization_id: parcel.organization_id, franchise_id: parcel.franchise_id,
    aggregate_type: 'parcel', aggregate_id: parcel.id, aggregate_version: parcel.version,
    occurred_at: fixtureInstant, actor: { type: 'service', id: 'svc_synthetic_bookings' },
    correlation_id: 'cor_synthetic_01', causation_id: 'cmd_synthetic_01', command_id: 'cmd_synthetic_01',
    payload: { booking_id: parcel.booking_id }, ...overrides };
}
export function replayFixture<T>(fixture: T): T { return structuredClone(fixture); }

export function createIdempotencyFixture(actor = createTenantIsolationFixture().actors.alpha1Operator,
  overrides: Partial<{ idempotency_key: string; request_fingerprint: string; operation_id: string }> = {}) {
  return { principal_type: 'user', principal_id: actor.id, organization_id: actor.organization_id,
    franchise_id_or_null: actor.franchise_id, operation_id: 'api.v1.bookings.create',
    idempotency_key: 'key_synthetic_01', request_fingerprint: 'fingerprint_synthetic_same_intent',
    normalization_version: 1, command_id: 'cmd_synthetic_01', ...overrides };
}
export function createIdempotencyScenarios() {
  const original = createIdempotencyFixture();
  return { original, replay: replayFixture(original), changedIntent: { ...original,
    request_fingerprint: 'fingerprint_synthetic_different_intent' } };
}
