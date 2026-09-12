import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseError, migrationLockId } from '../../src/index.ts';
import { provisionDatabase, type DisposableDatabase } from '../support.ts';

async function migrationFixture(t: TestContext, files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'shipit-migrations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(directory, name), `exports.up = (pgm) => { pgm.sql(${JSON.stringify(sql)}); };\n`, { mode: 0o600 });
  }
  return directory;
}

async function migrationNames(database: DisposableDatabase) {
  const pool = database.ownerPool();
  try {
    return (await pool.query<{ name: string }>('SELECT name FROM shipit_migrations.pgmigrations ORDER BY id')).rows.map((row) => row.name);
  } finally { await pool.close(); }
}

function migrationProcess(database: DisposableDatabase, directory: string) {
  const child = spawn(process.execPath, ['--experimental-strip-types',
    fileURLToPath(new URL('../migration-process.ts', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_IDENTITY: 'db_test_1',
      TEST_DATABASE_URL: database.migrationConfig().connectionString, DB_TEST_MIGRATION_DIRECTORY: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = new Promise<{ status: number | null; output: unknown }>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 1024) child.kill('SIGKILL');
    });
    // Keep raw subprocess stderr out of assertion diagnostics. The subprocess
    // communicates only controlled JSON; startup failures still fail the test.
    child.stderr.resume();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.once('error', () => { clearTimeout(deadline); reject(new Error('DB_TEST_MIGRATION_PROCESS_FAILED')); });
    child.once('close', (status) => {
      clearTimeout(deadline);
      try { resolve({ status, output: JSON.parse(output) as unknown }); }
      catch { reject(new Error('DB_TEST_MIGRATION_PROCESS_FAILED')); }
    });
  });
  // Keep an early child failure handled while the parent observes the lock;
  // callers still await the original result and fail on the controlled error.
  void result.catch(() => {});
  return { result, stop: async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await result.catch(() => {});
  } };
}

await test('fresh migrations persist a ledger, repeat as no-op and create tenancy, authentication and membership tables', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  assert.deepEqual(await database.migrate(), { applied: 8 });
  const initial = await migrationNames(database);
  assert.equal(initial.length, 8);
  assert.deepEqual(await database.migrate(), { applied: 0 });
  assert.deepEqual(await migrationNames(database), initial);
  const owner = database.ownerPool();
  const schemas = await owner.query<{ schema: string }>("SELECT nspname AS schema FROM pg_namespace WHERE nspname IN ('shipit', 'shipit_migrations') ORDER BY nspname");
  assert.deepEqual(schemas.rows, [{ schema: 'shipit' }, { schema: 'shipit_migrations' }]);
  const tables = await owner.query<{ schema: string; name: string }>(
    `SELECT schemaname AS schema, tablename AS name FROM pg_tables
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename`);
  assert.deepEqual(tables.rows, [...['audit_records','auth_challenges','auth_delivery_jobs','auth_identifiers','auth_rate_limits','auth_security_events','auth_sessions','auth_users'].map(name=>({schema:'shipit',name})),...['customer_audit_events','customer_commands','customers','franchises'].map(name=>({schema:'shipit',name})),
    ...['invitation_franchise_scopes','membership_audit_events','membership_franchise_scopes','membership_invitations','memberships'].map(name=>({schema:'shipit',name})),
    { schema: 'shipit', name: 'onboarding_commands' }, { schema: 'shipit', name: 'organizations' }, { schema: 'shipit_migrations', name: 'pgmigrations' }]);
});

await test('released Issue 10 infrastructure upgrades to tenancy and repeated migration preserves roots', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  assert.deepEqual(await database.migrate({ count: 1 }), { applied: 1 });
  assert.deepEqual(await migrationNames(database), ['1788868800000-infrastructure-schema']);
  const owner = database.ownerPool();
  assert.equal((await owner.query<{ relation: string | null }>(
    "SELECT to_regclass('shipit.organizations')::text AS relation")).rows[0]?.relation, null);
  assert.deepEqual(await database.migrate(), { applied: 7 });
  await owner.query('INSERT INTO shipit.organizations (id, display_name) VALUES ($1, $2)',
    ['00000000-0000-4000-8000-000000000001', 'Organization Alpha']);
  assert.deepEqual(await database.migrate(), { applied: 0 });
  assert.equal((await owner.query<{ count: string }>('SELECT count(*) FROM shipit.organizations')).rows[0]?.count, '1');
  assert.deepEqual(await migrationNames(database), [
    '1788868800000-infrastructure-schema', '1788872400000-organization-franchise-tenancy', '1788958800000-operator-authentication',
    '1789045200000-memberships-authorization', '1789059600000-tenant-audit-ownership', '1789146000000-append-only-audit', '1789232400000-independent-onboarding', '1789318800000-tenant-private-customers',
  ]);
});

await test('prior migration snapshot upgrades forward and preserves committed fixture state', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  const directory = await migrationFixture(t, {
    '1700000000000-synthetic-base.cjs': 'CREATE SCHEMA synthetic_upgrade; CREATE TABLE synthetic_upgrade.probe (label text PRIMARY KEY);',
    '1700000000001-synthetic-upgrade.cjs': 'ALTER TABLE synthetic_upgrade.probe ADD COLUMN revision integer NOT NULL DEFAULT 2;',
  });
  assert.deepEqual(await database.migrate({ dir: directory, count: 1 }), { applied: 1 });
  assert.deepEqual(await migrationNames(database), ['1700000000000-synthetic-base']);
  const owner = database.ownerPool();
  await owner.query('INSERT INTO synthetic_upgrade.probe (label) VALUES ($1)', ['synthetic_prior_snapshot']);
  assert.deepEqual(await database.migrate({ dir: directory }), { applied: 1 });
  assert.deepEqual(await migrationNames(database), ['1700000000000-synthetic-base', '1700000000001-synthetic-upgrade']);
  assert.deepEqual((await owner.query<{ label: string; revision: number }>('SELECT label, revision FROM synthetic_upgrade.probe')).rows,
    [{ label: 'synthetic_prior_snapshot', revision: 2 }]);
  assert.deepEqual(await database.migrate({ dir: directory }), { applied: 0 });
});

await test('failed migration is rolled back, absent from ledger and unlocks for corrected unapplied work', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  const directory = await migrationFixture(t, {
    '1700000000000-synthetic-base.cjs': 'CREATE SCHEMA synthetic_failure; CREATE TABLE synthetic_failure.stable (label text PRIMARY KEY);',
    '1700000000001-synthetic-failure.cjs': 'CREATE TABLE synthetic_failure.uncommitted (label text); SELECT 1 / 0;',
  });
  await database.migrate({ dir: directory, count: 1 });
  await assert.rejects(database.migrate({ dir: directory }), (error: unknown) =>
    error instanceof DatabaseError && error.code === 'DB_MIGRATION_FAILED');
  assert.deepEqual(await migrationNames(database), ['1700000000000-synthetic-base']);
  const owner = database.ownerPool();
  assert.equal((await owner.query<{ relation: string | null }>(
    "SELECT to_regclass('synthetic_failure.uncommitted')::text AS relation")).rows[0]?.relation, null);
  // The failed fixture was never applied or released. Remove that unpublished
  // fixture and add a new forward correction; applied history is left untouched.
  await rm(join(directory, '1700000000001-synthetic-failure.cjs'));
  await writeFile(join(directory, '1700000000002-synthetic-correction.cjs'),
    'exports.up = (pgm) => { pgm.sql("CREATE TABLE synthetic_failure.corrected (label text);"); };\n');
  assert.deepEqual(await database.migrate({ dir: directory }), { applied: 1 });
  assert.deepEqual(await migrationNames(database), ['1700000000000-synthetic-base', '1700000000002-synthetic-correction']);
  assert.equal((await owner.query<{ relation: string | null }>(
    "SELECT to_regclass('synthetic_failure.corrected')::text AS relation")).rows[0]?.relation, 'synthetic_failure.corrected');
});

await test('two migration processes fail safely on the same real advisory lock and recover without overlap', { timeout: 25000 }, async (t) => {
  const database = await provisionDatabase(t);
  const directory = await migrationFixture(t, {
    '1700000000000-synthetic-concurrency.cjs': 'SELECT pg_sleep(3); CREATE SCHEMA synthetic_concurrency; CREATE TABLE synthetic_concurrency.once (label text);',
  });
  const first = migrationProcess(database, directory);
  let second: ReturnType<typeof migrationProcess> | undefined;
  try {
    // Observe the actual lock from another connection before launching contender.
    // Polling has a deadline; no mock promises or assumed scheduler timing.
    const deadline = performance.now() + 5000;
    let locked = false;
    while (performance.now() < deadline) {
      const result = await database.adminQuery<{ locked: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid::bigint * 4294967296 + objid::bigint = $1::bigint) AS locked`, [migrationLockId]);
      if (result.rows[0]?.locked) { locked = true; break; }
      await delay(25);
    }
    assert.equal(locked, true, 'first migration must hold the PostgreSQL advisory lock');
    second = migrationProcess(database, directory);
    const [firstResult, secondResult] = await Promise.all([first.result, second.result]);
    assert.deepEqual(firstResult, { status: 0, output: { applied: 1 } });
    assert.deepEqual(secondResult, { status: 1, output: { code: 'DB_MIGRATION_LOCKED' } });
    assert.deepEqual(await migrationNames(database), ['1700000000000-synthetic-concurrency']);
    assert.deepEqual(await database.migrate({ dir: directory }), { applied: 0 });
    const owner = database.ownerPool();
    assert.equal((await owner.query<{ relation: string | null }>(
      "SELECT to_regclass('synthetic_concurrency.once')::text AS relation")).rows[0]?.relation, 'synthetic_concurrency.once');
  } finally {
    await first.stop();
    await second?.stop();
  }
});

await test('lock owner disconnect releases advisory lock and a new migrator succeeds', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  const owner = database.ownerPool();
  const client = await owner.connect();
  await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId]);
  await assert.rejects(database.migrate(), (error: unknown) =>
    error instanceof DatabaseError && error.code === 'DB_MIGRATION_LOCKED');
  client.release();
  await owner.close();
  assert.deepEqual(await database.migrate(), { applied: 8 });
});
