import assert from 'node:assert/strict';
import test from 'node:test';
import { createTenantIsolationFixture, fixtureId } from '@shippingco/testkit';
import { assertActiveTransaction, DatabaseError, withTransaction, type QueryExecutor,
  type TransactionExecutor } from '../../src/index.ts';
import { provisionDatabase } from '../support.ts';

const fixture = createTenantIsolationFixture();

function sqlState(state: string) {
  return (error: unknown) => {
    assert.ok(error instanceof DatabaseError);
    assert.equal(error.code, 'DB_QUERY_FAILED');
    assert.equal(error.sqlState, state);
    return true;
  };
}

async function seedRoots(db: QueryExecutor) {
  for (const organization of Object.values(fixture.organizations)) {
    await db.query('INSERT INTO shipit.organizations (id, display_name) VALUES ($1, $2)',
      [organization.id, organization.name]);
  }
  for (const [key, franchise] of Object.entries(fixture.franchises)) {
    await db.query(`INSERT INTO shipit.franchises (id, organization_id, franchise_code, display_name)
      VALUES ($1, $2, $3, $4)`,
    [franchise.id, franchise.organization_id, key === 'alpha2' ? 'SECOND' : 'MAIN', franchise.name]);
  }
}

await test('tenancy roots persist standalone and multiple franchises using the existing Alpha/Beta fixture', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  await withTransaction(runtime, seedRoots);
  const rows = await runtime.query<{ organization_id: string; count: string }>(
    'SELECT organization_id, count(*) FROM shipit.franchises GROUP BY organization_id ORDER BY organization_id');
  assert.deepEqual(rows.rows, [{ organization_id: fixture.organizations.alpha.id, count: '2' },
    { organization_id: fixture.organizations.beta.id, count: '1' }]);
  const initial = await runtime.query(`SELECT id, organization_id, franchise_code, display_name,
    lifecycle, version, created_at, updated_at, lifecycle_changed_at FROM shipit.franchises ORDER BY id`);
  assert.equal(initial.rows.length, 3);
  assert.ok(initial.rows.every(row => row.lifecycle === 'active' && row.version === 1));
  assert.equal((await runtime.query<{ precise: boolean }>(`SELECT bool_and(
    created_at = date_trunc('milliseconds', created_at) AND
    updated_at = date_trunc('milliseconds', updated_at) AND
    lifecycle_changed_at = date_trunc('milliseconds', lifecycle_changed_at)) AS precise
    FROM shipit.franchises`)).rows[0]?.precise, true);
  await runtime.close();
  const restarted = database.runtimePool();
  assert.deepEqual((await restarted.query(`SELECT id, organization_id, franchise_code, display_name,
    lifecycle, version, created_at, updated_at, lifecycle_changed_at FROM shipit.franchises ORDER BY id`)).rows, initial.rows);
});

await test('real organization FK and scoped code uniqueness reject invalid rows without partial persistence', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  await seedRoots(runtime);
  await assert.rejects(runtime.query(`INSERT INTO shipit.franchises
    (id, organization_id, franchise_code, display_name) VALUES ($1, $2, $3, $4)`,
  [fixtureId(31), fixtureId(999), 'UNKNOWN', 'Synthetic unknown parent']), sqlState('23503'));
  await assert.rejects(runtime.query(`INSERT INTO shipit.franchises
    (id, organization_id, franchise_code, display_name) VALUES ($1, $2, $3, $4)`,
  [fixtureId(32), fixture.organizations.alpha.id, 'MAIN', 'Synthetic duplicate']), sqlState('23505'));
  assert.equal((await runtime.query<{ count: string }>('SELECT count(*) FROM shipit.franchises')).rows[0]?.count, '3');
  assert.equal((await runtime.query<{ count: string }>('SELECT count(*) FROM shipit.franchises WHERE franchise_code = $1',
    ['MAIN'])).rows[0]?.count, '2', 'same code remains valid in different organizations');
});

await test('ownership and list indexes have the required keys and scoped pagination has a valid real query plan', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  await seedRoots(runtime);
  const indexes = await runtime.query<{ name: string; unique: boolean; valid: boolean; columns: string[] }>(
    `SELECT index_relation.relname AS name, index_definition.indisunique AS unique,
      index_definition.indisvalid AS valid,
      ARRAY(SELECT attribute.attname::text
        FROM unnest(index_definition.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
        JOIN pg_attribute attribute ON attribute.attrelid = index_definition.indrelid
          AND attribute.attnum = key_column.attnum ORDER BY key_column.position) AS columns
      FROM pg_index index_definition
      JOIN pg_class index_relation ON index_relation.oid = index_definition.indexrelid
      WHERE index_definition.indrelid = 'shipit.franchises'::regclass
      ORDER BY index_relation.relname`);
  assert.deepEqual(indexes.rows, [
    { name: 'franchises_organization_code_key', unique: true, valid: true, columns: ['organization_id', 'franchise_code'] },
    { name: 'franchises_organization_created_id_idx', unique: false, valid: true, columns: ['organization_id', 'created_at', 'id'] },
    { name: 'franchises_organization_id_key', unique: true, valid: true, columns: ['organization_id', 'id'] },
    { name: 'franchises_pkey', unique: true, valid: true, columns: ['id'] },
  ]);
  interface PlanNode {
    'Node Type': string;
    'Relation Name'?: string;
    Plans?: PlanNode[];
  }
  const boundary = await runtime.query<{ created_at: Date }>(
    'SELECT created_at FROM shipit.franchises WHERE organization_id = $1 AND id = $2',
    [fixture.organizations.alpha.id, fixture.franchises.alpha1.id]);
  const explained = await runtime.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
    `EXPLAIN (FORMAT JSON, COSTS OFF)
      SELECT id, organization_id, franchise_code, display_name, lifecycle, version,
        created_at, updated_at, lifecycle_changed_at
      FROM shipit.franchises WHERE organization_id = $1 AND id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
      ORDER BY created_at ASC, id ASC LIMIT $5`,
    [fixture.organizations.alpha.id, [fixture.franchises.alpha1.id, fixture.franchises.alpha2.id],
      boundary.rows[0]!.created_at, fixture.franchises.alpha1.id, 2]);
  const plan = explained.rows[0]?.['QUERY PLAN'][0]?.Plan;
  assert.ok(plan);
  assert.equal(plan['Node Type'], 'Limit');
  const visitsFranchises = (node: PlanNode): boolean => node['Relation Name'] === 'franchises' ||
    (node.Plans?.some(visitsFranchises) ?? false);
  assert.equal(visitsFranchises(plan), true);
  // The catalog proves index shape and EXPLAIN proves this scoped keyset query
  // can be planned by the runtime role. Tiny fixtures establish no latency or
  // optimizer-choice guarantee, so do not force or assert a specific index scan.
});

await test('disposable composite ownership child accepts own pair and rejects foreign pair without partial child row', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  await seedRoots(runtime);
  const owner = database.ownerPool();
  const connection = await owner.connect();
  try {
    // PostgreSQL temporary tables cannot reference permanent tenancy roots. This
    // schema exists only in this registered disposable database, never migrations.
    await connection.query('CREATE SCHEMA synthetic_ownership');
    await connection.query(`CREATE TABLE synthetic_ownership.ownership_probe (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      FOREIGN KEY (organization_id, franchise_id)
        REFERENCES shipit.franchises (organization_id, id) ON DELETE RESTRICT
    )`);
    await connection.query(`INSERT INTO synthetic_ownership.ownership_probe (id, organization_id, franchise_id)
      VALUES ($1, $2, $3)`, [fixtureId(71), fixture.organizations.alpha.id, fixture.franchises.alpha1.id]);
    await assert.rejects(connection.query(`INSERT INTO synthetic_ownership.ownership_probe (id, organization_id, franchise_id)
      VALUES ($1, $2, $3)`, [fixtureId(72), fixture.organizations.alpha.id, fixture.franchises.beta1.id]), sqlState('23503'));
    assert.deepEqual((await connection.query('SELECT id, organization_id, franchise_id FROM synthetic_ownership.ownership_probe')).rows,
      [{ id: fixtureId(71), organization_id: fixture.organizations.alpha.id, franchise_id: fixture.franchises.alpha1.id }]);
    await assert.rejects(owner.query('DELETE FROM shipit.organizations WHERE id = $1',
      [fixture.organizations.alpha.id]), sqlState('23001'));
    await assert.rejects(owner.query('DELETE FROM shipit.franchises WHERE id = $1',
      [fixture.franchises.alpha1.id]), sqlState('23001'));
  } finally { connection.release(); }
});

await test('runtime can update approved columns but cannot reparent, change identity, delete or perform DDL', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  await seedRoots(runtime);
  await runtime.query(`UPDATE shipit.franchises SET display_name = $1, lifecycle = $2,
    version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()),
    lifecycle_changed_at = date_trunc('milliseconds', clock_timestamp())
    WHERE organization_id = $3 AND id = $4`,
  ['Synthetic updated franchise', 'disabled', fixture.organizations.alpha.id, fixture.franchises.alpha1.id]);
  await runtime.query(`UPDATE shipit.organizations SET display_name = $1, version = version + 1,
    updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE id = $2`,
  ['Synthetic updated organization', fixture.organizations.alpha.id]);
  const prohibited: Array<[string, readonly unknown[]]> = [
    ['UPDATE shipit.franchises SET organization_id = $1 WHERE id = $2', [fixture.organizations.beta.id, fixture.franchises.alpha1.id]],
    ['UPDATE shipit.franchises SET id = $1 WHERE id = $2', [fixtureId(51), fixture.franchises.alpha1.id]],
    ['UPDATE shipit.franchises SET franchise_code = $1 WHERE id = $2', ['OTHER', fixture.franchises.alpha1.id]],
    ['UPDATE shipit.franchises SET created_at = $1 WHERE id = $2', ['2026-01-01T00:00:00Z', fixture.franchises.alpha1.id]],
    ['UPDATE shipit.organizations SET id = $1 WHERE id = $2', [fixtureId(52), fixture.organizations.alpha.id]],
    ['UPDATE shipit.organizations SET created_at = $1 WHERE id = $2', ['2026-01-01T00:00:00Z', fixture.organizations.alpha.id]],
    ['DELETE FROM shipit.franchises WHERE id = $1', [fixture.franchises.alpha1.id]],
    ['DELETE FROM shipit.organizations WHERE id = $1', [fixture.organizations.alpha.id]],
    ['TRUNCATE shipit.organizations, shipit.franchises', []],
    ['ALTER TABLE shipit.franchises DISABLE TRIGGER ALL', []],
    ['DROP TABLE shipit.franchises', []],
    ['CREATE TABLE shipit.denied (id uuid)', []],
    ['CREATE SCHEMA denied', []],
  ];
  for (const [sql, params] of prohibited) await assert.rejects(runtime.query(sql, params), sqlState('42501'));
  assert.deepEqual((await runtime.query('SELECT organization_id, lifecycle, version FROM shipit.franchises WHERE id = $1',
    [fixture.franchises.alpha1.id])).rows, [{ organization_id: fixture.organizations.alpha.id, lifecycle: 'disabled', version: 2 }]);
  assert.deepEqual((await runtime.query<{ count: string }>('SELECT count(*) FROM shipit.franchises')).rows, [{ count: '3' }]);
});

await test('immutable identity triggers also defend ordinary owner updates and no public table/function grants exist', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const owner = database.ownerPool();
  await seedRoots(owner);
  const prohibited: Array<[string, readonly unknown[]]> = [
    ['UPDATE shipit.franchises SET organization_id = $1 WHERE id = $2', [fixture.organizations.beta.id, fixture.franchises.alpha1.id]],
    ['UPDATE shipit.franchises SET id = $1 WHERE id = $2', [fixtureId(51), fixture.franchises.alpha1.id]],
    ['UPDATE shipit.franchises SET franchise_code = $1 WHERE id = $2', ['OTHER', fixture.franchises.alpha1.id]],
    ['UPDATE shipit.franchises SET created_at = $1 WHERE id = $2', ['2026-01-01T00:00:00Z', fixture.franchises.alpha1.id]],
    ['UPDATE shipit.organizations SET id = $1 WHERE id = $2', [fixtureId(52), fixture.organizations.alpha.id]],
    ['UPDATE shipit.organizations SET created_at = $1 WHERE id = $2', ['2026-01-01T00:00:00Z', fixture.organizations.alpha.id]],
  ];
  for (const [sql, params] of prohibited) await assert.rejects(owner.query(sql, params), sqlState('23514'));
  assert.equal((await owner.query<{ grants: string }>(`SELECT count(*) AS grants
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
      LATERAL aclexplode(p.proacl) permissions
    WHERE n.nspname = 'shipit' AND permissions.grantee = 0`)).rows[0]?.grants, '0');
  assert.equal((await owner.query<{ grants: string }>(`SELECT count(*) AS grants
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
      LATERAL aclexplode(c.relacl) permissions
    WHERE n.nspname = 'shipit' AND permissions.grantee = 0`)).rows[0]?.grants, '0');
});

await test('database checks reject invalid lifecycle, version, noncanonical codes and untrimmed names', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  await seedRoots(runtime);
  for (const code of ['main', ' MAIN', 'MAIN ', 'MAIN\n', '1MAIN', 'A-B', 'Á', 'A'.repeat(33), '']) {
    await assert.rejects(runtime.query(`INSERT INTO shipit.franchises
      (id, organization_id, franchise_code, display_name) VALUES ($1, $2, $3, $4)`,
    [fixtureId(81), fixture.organizations.alpha.id, code, 'Synthetic rejected']), sqlState('23514'));
  }
  for (const name of ['', ' ', '\tSynthetic', 'Synthetic\n', 'Syn\tthetic', 'Syn\u007fthetic',
    '\u00a0Synthetic', 'Synthetic\ufeff', 'A'.repeat(121)]) {
    await assert.rejects(runtime.query('UPDATE shipit.organizations SET display_name = $1 WHERE id = $2',
      [name, fixture.organizations.alpha.id]), sqlState('23514'));
    await assert.rejects(runtime.query('UPDATE shipit.franchises SET display_name = $1 WHERE id = $2',
      [name, fixture.franchises.alpha1.id]), sqlState('23514'));
  }
  for (const table of ['organizations', 'franchises'] as const) {
    // Relation names come from the closed test allowlist; every value is bound.
    await assert.rejects(runtime.query(`UPDATE shipit.${table} SET lifecycle = $1`, ['archived']), sqlState('23514'));
    await assert.rejects(runtime.query(`UPDATE shipit.${table} SET version = $1`, [0]), sqlState('23514'));
  }
  assert.equal((await runtime.query<{ count: string }>('SELECT count(*) FROM shipit.franchises')).rows[0]?.count, '3');
});

await test('lock-dependent executor accepts only the active transaction and rejects pool, lease, forgery and expiry', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareTenancy();
  const runtime = database.runtimePool();
  assert.throws(() => assertActiveTransaction(runtime), { message: 'DB_TRANSACTION_FAILED' });
  const lease = await runtime.connect();
  try { assert.throws(() => assertActiveTransaction(lease), { message: 'DB_TRANSACTION_FAILED' }); }
  finally { lease.release(); }
  let expired: TransactionExecutor | undefined;
  await withTransaction(runtime, async (tx) => {
    assert.doesNotThrow(() => assertActiveTransaction(tx));
    assert.throws(() => assertActiveTransaction({ ...tx }), { message: 'DB_TRANSACTION_FAILED' });
    expired = tx;
    await tx.query('SELECT 1');
  });
  const completed = expired;
  assert.ok(completed);
  assert.throws(() => assertActiveTransaction(completed), { message: 'DB_TRANSACTION_FAILED' });
  await assert.rejects(completed.query('SELECT 1'), { message: 'DB_CLOSED' });
});

await test('Issue 14 data upgrades with composite audit ownership and repeat migration is a no-op', {timeout:20000}, async t => {
  const db=await provisionDatabase(t);
  assert.deepEqual(await db.migrate({count:4}),{applied:4});
  const owner=db.ownerPool();
  const orgA='00000000-0000-4000-8000-000000000001',orgB='00000000-0000-4000-8000-000000000002';
  const user='00000000-0000-4000-8000-000000000101',member='00000000-0000-4000-8000-000000000201';
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic Alpha'),($2,'Synthetic Beta')",[orgA,orgB]);
  await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[user]);
  await owner.query("INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'org_admin')",[member,user,orgA]);
  await owner.query(`INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,affected_user_id,membership_id,action,role)
    VALUES('00000000-0000-4000-8000-000000000901',$1,'service',$2,$3,'bootstrap_admin','org_admin')`,[orgA,user,member]);
  assert.deepEqual(await db.migrate(),{applied:5});
  assert.deepEqual(await db.migrate(),{applied:0});
  assert.equal((await owner.query<{count:string}>('SELECT count(*) FROM shipit.membership_audit_events')).rows[0]?.count,'1');
  await assert.rejects(owner.query(`INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,affected_user_id,membership_id,action,role)
    VALUES('00000000-0000-4000-8000-000000000902',$1,'service',$2,$3,'bootstrap_admin','org_admin')`,[orgB,user,member]));
});
