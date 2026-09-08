import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createActorFixture, createEventFixture, createIdempotencyScenarios,
  createParcelFixture, createRouteLotReferences, createTenantIsolationFixture, fixtureId, replayFixture, roles } from './index.ts';

await test('canonical serialization is repeatable and independent of mutations', () => {
  const first = createTenantIsolationFixture();
  const expected = JSON.stringify(first);
  assert.equal(JSON.stringify(createTenantIsolationFixture()), expected);
  first.shipments.alpha1.customer.name = 'Changed fictional label';
  assert.equal(JSON.stringify(createTenantIsolationFixture()), expected);
});
await test('two organizations and three franchises express own, sibling and unrelated scopes', () => {
  const { organizations, franchises, scenarios } = createTenantIsolationFixture();
  assert.equal(Object.keys(organizations).length, 2);
  assert.equal(Object.keys(franchises).length, 3);
  assert.equal(scenarios.own.actor.franchise_id, scenarios.own.resource.franchise_id);
  assert.equal(scenarios.sibling.actor.organization_id, scenarios.sibling.resource.organization_id);
  assert.notEqual(scenarios.sibling.actor.franchise_id, scenarios.sibling.resource.franchise_id);
  assert.notEqual(scenarios.foreign.actor.organization_id, scenarios.foreign.resource.organization_id);
  assert.equal(scenarios.sibling.expectation, 'deny_without_exact_approved_scope');
  assert.equal(scenarios.foreign.expectation, 'deny');
});
await test('canonical entity IDs are valid, unique and reusable for foreign IDOR requests', () => {
  const f = createTenantIsolationFixture();
  const entities = [...Object.values(f.organizations), ...Object.values(f.franchises), ...Object.values(f.actors),
    ...Object.values(f.shipments).flatMap(s => [s.customer, s.booking, s.parcel])];
  assert.equal(new Set(entities.map(e => e.id)).size, entities.length);
  for (const entity of entities) assert.match(entity.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  const request = { method: 'GET', url: `/api/v1/parcels/${f.scenarios.foreign.resource.id}` };
  assert.equal(request.url, `/api/v1/parcels/${f.shipments.beta1.parcel.id}`);
  assert.equal(f.scenarios.foreign.resource.id, createTenantIsolationFixture().scenarios.foreign.resource.id);
});
await test('actors expose exactly the accepted seven roles and explicit membership scope', () => {
  const f = createTenantIsolationFixture();
  const contract = readFileSync(new URL('../../../docs/architecture/authorization-contract.md', import.meta.url), 'utf8');
  const header = contract.split('\n').find(line => line.startsWith('| ID | Resource /'))!;
  assert.deepEqual([...roles], header.split('|').slice(3, -1).map(cell => cell.trim()));
  assert.deepEqual([...new Set(Object.values(f.actors).map(a => a.role))].sort(), [...roles].sort());
  assert.equal(f.actors.alphaOrgAdmin.franchise_id, null);
  assert.equal(f.actors.alpha2Operator.franchise_id, f.franchises.alpha2.id);
  assert.throws(() => createActorFixture(f.organizations.alpha, f.franchises.beta1), /OWNERSHIP_MISMATCH/);
  assert.throws(() => createActorFixture(f.organizations.alpha, null), /ROLE_SCOPE_MISMATCH/);
});
await test('composable shipments inherit ownership; targeted overrides preserve parent links', () => {
  const f = createTenantIsolationFixture();
  for (const shipment of Object.values(f.shipments)) {
    assert.equal(shipment.booking.customer_id, shipment.customer.id);
    assert.equal(shipment.parcel.booking_id, shipment.booking.id);
    assert.equal(shipment.parcel.franchise_id, shipment.customer.franchise_id);
  }
  const parcel = createParcelFixture(f.shipments.alpha1.booking, { id: fixtureId(504), docket: 'SYN-SHIPIT-000504' });
  assert.equal(parcel.booking_id, f.shipments.alpha1.booking.id);
  assert.notEqual(parcel.id, f.shipments.alpha1.parcel.id);
  assert.equal(createRouteLotReferences(f.franchises.alpha2).franchise_id, f.franchises.alpha2.id);
  assert.throws(() => fixtureId(NaN), /OUT_OF_RANGE/);
});
await test('event envelope follows accepted parcel.booked catalog and duplicate replay preserves all bytes', () => {
  const event = createEventFixture();
  assert.deepEqual(Object.keys(event).sort(), ['event_id', 'event_type', 'schema_version', 'organization_id', 'franchise_id',
    'aggregate_type', 'aggregate_id', 'aggregate_version', 'occurred_at', 'actor', 'correlation_id', 'causation_id', 'command_id', 'payload'].sort());
  assert.equal(event.event_type, 'parcel.booked');
  assert.deepEqual(event.payload, { booking_id: createTenantIsolationFixture().shipments.alpha1.booking.id });
  assert.equal(event.causation_id, event.command_id);
  assert.equal(JSON.stringify(replayFixture(event)), JSON.stringify(event));
  assert.equal(createEventFixture(undefined, { schema_version: 99 }).schema_version, 99);
});
await test('idempotency same-scope replay and changed intent differ only in fingerprint', () => {
  const { original, replay, changedIntent } = createIdempotencyScenarios();
  assert.deepEqual(replay, original);
  assert.deepEqual({ ...changedIntent, request_fingerprint: original.request_fingerprint }, original);
  assert.notEqual(changedIntent.request_fingerprint, original.request_fingerprint);
});
