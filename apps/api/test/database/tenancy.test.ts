import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import { fixtureId } from '@shippingco/testkit';
import { provisionDatabase, type DisposableDatabase } from '../../../../packages/db/test/support.ts';
import { createTenancyService } from '../../src/modules/tenancy/service.ts';
import { TenancyError } from '../../src/modules/tenancy/errors.ts';
import { tenancyTransaction } from '../../src/modules/tenancy/transaction.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import type { TransactionExecutor } from '@shippingco/db';
import { lockActiveFranchiseForOperationalWrite } from '../../src/modules/tenancy/repository.ts';
import type { TenancyAuditFact, FranchiseDto, OrganizationDto } from '../../src/modules/tenancy/types.ts';
import { approvedAuthority, seedTenancy, tenancyFixture as f, testTenancyServer, unknownTenantId } from '../tenancy-support.ts';

const alphaId = f.organizations.alpha.id, alpha1Id = f.franchises.alpha1.id;
const scoped = { organizationId: alphaId, franchiseId: alpha1Id };
const disable = { lifecycle: 'disabled', expected_version: 1, reason_code: 'administrative_disable' };
const noAudit = { record: async () => {} };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function hasCode(code: string) { return (error: unknown) => error instanceof TenancyError && error.code === code; }
function captureAudit() {
  const facts: Readonly<TenancyAuditFact>[] = [];
  return { facts, audit: { record: async (fact: Readonly<TenancyAuditFact>) => { facts.push(fact); } } };
}
async function fixture(database: DisposableDatabase) {
  await database.prepareTenancy();
  const pool = database.runtimePool(); await seedTenancy(pool); return pool;
}
async function waitForBlocked(database: DisposableDatabase, blockingPid: number) {
  const until = performance.now() + 2200;
  while (performance.now() < until) {
    const result = await database.adminQuery<{ blocked: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND wait_event_type = 'Lock' AND $1::integer = ANY(pg_blocking_pids(pid))) AS blocked`, [blockingPid]);
    if (result.rows[0]?.blocked) return;
    await delay(10);
  }
  assert.fail('Expected a real PostgreSQL lock wait');
}

await test('standalone bootstrap and multiple franchises persist across real API/pool restart', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t); await database.prepareTenancy();
  let stored!: { organization: OrganizationDto; franchise: FranchiseDto };
  const { facts, audit } = captureAudit();
  for (const iteration of [0, 1]) {
    const pool = database.runtimePool();
    const authorizer = approvedAuthority(iteration === 0 ? null : stored.organization.id,
      iteration === 0 ? [] : [stored.franchise.id], 'service');
    const { app, service, logs } = testTenancyServer(pool, authorizer, audit);
    try {
      if (iteration === 0) {
        const response = await app.inject({ method: 'POST', url: '/test/tenancy/bootstrap', payload: {
          display_name: 'Synthetic Independent Shop', franchise: { display_name: 'Synthetic First Shop', franchise_code: 'MAIN' },
        } });
        assert.equal(response.statusCode, 200); stored = response.json();
        assert.equal(stored.franchise.organization_id, stored.organization.id);
        assert.equal(stored.organization.lifecycle, 'active'); assert.equal(stored.franchise.version, 1);
        const count = await pool.query<{ total: string }>('SELECT count(*) AS total FROM shipit.franchises WHERE organization_id=$1', [stored.organization.id]);
        assert.equal(count.rows[0]?.total, '1');
        assert.match(stored.organization.id, /^[0-9a-f-]{36}$/);
      } else {
        assert.deepEqual(await service.readOrganization(), stored.organization);
        assert.deepEqual(await service.readFranchise(stored.franchise.id), stored.franchise);
        const second = await service.createFranchise({ display_name: 'Synthetic Second Shop', franchise_code: 'SECOND' });
        assert.equal(second.organization_id, stored.organization.id); assert.notEqual(second.id, stored.franchise.id);
        const count = await pool.query<{ total: string }>('SELECT count(*) AS total FROM shipit.franchises WHERE organization_id=$1', [stored.organization.id]);
        assert.equal(count.rows[0]?.total, '2');
      }
      assert.doesNotMatch(logs.join(''), /Synthetic Independent|Synthetic First|postgres(?:ql)?:\/\/|password/i);
    } finally { await app.close(); await pool.close(); }
    assert.deepEqual(pool.stats(), { total: 0, idle: 0, waiting: 0 });
  }
  assert.ok(facts.length >= 2); assert.doesNotMatch(JSON.stringify(facts), /display_name|Synthetic|franchise_code/);
});

await test('private reads and mutations uniformly conceal sibling, foreign and unknown valid IDs', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const { app, service, logs } = testTenancyServer(pool, approvedAuthority(), audit);
  try {
    const own = await app.inject(`/test/tenancy/franchises/${alpha1Id}`);
    assert.equal(own.statusCode, 200); assert.equal(own.json().organization_id, alphaId);
    assert.deepEqual(Object.keys(own.json()).sort(), ['id', 'organization_id', 'franchise_code', 'display_name',
      'lifecycle', 'version', 'created_at', 'updated_at', 'lifecycle_changed_at'].sort());
    assert.equal((await service.readOrganization()).id, alphaId);
    for (const id of [f.franchises.alpha2.id, f.franchises.beta1.id, unknownTenantId]) {
      for (const request of [
        { method: 'GET' as const, url: `/test/tenancy/franchises/${id}` },
        { method: 'PATCH' as const, url: `/test/tenancy/franchises/${id}`, payload: { display_name: 'Synthetic Denied Change', expected_version: 900 } },
        { method: 'POST' as const, url: `/test/tenancy/franchises/${id}/lifecycle`, payload: disable },
      ]) {
        const response = await app.inject(request);
        assert.equal(response.statusCode, 404); assert.equal(response.json().error.code, 'RESOURCE_NOT_FOUND');
        assert.doesNotMatch(response.body, /Alpha-2|Beta|version|franchise_code|constraint/);
      }
    }
    // Even an erroneous trusted grant containing a foreign franchise cannot defeat the SQL organization predicate.
    const erroneousGrant = createTenancyService({ database: pool, authorizer: approvedAuthority(alphaId, [f.franchises.beta1.id]), audit });
    await assert.rejects(erroneousGrant.readFranchise(f.franchises.beta1.id), hasCode('RESOURCE_NOT_FOUND'));
    const rows = await pool.query<{ id: string; version: number; lifecycle: string }>('SELECT id,version,lifecycle FROM shipit.franchises ORDER BY id');
    assert.equal(rows.rows.length, 3); assert.ok(rows.rows.every(row => row.version === 1 && row.lifecycle === 'active'));
    assert.equal(facts.length, 0); assert.doesNotMatch(logs.join(''), /Synthetic Denied|Alpha-2|Beta|postgres(?:ql)?:\/\//);
  } finally { await app.close(); }
});

await test('permitted list pages scope before has_more and cannot widen through client filters or boundaries', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const single = createTenancyService({ database: pool, authorizer: approvedAuthority(), audit: noAudit });
  const own = await single.listFranchises({ limit: 1 });
  assert.deepEqual(own.items.map(item => item.id), [alpha1Id]);
  assert.deepEqual(own.page, { has_more: false, next_boundary: null });
  const multi = createTenancyService({ database: pool, authorizer: approvedAuthority(alphaId,
    [alpha1Id, f.franchises.alpha2.id, f.franchises.beta1.id]), audit: noAudit });
  const first = await multi.listFranchises({ limit: 1 });
  assert.deepEqual(first.items.map(item => item.id), [alpha1Id]); assert.equal(first.page.has_more, true);
  assert.ok(first.page.next_boundary);
  const second = await multi.listFranchises({ limit: 1, after: first.page.next_boundary });
  assert.deepEqual(second.items.map(item => item.id), [f.franchises.alpha2.id]);
  assert.deepEqual(second.page, { has_more: false, next_boundary: null });
  const empty = createTenancyService({ database: pool, authorizer: approvedAuthority(alphaId, []), audit: noAudit });
  assert.deepEqual(await empty.listFranchises(), { items: [], page: { has_more: false, next_boundary: null } });
  await assert.rejects(single.listFranchises({ after: { created_at: '1970-01-01T00:00:00Z', id: f.franchises.beta1.id } }), hasCode('VALIDATION_FAILED'));
  const beta = createTenancyService({ database: pool, authorizer: approvedAuthority(f.organizations.beta.id, [f.franchises.beta1.id]), audit: noAudit });
  const betaPage = await beta.listFranchises({ limit: 1 });
  assert.deepEqual(betaPage.items.map(item => item.id), [f.franchises.beta1.id]);
  assert.deepEqual(betaPage.page, { has_more: false, next_boundary: null });
  for (const input of [{ organization_id: f.organizations.beta.id }, { franchise_id: f.franchises.beta1.id },
    { permittedFranchiseIds: [f.franchises.beta1.id] }, { role: 'org_admin' }, { limit: 101 },
    { after: { created_at: 'not-an-instant', id: f.franchises.beta1.id } }]) {
    await assert.rejects(single.listFranchises(input), hasCode('VALIDATION_FAILED'));
  }
});

await test('strict mass-assignment rejection leaves ownership, immutable fields, lifecycle and audit unchanged', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const { app, service } = testTenancyServer(pool, approvedAuthority(), audit);
  const initial = await service.readFranchise(alpha1Id);
  try {
    for (const extra of [{ organization_id: f.organizations.beta.id }, { id: unknownTenantId }, { franchise_code: 'REPLACED' },
      { lifecycle: 'disabled' }, { version: 100 }, { created_at: '1970-01-01T00:00:00.000Z' },
      { updated_at: '1970-01-01T00:00:00.000Z' }, { settings: { role: 'org_admin' } }]) {
      const response = await app.inject({ method: 'PATCH', url: `/test/tenancy/franchises/${alpha1Id}`,
        payload: { display_name: 'Synthetic Rejected', expected_version: 1, ...extra } });
      assert.equal(response.statusCode, 422); assert.equal(response.json().error.code, 'VALIDATION_FAILED');
    }
    assert.deepEqual(await service.readFranchise(alpha1Id), initial); assert.equal(facts.length, 0);
  } finally { await app.close(); }
});

await test('concurrent duplicate codes produce exactly one committed franchise and one safe conflict', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const { app } = testTenancyServer(pool, approvedAuthority(alphaId, [], 'service'), audit);
  try {
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: '/test/tenancy/franchises',
      payload: { display_name: 'Synthetic Concurrent Franchise', franchise_code: 'CONCURRENT' } })));
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
    const rejected = results.find(result => result.statusCode === 409)!;
    assert.equal(rejected.json().error.code, 'FRANCHISE_CODE_CONFLICT');
    assert.doesNotMatch(rejected.body, /constraint|shipit|postgres|SQL|CONCURRENT/);
    const count = await pool.query<{ total: string }>('SELECT count(*) AS total FROM shipit.franchises WHERE organization_id=$1 AND franchise_code=$2', [alphaId, 'CONCURRENT']);
    assert.equal(count.rows[0]?.total, '1'); assert.equal(facts.length, 1);
  } finally { await app.close(); }
});

await test('concurrent versions reject the loser without lost update or false audit success', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const { app, service } = testTenancyServer(pool, approvedAuthority(), audit);
  try {
    const results = await Promise.all(['Synthetic Version A', 'Synthetic Version B'].map(display_name =>
      app.inject({ method: 'PATCH', url: `/test/tenancy/franchises/${alpha1Id}`, payload: { display_name, expected_version: 1 } })));
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
    assert.equal(results.find(result => result.statusCode === 409)!.json().error.code, 'VERSION_CONFLICT');
    const winner = results.find(result => result.statusCode === 200)!.json<FranchiseDto>();
    assert.equal(winner.version, 2); assert.deepEqual(await service.readFranchise(alpha1Id), winner);
    assert.equal(facts.length, 1); assert.equal(facts[0]?.committed_version, 2);
    await assert.rejects(service.changeFranchiseLifecycle(alpha1Id, disable), hasCode('VERSION_CONFLICT'));
    assert.equal(facts.length, 1); assert.deepEqual(await service.readFranchise(alpha1Id), winner);
  } finally { await app.close(); }
});

await test('disable preserves authorized history, denies new operational writes and permits explicit recovery', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const service = createTenancyService({ database: pool, authorizer: approvedAuthority(), audit });
  const initial = await service.readFranchise(alpha1Id);
  await tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped));
  for (const franchiseId of [f.franchises.beta1.id, unknownTenantId]) {
    await assert.rejects(tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), { organizationId: alphaId, franchiseId })), hasCode('RESOURCE_NOT_FOUND'));
  }
  const disabled = await service.changeFranchiseLifecycle(alpha1Id, disable);
  assert.equal(disabled.id, initial.id); assert.equal(disabled.organization_id, initial.organization_id);
  assert.equal(disabled.lifecycle, 'disabled'); assert.equal(disabled.version, 2);
  assert.equal((await service.readFranchise(alpha1Id)).lifecycle, 'disabled');
  assert.equal((await service.listFranchises()).items[0]?.lifecycle, 'disabled');
  await assert.rejects(service.updateFranchiseProfile(alpha1Id, { display_name: 'Synthetic Disabled Change', expected_version: 2 }), hasCode('FRANCHISE_DISABLED'));
  for (const bypass of [{ organization_id: f.organizations.beta.id }, { lifecycle: 'active' }]) {
    await assert.rejects(service.updateFranchiseProfile(alpha1Id, { display_name: 'Synthetic Disabled Bypass', expected_version: 2, ...bypass }), hasCode('VALIDATION_FAILED'));
  }
  assert.deepEqual(await service.readFranchise(alpha1Id), disabled); assert.equal(facts.length, 1);
  await assert.rejects(tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped)), hasCode('FRANCHISE_DISABLED'));
  const sibling = createTenancyService({ database: pool, authorizer: approvedAuthority(alphaId, [f.franchises.alpha2.id]), audit });
  await assert.rejects(sibling.readFranchise(alpha1Id), hasCode('RESOURCE_NOT_FOUND'));
  const repeated = await service.changeFranchiseLifecycle(alpha1Id, { ...disable, expected_version: 2 });
  assert.deepEqual(repeated, disabled); assert.equal(facts.length, 1);
  const active = await service.changeFranchiseLifecycle(alpha1Id, { lifecycle: 'active', expected_version: 2, reason_code: 'administrative_reactivate' });
  assert.equal(active.version, 3); assert.equal(active.lifecycle, 'active');
  await tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped));
  assert.equal(facts.length, 2); assert.equal(facts[0]?.reason_code, 'administrative_disable');
  assert.equal(facts[1]?.reason_code, 'administrative_reactivate');
  assert.doesNotMatch(JSON.stringify(facts), /display_name|franchise_code|Franchise Alpha/);
});

await test('active write locks first: disable waits for the operational transaction to commit', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  await database.prepareFixtures();
  const probeId = fixtureId(8301);
  const entered = deferred(), release = deferred(); let blockingPid = 0;
  const order: string[] = [];
  const write = tenancyTransaction(pool, async tx => {
    blockingPid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped); entered.resolve();
    await release.promise;
    await tx.query('INSERT INTO synthetic.fixture (id,label) VALUES ($1,$2)', [probeId, 'synthetic_operational_write']);
    order.push('write-completes');
  });
  await entered.promise;
  const service = createTenancyService({ database: pool, authorizer: approvedAuthority(),
    audit: { record: async () => {
      const probe = await pool.query<{ label: string }>('SELECT label FROM synthetic.fixture WHERE id=$1', [probeId]);
      assert.equal(probe.rows[0]?.label, 'synthetic_operational_write');
      order.push('disable-committed');
    } } });
  const pendingDisable = service.changeFranchiseLifecycle(alpha1Id, disable);
  try {
    await waitForBlocked(database, blockingPid); assert.deepEqual(order, []);
    release.resolve(); await write; await pendingDisable;
    assert.deepEqual(order, ['write-completes', 'disable-committed']);
    await assert.rejects(tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped)), hasCode('FRANCHISE_DISABLED'));
  } finally { release.resolve(); await Promise.allSettled([write, pendingDisable]); }
});

await test('disable locks first: blocked and subsequently started operational guards reject after its commit', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  await database.prepareFixtures();
  const operationalWrite = (id: string) => tenancyTransaction(pool, async tx => {
    await lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped);
    await tx.query('INSERT INTO synthetic.fixture (id,label) VALUES ($1,$2)', [id, 'synthetic_forbidden_operational_write']);
  });
  const commitEntered = deferred(), releaseCommit = deferred(); let blockingPid = 0;
  const heldCommit: DatabasePool = { ...pool, async connect() {
    const client = await pool.connect();
    blockingPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    return { release: discard => client.release(discard), async query<Row extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      if (sql === 'COMMIT') { commitEntered.resolve(); await releaseCommit.promise; }
      return client.query<Row>(sql, params);
    } };
  } };
  const { facts, audit } = captureAudit();
  const service = createTenancyService({ database: heldCommit, authorizer: approvedAuthority(), audit });
  const pendingDisable = service.changeFranchiseLifecycle(alpha1Id, disable);
  await commitEntered.promise;
  const blockedGuard = operationalWrite(fixtureId(8302));
  const blockedRejection = assert.rejects(blockedGuard, hasCode('FRANCHISE_DISABLED'));
  try {
    await waitForBlocked(database, blockingPid); assert.equal(facts.length, 0);
    releaseCommit.resolve(); await pendingDisable; await blockedRejection;
    assert.equal(facts.length, 1);
    await assert.rejects(operationalWrite(fixtureId(8303)), hasCode('FRANCHISE_DISABLED'));
    const probes = await pool.query<{ total: string }>('SELECT count(*) AS total FROM synthetic.fixture');
    assert.equal(probes.rows[0]?.total, '0');
  } finally { releaseCommit.resolve(); await Promise.allSettled([pendingDisable, blockedRejection]); }
});

await test('organization administration is service-only and disabling it gates active franchise operations', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const member = createTenancyService({ database: pool, authorizer: approvedAuthority(alphaId, [alpha1Id, f.franchises.alpha2.id]), audit });
  await assert.rejects(member.updateOrganizationProfile({ display_name: 'Synthetic Denied Organization', expected_version: 1 }), hasCode('ACTION_FORBIDDEN'));
  await assert.rejects(member.changeOrganizationLifecycle(disable), hasCode('ACTION_FORBIDDEN'));
  const service = createTenancyService({ database: pool, authorizer: approvedAuthority(alphaId, [], 'service'), audit });
  const changed = await service.updateOrganizationProfile({ display_name: 'Synthetic Renamed Organization', expected_version: 1 });
  assert.equal(changed.version, 2);
  await assert.rejects(service.updateOrganizationProfile({ display_name: 'Synthetic Stale Organization', expected_version: 1 }), hasCode('VERSION_CONFLICT'));
  const disabled = await service.changeOrganizationLifecycle({ ...disable, expected_version: 2 });
  assert.equal(disabled.version, 3); assert.equal((await member.readOrganization()).lifecycle, 'disabled');
  assert.equal((await member.readFranchise(alpha1Id)).lifecycle, 'active');
  await assert.rejects(tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped)), hasCode('ORGANIZATION_DISABLED'));
  await assert.rejects(service.createFranchise({ display_name: 'Synthetic Denied Creation', franchise_code: 'DENIED' }), hasCode('ORGANIZATION_DISABLED'));
  assert.equal(facts.length, 2);
  await service.changeOrganizationLifecycle({ lifecycle: 'active', expected_version: 3, reason_code: 'administrative_reactivate' });
  await tenancyTransaction(pool, tx => lockActiveFranchiseForOperationalWrite(operationalAccess(tx), scoped));
});

await test('second bootstrap write failure rolls back both roots and publishes no successful audit fact', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t); await database.prepareTenancy(); const pool = database.runtimePool();
  let organizationInserted = false;
  const faulty: DatabasePool = { ...pool, async connect() {
    const client = await pool.connect();
    return { release: discard => client.release(discard), async query<Row extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      if (/INSERT INTO shipit\.franchises/i.test(sql)) throw new DatabaseError('DB_QUERY_FAILED');
      const result = await client.query<Row>(sql, params);
      if (/INSERT INTO shipit\.organizations/i.test(sql)) organizationInserted = true;
      return result;
    } };
  } };
  const { facts, audit } = captureAudit();
  const { app } = testTenancyServer(faulty, approvedAuthority(null, [], 'service'), audit);
  try {
    const response = await app.inject({ method: 'POST', url: '/test/tenancy/bootstrap', payload: {
      display_name: 'Synthetic Rollback Organization', franchise: { display_name: 'Synthetic Rollback Franchise', franchise_code: 'MAIN' },
    } });
    assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(organizationInserted, true);
    const roots = await pool.query<{ organizations: string; franchises: string }>(`SELECT
      (SELECT count(*) FROM shipit.organizations) AS organizations, (SELECT count(*) FROM shipit.franchises) AS franchises`);
    assert.deepEqual(roots.rows[0], { organizations: '0', franchises: '0' }); assert.equal(facts.length, 0);
    assert.doesNotMatch(response.body, /DB_|shipit|Rollback|postgres|constraint/);
  } finally { await app.close(); }
});

await test('real database outage returns a safe 503 without partial mutation or lifecycle audit success', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  const { facts, audit } = captureAudit();
  const { app, service, logs } = testTenancyServer(pool, approvedAuthority(), audit);
  const before = await service.readFranchise(alpha1Id);
  try {
    await database.setAvailable(false);
    const response = await app.inject({ method: 'POST', url: `/test/tenancy/franchises/${alpha1Id}/lifecycle`, payload: disable });
    assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(facts.length, 0); assert.doesNotMatch(response.body + logs.join(''), /DB_|postgres|password|shipit_|Franchise Alpha/);
    await database.setAvailable(true);
    assert.deepEqual(await service.readFranchise(alpha1Id), before);
  } finally { await database.setAvailable(true); await app.close(); }
});

await test('post-commit audit failure and uncertain commit return safe errors while preserving committed state', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t), pool = await fixture(database);
  let attemptedFacts = 0;
  const failedAudit = testTenancyServer(pool, approvedAuthority(), { record: async () => {
    attemptedFacts += 1; throw new Error('SYN_AUDIT_ADAPTER_FAILURE');
  } });
  try {
    const response = await failedAudit.app.inject({ method: 'POST', url: `/test/tenancy/franchises/${alpha1Id}/lifecycle`, payload: disable });
    assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(attemptedFacts, 1); assert.doesNotMatch(response.body + failedAudit.logs.join(''), /SYN_AUDIT|password|postgres/);
    const retained = await failedAudit.service.readFranchise(alpha1Id);
    assert.equal(retained.lifecycle, 'disabled'); assert.equal(retained.version, 2);
  } finally { await failedAudit.app.close(); }

  // The underlying COMMIT succeeds but its result is lost. Never invent rollback
  // or a successful audit notification from an ambiguous service outcome.
  let committed = false;
  const uncertain: DatabasePool = { ...pool, async connect() {
    const client = await pool.connect();
    return { release: discard => client.release(discard), async query<Row extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const result = await client.query<Row>(sql, params);
      if (sql === 'COMMIT') { committed = true; throw new DatabaseError('DB_CONNECTION_FAILED'); }
      return result;
    } };
  } };
  const { facts, audit } = captureAudit();
  const secondId = f.franchises.alpha2.id;
  const boundary = testTenancyServer(uncertain, approvedAuthority(alphaId, [secondId]), audit);
  try {
    const response = await boundary.app.inject({ method: 'POST', url: `/test/tenancy/franchises/${secondId}/lifecycle`, payload: disable });
    assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(committed, true); assert.equal(facts.length, 0);
    const retained = await boundary.service.readFranchise(secondId);
    assert.equal(retained.lifecycle, 'disabled'); assert.equal(retained.version, 2);
    assert.doesNotMatch(response.body + boundary.logs.join(''), /DB_|postgres|password/);
  } finally { await boundary.app.close(); }
});

function operationalAccess(tx:TransactionExecutor) {
  return issueTenantAccess(tx,{action:'franchise.profile.update',actor:{type:'service',id:'synthetic-operations'},
    organizationId:f.organizations.alpha.id,permittedFranchiseIds:[f.franchises.alpha1.id],organizationWide:false,
    provenance:'internal-service',correlationId:'synthetic-operations'});
}
