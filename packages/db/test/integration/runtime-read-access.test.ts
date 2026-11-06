import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { provisionDatabase } from '../support.ts';
import { checkRuntimeAccess, repairRuntimeAccess, runtimeAccessProfiles } from '../../src/runtime-access.ts';
import { auditSetup, org, A, B } from '../../../../apps/api/test/audit-support.ts';
import { createSupportService } from '../../../../apps/api/src/modules/support/service.ts';
import { createPickupService } from '../../../../apps/api/src/modules/pickups/service.ts';
import { createCashbookRequestService } from '../../../../apps/api/src/modules/cashbook/request-service.ts';
import { createCustomerAccountService } from '../../../../apps/api/src/modules/customer-accounts/service.ts';
import { createParcelCustodyService } from '../../../../apps/api/src/modules/custody/service.ts';

await test('declared read profiles repair actual SELECT access without granting domain mutations', { timeout: 60000 }, async t => {
  const db = await provisionDatabase(t); await db.migrate();
  const runtime = db.runtimePool(), owner = db.ownerPool();
  const names = Object.keys(runtimeAccessProfiles).filter(name => !['settings', 'receiving_accounts'].includes(name));
  const target = { role: db.runtimeRole, database: db.database };
  assert.ok(Object.values((await checkRuntimeAccess(runtime, names)).profiles).every(profile => profile.status === 'blocked'));
  await repairRuntimeAccess(owner, target, names);
  assert.ok(Object.values((await checkRuntimeAccess(runtime, names)).profiles).every(profile => profile.status === 'granted'));
  const objects = [...new Set(names.flatMap(name => runtimeAccessProfiles[name]!.requirements.filter(r => r.kind === 'table').map(r => r.object)))];
  for (const object of objects) {
    assert.match(object, /^shipit\.[a-z_]+$/);
    // Parse and authorize the real relation/view, without reading business rows.
    await runtime.query(`SELECT 1 FROM ${object} LIMIT 0`);
    const privileges = (await owner.query<{ insert: boolean; update: boolean; delete: boolean }>(
      `SELECT has_table_privilege($1,$2,'INSERT') AS insert,has_table_privilege($1,$2,'UPDATE') AS update,has_table_privilege($1,$2,'DELETE') AS delete`,
      [db.runtimeRole, object])).rows[0]!;
    assert.equal(privileges.update, false, object);
    assert.equal(privileges.delete, false, object);
    assert.equal(privileges.insert, object === 'shipit.custody_access_events', object);
  }
});

await test('support and pickup lists recover through real owner services without provider calls or write grants', { timeout: 60000 }, async t => {
  const s = await auditSetup(t), owner = s.db.ownerPool();
  const query = { organization_id: org, franchise_id: A };
  const never = async (): Promise<never> => { throw new Error('PROVIDER_MUST_NOT_BE_CALLED'); };
  const support = createSupportService(s.pool);
  const pickups = createPickupService(s.pool, { configuration: { graph_version: 'v24.0', bindings: [] }, provider: { validate: never, template: never, send: never } });
  await assert.rejects(support.list(s.admin.token, query, randomUUID()));
  await assert.rejects(pickups.list(s.admin.token, query, randomUUID()));
  await repairRuntimeAccess(owner, { role: s.db.runtimeRole, database: s.db.database }, ['support', 'pickups']);
  assert.deepEqual(await support.list(s.admin.token, query, randomUUID()), { items: [], next: null });
  assert.deepEqual(await pickups.list(s.admin.token, query, randomUUID()), { items: [], next: null });
  const staff = await s.grant('franchise_admin', [A]);
  for (const service of [support, pickups]) {
    await assert.rejects(service.list(staff.token, { organization_id: org, franchise_id: B }, randomUUID()));
  }
  for (const table of ['support_cases', 'pickup_requests', 'whatsapp_outbound']) {
    const row = (await owner.query("SELECT has_table_privilege($1,$2,'INSERT') allowed", [s.db.runtimeRole, 'shipit.' + table])).rows[0]!;
    assert.equal(row.allowed, false);
  }
});

await test('cashbook, account and custody read workflows work with writes off and preserve scope and custody audit', { timeout: 60000 }, async t => {
  const s = await auditSetup(t), owner = s.db.ownerPool();
  const query = { organization_id: org, franchise_id: A };
  const cashbook = createCashbookRequestService(s.pool, false), accounts = createCustomerAccountService(s.pool, false), custody = createParcelCustodyService(s.pool, false);
  await assert.rejects(cashbook.list(s.admin.token, query, randomUUID()));
  await assert.rejects(custody.worklist(s.admin.token, query, null, randomUUID()));
  await repairRuntimeAccess(owner, { role: s.db.runtimeRole, database: s.db.database }, ['cashbook', 'customer_accounts', 'custody']);
  const list = await cashbook.list(s.admin.token, query, randomUUID());
  assert.deepEqual(list.items, []); assert.equal(list.current_source_version, 0);
  assert.deepEqual((await accounts.list(s.admin.token, query, randomUUID())).items, []);
  assert.deepEqual((await custody.worklist(s.admin.token, query, null, randomUUID())).items, []);
  const staff = await s.grant('franchise_admin', [A]);
  await assert.rejects(cashbook.list(staff.token, { organization_id: org, franchise_id: B }, randomUUID()));
  await assert.rejects(accounts.list(staff.token, { organization_id: org, franchise_id: B }, randomUUID()));
  await assert.rejects(custody.worklist(staff.token, { organization_id: org, franchise_id: B }, null, randomUUID()));
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.custody_access_events')).rows[0]!.n, 1);
  for (const table of ['cashbook_requests', 'customer_accounts', 'custody_commands']) {
    assert.equal((await owner.query("SELECT has_table_privilege($1,$2,'INSERT') allowed", [s.db.runtimeRole, 'shipit.' + table])).rows[0]!.allowed, false);
  }
});
