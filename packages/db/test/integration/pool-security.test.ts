import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureId } from '@shippingco/testkit';
import { checkDatabaseReadiness, DatabaseError } from '../../src/index.ts';
import { provisionDatabase } from '../support.ts';

await test('bound hostile content is data and cannot execute SQL', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool();
  const hostile = "synthetic '); DROP TABLE synthetic.fixture; -- \\ $1 \n 漢字";
  await pool.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(910), hostile]);
  const result = await pool.query<{ label: string }>('SELECT label FROM synthetic.fixture WHERE id = $1', [fixtureId(910)]);
  assert.equal(result.rows[0]?.label, hostile);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*) FROM synthetic.fixture')).rows[0]?.count, '1');
});

await test('runtime identity has DML only and cannot create, alter, drop or bypass isolation', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool();
  const flags = await pool.query<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
    rolinherit: boolean; rolbypassrls: boolean }>(
    'SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  assert.deepEqual(flags.rows[0], { rolname: database.runtimeRole, rolsuper: false, rolcreatedb: false,
    rolcreaterole: false, rolinherit: false, rolbypassrls: false });
  const owner = database.ownerPool();
  const ownership = await owner.query<{ owner: string }>(
    'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()');
  assert.equal(ownership.rows[0]?.owner, database.migrationRole);
  assert.notEqual(database.migrationRole, database.runtimeRole);
  for (const statement of [
    'CREATE TABLE public.denied_fixture (value text)',
    'CREATE TABLE synthetic.denied_fixture (value text)',
    'CREATE TABLE shipit.denied_fixture (value text)',
    'CREATE SCHEMA denied_fixture',
    'CREATE TEMPORARY TABLE denied_fixture (value text)',
    'ALTER TABLE synthetic.fixture ADD COLUMN denied text',
    'DROP TABLE synthetic.fixture',
    'SELECT * FROM shipit_migrations.pgmigrations',
  ]) {
    await assert.rejects(pool.query(statement), (error: unknown) =>
      error instanceof DatabaseError && error.code === 'DB_QUERY_FAILED' && error.sqlState === '42501');
  }
  await pool.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(911), 'synthetic_write']);
  await pool.query('UPDATE synthetic.fixture SET label = $1 WHERE id = $2', ['synthetic_updated', fixtureId(911)]);
  assert.equal((await pool.query<{ label: string }>('SELECT label FROM synthetic.fixture')).rows[0]?.label, 'synthetic_updated');
  await pool.query('DELETE FROM synthetic.fixture WHERE id = $1', [fixtureId(911)]);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*) FROM synthetic.fixture')).rows[0]?.count, '0');
});

await test('pool exhaustion has a deadline and recovers when checked-out client releases', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1, connectionTimeoutMs: 200 });
  const held = await pool.connect();
  try {
    const start = performance.now();
    await assert.rejects(pool.query('SELECT 1'), (error: unknown) =>
      error instanceof DatabaseError && ['DB_TIMEOUT', 'DB_CONNECTION_FAILED'].includes(error.code));
    assert.ok(performance.now() - start < 4000, 'exhaustion must not wait indefinitely');
    assert.equal(pool.stats().total, 1);
    assert.equal(pool.stats().waiting, 0);
    const readiness = await checkDatabaseReadiness(pool);
    assert.equal(readiness.status, 'not_ready');
  } finally { held.release(); }
  assert.deepEqual(await checkDatabaseReadiness(pool), { status: 'ready' });
  assert.equal(pool.stats().idle, 1);
});

await test('real statement timeout is controlled and the pool remains usable', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1, statementTimeoutMs: 100, queryTimeoutMs: 1000 });
  await assert.rejects(pool.query('SELECT pg_sleep(2)'), (error: unknown) =>
    error instanceof DatabaseError && error.code === 'DB_TIMEOUT');
  assert.deepEqual(await checkDatabaseReadiness(pool), { status: 'ready' });
});

await test('pool close settles every queued acquisition before resolving within its deadline', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1, connectionTimeoutMs: 200 });
  const held = await pool.connect();
  let requestsSettled = false;
  const pending = Promise.allSettled([pool.connect(), pool.query('SELECT 1')]).then((results) => {
    requestsSettled = true;
    return results;
  });
  assert.equal(pool.stats().waiting, 2);
  const started = performance.now();
  await pool.close();
  assert.ok(performance.now() - started < 4000, 'shutdown with waiters must have a deadline');
  assert.equal(requestsSettled, true, 'close must await owned acquisition promises');
  assert.deepEqual(pool.stats(), { total: 0, idle: 0, waiting: 0 });
  for (const result of await pending) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      const error: unknown = result.reason;
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.code, 'DB_CLOSED');
    }
  }
  await assert.rejects(held.query('SELECT 1'), { message: 'DB_CLOSED' });
  held.release();
});

await test('database outage returns only safe readiness data and recovers after availability returns', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1, connectionTimeoutMs: 200 });
  assert.deepEqual(await checkDatabaseReadiness(pool), { status: 'ready' });
  await database.setAvailable(false);
  try {
    const start = performance.now();
    const readiness = await checkDatabaseReadiness(pool);
    assert.equal(readiness.status, 'not_ready');
    assert.ok(performance.now() - start < 4000, 'readiness failure must be bounded');
    assert.match(JSON.stringify(readiness), /^\{"status":"not_ready","code":"DB_[A-Z_]+"\}$/);
    assert.equal(Object.keys(readiness).length, 2);
  } finally { await database.setAvailable(true); }
  assert.deepEqual(await checkDatabaseReadiness(pool), { status: 'ready' });
  await pool.close();
  assert.deepEqual(await checkDatabaseReadiness(pool), { status: 'not_ready', code: 'DB_CLOSED' });
});

await test('separate disposable databases cannot see each other and registered cleanup removes exact resources', { timeout: 25000 }, async (t) => {
  const first = await provisionDatabase(t);
  const second = await provisionDatabase(t);
  await first.prepareFixtures();
  await second.prepareFixtures();
  assert.notEqual(first.database, second.database);
  const firstPool = first.runtimePool();
  const secondPool = second.runtimePool();
  await firstPool.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(912), 'synthetic_isolated']);
  assert.equal((await secondPool.query<{ count: string }>('SELECT count(*) FROM synthetic.fixture')).rows[0]?.count, '0');
  const permission = await second.adminQuery<{ allowed: boolean }>(
    'SELECT has_database_privilege($1, $2, $3) AS allowed', [first.runtimeRole, second.database, 'CONNECT']);
  assert.equal(permission.rows[0]?.allowed, false);
  await first.close();
  const cleaned = await second.adminQuery<{ count: string }>(
    `SELECT (SELECT count(*) FROM pg_database WHERE datname = $1)
      + (SELECT count(*) FROM pg_roles WHERE rolname = ANY($2::text[])) AS count`,
    [first.database, [first.migrationRole, first.runtimeRole]]);
  assert.equal(cleaned.rows[0]?.count, '0');
  assert.deepEqual(await checkDatabaseReadiness(secondPool), { status: 'ready' });
});
