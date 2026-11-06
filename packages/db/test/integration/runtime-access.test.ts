import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionDatabase } from '../support.ts';
import { checkRuntimeAccess, repairRuntimeAccess, runtimeAccessProfiles } from '../../src/runtime-access.ts';
import { randomUUID } from 'node:crypto';
import { auditSetup, org, A, B } from '../../../../apps/api/test/audit-support.ts';
import { createSettingsService } from '../../../../apps/api/src/modules/settings/service.ts';
import { createReceivingAccountService } from '../../../../apps/api/src/modules/payments/account-service.ts';

await test('read-only diagnosis finds missing access; scoped repair is replayable and preserves forbidden writes', { timeout: 60000 }, async t => {
  const db = await provisionDatabase(t);
  await db.migrate();
  const runtime = db.runtimePool(), owner = db.ownerPool();
  const profiles = ['settings', 'receiving_accounts'];
  const before = await checkRuntimeAccess(runtime, profiles);
  assert.equal(before.role_safe, true);
  assert.equal(before.schema_usage, false);
  assert.ok(before.profiles.settings!.checks.some(check => check.status === 'missing_privilege'));
  assert.equal((await owner.query("SELECT has_table_privilege($1,'shipit.settings_versions','SELECT') allowed", [db.runtimeRole])).rows[0]!.allowed, false);

  const repaired = await repairRuntimeAccess(owner, { role: db.runtimeRole, database: db.database }, profiles);
  assert.equal(repaired.schema_usage, true);
  assert.equal(repaired.profiles.settings!.status, 'granted');
  assert.deepEqual(await repairRuntimeAccess(owner, { role: db.runtimeRole, database: db.database }, profiles), repaired);
  assert.deepEqual(await checkRuntimeAccess(runtime, profiles), repaired);
  assert.deepEqual((await runtime.query('SELECT id FROM shipit.settings_versions')).rows, []);
  assert.deepEqual((await runtime.query('SELECT id FROM shipit.receiving_accounts')).rows, []);

  for (const sql of ['DELETE FROM shipit.settings_versions', 'UPDATE shipit.settings_commands SET id=id',
    'TRUNCATE shipit.settings_events', 'DELETE FROM shipit.receiving_accounts',
    'INSERT INTO shipit.receiving_account_revisions (recorded_at) VALUES (now())',
    'SELECT * FROM shipit.whatsapp_outbound', 'CREATE TABLE shipit.forgery (id int)']) {
    await assert.rejects(runtime.query(sql));
  }
  assert.equal((await owner.query("SELECT has_table_privilege($1,'shipit.receiving_account_revisions','INSERT') allowed", [db.runtimeRole])).rows[0]!.allowed, false);
});

await test('every declared schema object exists; missing objects and unsafe roles remain explicit', { timeout: 60000 }, async t => {
  const db = await provisionDatabase(t); await db.migrate();
  const runtime = db.runtimePool(), owner = db.ownerPool();
  const all = await checkRuntimeAccess(runtime);
  assert.equal(Object.keys(all.profiles).length, Object.keys(runtimeAccessProfiles).length);
  assert.deepEqual(Object.values(all.profiles).flatMap(profile => profile.checks).filter(check => check.status === 'missing_object'), []);
  await owner.query('ALTER TABLE shipit.settings_events RENAME TO settings_events_hidden');
  const incomplete = await checkRuntimeAccess(runtime, ['settings']);
  assert.ok(incomplete.profiles.settings!.checks.some(check => check.object === 'shipit.settings_events' && check.status === 'missing_object'));
  // Grants executed before the missing object must roll back, including schema USAGE.
  await assert.rejects(repairRuntimeAccess(owner, { role: db.runtimeRole, database: db.database }, ['settings']));
  assert.equal((await checkRuntimeAccess(runtime, ['settings'])).schema_usage, false);
  assert.equal((await owner.query("SELECT has_table_privilege($1,'shipit.settings_versions','SELECT') allowed", [db.runtimeRole])).rows[0]!.allowed, false);
  assert.equal((await checkRuntimeAccess(owner, ['settings'])).role_safe, false);
});

await test('repair refuses wrong database, unsafe target and arbitrary profile before granting', { timeout: 60000 }, async t => {
  const db = await provisionDatabase(t); await db.migrate();
  const runtime = db.runtimePool(), owner = db.ownerPool();
  await assert.rejects(repairRuntimeAccess(owner, { role: db.runtimeRole, database: 'other' }, ['settings']), /ACCESS_TARGET_MISMATCH/);
  await assert.rejects(repairRuntimeAccess(owner, { role: db.migrationRole, database: db.database }, ['settings']), /ACCESS_TARGET_MISMATCH/);
  await assert.rejects(repairRuntimeAccess(owner, { role: db.runtimeRole, database: db.database }, ['__proto__']), /ACCESS_PROFILE_INVALID/);
  assert.equal((await checkRuntimeAccess(runtime, ['settings'])).schema_usage, false);
  await owner.query(`GRANT CREATE ON SCHEMA shipit TO "${db.runtimeRole}"`);
  assert.equal((await checkRuntimeAccess(runtime, ['settings'])).role_safe, false);
  await assert.rejects(repairRuntimeAccess(owner, { role: db.runtimeRole, database: db.database }, ['settings']), /ACCESS_RUNTIME_ROLE_UNSAFE/);
});

await test('repaired access supports real owner setup services, safe retries and branch isolation', { timeout: 60000 }, async t => {
  // Prepare authentication/tenancy only. The new production manifest must supply
  // settings/account access; do not hide gaps with prepareSettings/Accounts.
  const s = await auditSetup(t);
  const owner = s.db.ownerPool();
  await repairRuntimeAccess(owner, { role: s.db.runtimeRole, database: s.db.database }, ['settings', 'receiving_accounts']);
  const settings = createSettingsService(s.pool, true), accounts = createReceivingAccountService(s.pool, true);
  const query = { organization_id: org, franchise_id: A };
  assert.equal((await settings.read(s.admin.token, 'franchise', query, randomUUID())).version, 0);
  const key = randomUUID();
  const input = { expected_version: 0, reason: 'Synthetic setup', changes: { language: { locale: 'en' } } };
  const updated = await settings.update(s.admin.token, 'franchise', query, key, ['idempotency-key', key], input, randomUUID());
  assert.equal(updated.version, 1);
  assert.deepEqual(await settings.update(s.admin.token, 'franchise', query, key, ['idempotency-key', key], input, randomUUID()), updated);
  const accountKey = randomUUID();
  const accountInput = { name: 'Synthetic counter cash', methods: ['cash'], other_method_name: null, active: true, expected_version: 0 };
  const account = await accounts.configure(s.admin.token, null, query, accountKey, ['idempotency-key', accountKey], accountInput, randomUUID());
  assert.deepEqual(await accounts.configure(s.admin.token, null, query, accountKey, ['idempotency-key', accountKey], accountInput, randomUUID()), account);
  assert.equal((await accounts.list(s.admin.token, query, randomUUID())).items.length, 1);
  const staff = await s.grant('franchise_admin', [A]);
  await assert.rejects(settings.read(staff.token, 'franchise', { organization_id: org, franchise_id: B }, randomUUID()));
  await assert.rejects(accounts.read(staff.token, account.id, { organization_id: org, franchise_id: B }, randomUUID()));
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.settings_versions')).rows[0]!.n, 1);
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.receiving_accounts')).rows[0]!.n, 1);
});
