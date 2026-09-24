import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectSource, checkTenantQueries } from './check-tenant-queries.mjs';
const file = 'apps/api/src/modules/example/repository.ts';

test('outbox owner predicates and exact discovery exceptions cannot become raw SQL escapes',()=>{
 const path='apps/api/src/modules/outbox/repository.ts';
 for(const table of ['outbox_jobs','outbox_schedule','outbox_streams','outbox_receipts','outbox_attempts','outbox_redrives']){
  assert.deepEqual(inspectSource(path,`scopedQuery(scope,['outbox.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  for(const code of [`db.query('SELECT * FROM shipit.${table}')`,
   `scopedQuery(scope,['outbox.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
   "import {issueTenantAccess} from '../security/scope.ts'","import {query} from '@shippingco/db'"])
   assert.ok(inspectSource(path,code).length,code);
 }
 const jobs='apps/api/src/modules/security/jobs.ts';
 for(const sql of ['SELECT organization_id,franchise_id FROM shipit.outbox_next_scope($1,$2,$3,$4)',
  'SELECT organization_id,franchise_id FROM shipit.outbox_job_scope($1)',
  'SELECT organization_id,franchise_id,fanout_id FROM shipit.route_delay_fanout_scope($1)']){
  assert.deepEqual(inspectSource(jobs,`tx.query('${sql}')`),[]);
  assert.ok(inspectSource(path,`tx.query('${sql}')`).length);
  assert.ok(inspectSource(jobs,`tx.query('${sql}; SELECT * FROM shipit.domain_events')`).length);
 }
 assert.deepEqual(inspectSource('apps/api/src/modules/outbox/routes.ts','service.list(request.query)'),[]);
 assert.ok(inspectSource('apps/api/src/modules/outbox/routes.ts',"request.query('SELECT * FROM shipit.outbox_jobs')").length);
});
test('tenant AST gate accepts maintained sources and a scoped positive control', () => {
  assert.deepEqual(checkTenantQueries(), []);
  assert.deepEqual(inspectSource(file, `import {scopedQuery as run} from '../security/scope.ts';
    export const list = scope => run(scope, ['franchise.profile.read'], 'SELECT id FROM shipit.franchises WHERE {{franchise:organization_id:id}}');`), []);
});
test('tenant AST gate rejects raw, aliased, computed, missing-predicate and issuer bypasses', () => {
  for (const code of [
    'db.query(`SELECT * FROM shipit.franchises`)',
    "db['query']('SELECT * FROM shipit.franchises')",
    'const execute = db.query; execute(sql)',
    "const execute = db['query']; execute(sql)",
    "import * as scope from '../security/scope.ts'; scope.issueTenantAccess(db, claims)",
    'const {query: execute} = db; execute(sql)',
    "import {issueTenantAccess as forge} from '../security/scope.ts'",
    "import {query as execute} from '@shippingco/db'",
    "import {scopedQuery as run} from '../security/scope.ts'; run(scope, ['franchise.profile.read'], 'SELECT * FROM shipit.franchises')",
  ]) assert.ok(inspectSource(file, code).length, code);
});
test('intentionally unscoped repository makes actual checker CLI exit nonzero', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipit-tenant-gate-'));
  try {
    mkdirSync(join(root, 'apps/api/src/modules/example'), {recursive:true});
    writeFileSync(join(root, file), 'export const unsafe = db => db.query(`SELECT * FROM shipit.franchises`);');
    const result = spawnSync(process.execPath, [resolve('scripts/check-tenant-queries.mjs')], {cwd:root,encoding:'utf8'});
    assert.equal(result.status, 1); assert.match(result.stderr, /TENANT_QUERY_GATE/);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
test('organization occupancy authority remains confined to the membership service', () => {
  const source = "import {activeRoleExists,pendingInvitationExists} from '../memberships/authority.ts'";
  assert.deepEqual(inspectSource('apps/api/src/modules/memberships/service.ts', source), []);
  for (const path of [file, 'apps/api/src/modules/example/service.ts']) {
    assert.ok(inspectSource(path, source).some(error => error.includes('authority resolution')));
    assert.ok(inspectSource(path, "export * from '../memberships/authority.ts'").length);
  }
});
test('audit SQL requires explicit scope and closed actions; request query data is not an executor', () => {
  const audit='apps/api/src/modules/audit/repository.ts';
  assert.deepEqual(inspectSource(audit, "scopedQuery(scope,['audit.read'],'SELECT id FROM shipit.audit_history WHERE {{organization:organization_id}}')"),[]);
  for(const code of ["db.query('SELECT * FROM shipit.audit_history')", "scopedQuery(scope,['audit.read'],'SELECT * FROM shipit.audit_history')",
    "scopedQuery(scope,[],'SELECT * FROM shipit.audit_history WHERE {{organization:organization_id}}')",
    "import {issueTenantAccess} from '../security/scope.ts'", "import * as authority from '../memberships/authority.ts'"])assert.ok(inspectSource(audit,code).length);
  assert.deepEqual(inspectSource('apps/api/src/modules/audit/routes.ts','service.list(request.query)'),[]);
  assert.ok(inspectSource('apps/api/src/modules/audit/routes.ts',"request.query('SELECT * FROM shipit.audit_history')").length);
});

test('customer phone queries require franchise ownership and no new raw SQL exception', () => {
  const customer = 'apps/api/src/modules/customers/repository.ts';
  assert.deepEqual(inspectSource(customer, "scopedQuery(scope,['customer.list'],'SELECT id FROM shipit.customers WHERE {{franchise:organization_id:franchise_id}} AND phone_normalized=$1')"), []);
  for (const source of ["db.query('SELECT id FROM shipit.customers WHERE phone_normalized=$1')",
    "scopedQuery(scope,['customer.list'],'SELECT id FROM shipit.customers WHERE phone_normalized=$1')",
    "scopedQuery(scope,['customer.list'],'SELECT id FROM shipit.customers WHERE {{organization:organization_id}} AND phone_normalized=$1')",
    "import {query} from '@shippingco/db'", "import {issueTenantAccess} from '../security/scope.ts'"]) assert.ok(inspectSource(customer,source).length);
  assert.deepEqual(inspectSource('apps/api/src/modules/customers/routes.ts','service.list(request.query)'),[]);
  assert.ok(inspectSource('apps/api/src/modules/customers/routes.ts',"request.query('SELECT * FROM shipit.customers')").length);
  const root = mkdtempSync(join(tmpdir(), 'shipit-customer-gate-'));
  try {
    mkdirSync(join(root,'apps/api/src/modules/customers'),{recursive:true});
    writeFileSync(join(root,customer),"scopedQuery(scope,['customer.list'],'SELECT id FROM shipit.customers WHERE phone_normalized=$1')");
    const result=spawnSync(process.execPath,[resolve('scripts/check-tenant-queries.mjs')],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/TENANT_QUERY_GATE/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('tax repositories require both owners, closed actions and no raw SQL path',()=>{
  const file='apps/api/src/modules/tax/repository.ts';
  assert.deepEqual(inspectSource(file,"scopedQuery(scope,['tax.calculate'],'SELECT id FROM shipit.tax_intents WHERE {{franchise:organization_id:franchise_id}}')"),[]);
  for(const source of ["db.query('SELECT * FROM shipit.tax_intents')",
    "scopedQuery(scope,['tax.calculate'],'SELECT * FROM shipit.tax_intents WHERE {{organization:organization_id}}')",
    "import {issueTenantAccess} from '../security/scope.ts'"])assert.ok(inspectSource(file,source).length);
});
test('pricing repositories require both owners, closed actions and no raw SQL path',()=>{
  const pricing='apps/api/src/modules/pricing/repository.ts';
  assert.deepEqual(inspectSource(pricing,"scopedQuery(scope,['pricing.quote'],'SELECT id FROM shipit.pricing_rules WHERE {{franchise:organization_id:franchise_id}}')"),[]);
  for(const source of ["db.query('SELECT * FROM shipit.pricing_rules')",
    "scopedQuery(scope,['pricing.quote'],'SELECT * FROM shipit.pricing_rules')",
    "scopedQuery(scope,['pricing.quote'],'SELECT * FROM shipit.pricing_rules WHERE {{organization:organization_id}}')",
    "import {issueTenantAccess} from '../security/scope.ts'","import {query} from '@shippingco/db'"])assert.ok(inspectSource(pricing,source).length);
  const root=mkdtempSync(join(tmpdir(),'shipit-pricing-gate-'));
  try {
    mkdirSync(join(root,'apps/api/src/modules/pricing'),{recursive:true});
    writeFileSync(join(root,pricing),"scopedQuery(scope,['pricing.quote'],'SELECT * FROM shipit.pricing_rules WHERE {{organization:organization_id}}')");
    const result=spawnSync(process.execPath,[resolve('scripts/check-tenant-queries.mjs')],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/TENANT_QUERY_GATE/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('booking and parcel repositories require both owners and cannot mint capabilities or use raw SQL',()=>{
  for(const table of ['parcel_bulk_requests','parcel_commands','parcel_transitions','bookings','parcels','booking_commands','booking_obligations','domain_events']) {
    const file='apps/api/src/modules/bookings/repository.ts';
    assert.deepEqual(inspectSource(file,`scopedQuery(scope,['bookings.create'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
    for(const source of [`db.query('SELECT * FROM shipit.${table}')`,
      `scopedQuery(scope,['bookings.create'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
      "import {issueTenantAccess} from '../security/scope.ts'","import {activeMemberships} from '../memberships/authority.ts'"])assert.ok(inspectSource(file,source).length);
  }
  assert.deepEqual(inspectSource('apps/api/src/modules/bookings/routes.ts','selection(request.query)'),[]);
  assert.ok(inspectSource('apps/api/src/modules/bookings/routes.ts',"request.query('SELECT * FROM shipit.bookings')").length);
});
test('delivery proof tables require composite tenant ownership and route query data is never executable SQL',()=>{
 const file='apps/api/src/modules/deliveries/repository.ts';
 for(const table of ['delivery_commands','delivery_recipients','delivery_attempts','delivery_challenges','delivery_challenge_sends','delivery_exception_requests','delivery_exception_approvals','delivery_proofs','delivery_audit_events']){
  assert.deepEqual(inspectSource(file,`scopedQuery(scope,['deliveries.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  for(const source of [`db.query('SELECT * FROM shipit.${table}')`,`scopedQuery(scope,['deliveries.read'],'SELECT * FROM shipit.${table}')`,
   `scopedQuery(scope,['deliveries.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,"import {issueTenantAccess} from '../security/scope.ts'"])assert.ok(inspectSource(file,source).length,source);
 }
 assert.deepEqual(inspectSource('apps/api/src/modules/deliveries/routes.ts','service.list(session(request),request.query,request.id)'),[]);
 assert.ok(inspectSource('apps/api/src/modules/deliveries/routes.ts',"request.query('SELECT * FROM shipit.delivery_attempts')").length);
 const jobs='apps/api/src/modules/security/jobs.ts';
 const cleanup='SELECT organization_id,franchise_id,challenge_id FROM shipit.delivery_challenge_cleanup_scope($1)';
 assert.deepEqual(inspectSource(jobs,`tx.query('${cleanup}')`),[]);
 assert.ok(inspectSource(file,`tx.query('${cleanup}')`).length);
 assert.ok(inspectSource(jobs,`tx.query('${cleanup}; SELECT * FROM shipit.delivery_challenges')`).length);
});
test('final-mile resolvers require franchise scope and an unscoped #43 query fails the actual checker',()=>{
 const files=['apps/api/src/modules/automation/repository.ts','apps/api/src/modules/automation/final-mile-relevance.ts'];
 for(const path of files)for(const table of ['domain_events','parcels','parcel_failed_attempts','parcel_rto_approvals','delivery_attempts','delivery_proofs']){
  assert.deepEqual(inspectSource(path,`scopedQuery(scope,['outbox.work'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  assert.ok(inspectSource(path,`scopedQuery(scope,['outbox.work'],'SELECT id FROM shipit.${table} WHERE id=$1')`).length);
 }
 const root=mkdtempSync(join(tmpdir(),'shipit-final-mile-gate-')),path=files[1];
 try {
  mkdirSync(join(root,'apps/api/src/modules/automation'),{recursive:true});
  writeFileSync(join(root,path),"scopedQuery(scope,['outbox.work'],'SELECT id FROM shipit.delivery_proofs WHERE id=$1')");
  const result=spawnSync(process.execPath,[resolve('scripts/check-tenant-queries.mjs')],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/TENANT_QUERY_GATE/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('lots require both owner predicates; routes cannot execute request query or mint authority',()=>{
  const file='apps/api/src/modules/lots/repository.ts';
  for(const table of ['lots','lot_commands','lot_memberships','lot_audit_events','lot_code_counters']){
    assert.deepEqual(inspectSource(file,`scopedQuery(scope,['lots.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
    for(const source of [`db.query('SELECT * FROM shipit.${table}')`,
      `scopedQuery(scope,['lots.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
      "import {issueTenantAccess} from '../security/scope.ts'","import {activeMemberships} from '../memberships/authority.ts'"])assert.ok(inspectSource(file,source).length);
  }
  assert.deepEqual(inspectSource('apps/api/src/modules/lots/routes.ts','selection(request.query)'),[]);
  assert.ok(inspectSource('apps/api/src/modules/lots/routes.ts',"request.query('SELECT * FROM shipit.lots')").length);
});

test('Route/manifest tables require both owners; exact HTTP query-data exception never permits SQL or authority minting',()=>{
  const file='apps/api/src/modules/routes/repository.ts';
  for(const table of ['routes','route_commands','route_lots','route_parcels','route_manifests','route_manifest_parcels','route_manifest_sources','route_audit_events','parcel_dispatch_manifests']){
    assert.deepEqual(inspectSource(file,`scopedQuery(scope,['routes.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
    for(const source of [`db.query('SELECT * FROM shipit.${table}')`,
      `scopedQuery(scope,['routes.read'],'SELECT * FROM shipit.${table}')`,
      `scopedQuery(scope,['routes.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
      "import {issueTenantAccess} from '../security/scope.ts'","import {activeMemberships} from '../memberships/authority.ts'","import {query} from '@shippingco/db'"])assert.ok(inspectSource(file,source).length);
  }
  assert.deepEqual(inspectSource('apps/api/src/modules/routes/routes.ts','selection(request.query)'),[]);
  assert.ok(inspectSource('apps/api/src/modules/routes/routes.ts',"request.query('SELECT * FROM shipit.routes')").length);
});

test('payment balances, references and receipts require franchise scope and cannot mint authority',()=>{
  const file='apps/api/src/modules/payments/repository.ts';
  for(const table of ['payment_entries','payment_commands','payment_audit_events']) {
    assert.deepEqual(inspectSource(file,`scopedQuery(scope,['payments.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
    for(const source of [`db.query('SELECT * FROM shipit.${table}')`,
      `scopedQuery(scope,['payments.read'],'SELECT * FROM shipit.${table}')`,
      `scopedQuery(scope,['payments.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
      "import {issueTenantAccess} from '../security/scope.ts'","import {query} from '@shippingco/db'"])assert.ok(inspectSource(file,source).length);
  }
  assert.deepEqual(inspectSource('apps/api/src/modules/payments/routes.ts','selection(request.query)'),[]);
  assert.ok(inspectSource('apps/api/src/modules/payments/routes.ts',"request.query('SELECT * FROM shipit.payment_entries')").length);
});

test('issued receipt queries require both owners and the HTTP query exception cannot mint authority',()=>{
 const file='apps/api/src/modules/receipts/repository.ts';
 for(const table of ['issued_receipts','receipt_audit_events']){
  assert.deepEqual(inspectSource(file,`scopedQuery(scope,['receipts.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  for(const source of [`db.query('SELECT id FROM shipit.${table}')`,
   `scopedQuery(scope,['receipts.read'],'SELECT id FROM shipit.${table} WHERE {{organization:organization_id}}')`,
   "import {issueTenantAccess} from '../security/scope.ts'","import {activeMemberships} from '../memberships/authority.ts'"])assert.ok(inspectSource(file,source).length);
 }
 assert.deepEqual(inspectSource('apps/api/src/modules/receipts/routes.ts','selection(request.query)'),[]);
 assert.ok(inspectSource('apps/api/src/modules/receipts/routes.ts',"request.query('SELECT id FROM shipit.issued_receipts')").length);
});

test('attachment tables require both owners and exact cleanup discovery cannot become a raw-query escape',()=>{
 const file='apps/api/src/modules/attachments/repository.ts';
 for(const table of ['attachments','attachment_commands','attachment_audit_events']){
  assert.deepEqual(inspectSource(file,`scopedQuery(scope,['attachments.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  for(const code of [`db.query('SELECT * FROM shipit.${table} WHERE id=$1')`,
   `scopedQuery(scope,['attachments.read'],'SELECT * FROM shipit.${table} WHERE id=$1')`,
   `scopedQuery(scope,['attachments.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
   "import {issueTenantAccess} from '../security/scope.ts'","import {query} from '@shippingco/db'"])
   assert.ok(inspectSource(file,code).length,code);
 }
 assert.deepEqual(inspectSource('apps/api/src/modules/attachments/routes.ts','service.list(request.query)'),[]);
 assert.ok(inspectSource('apps/api/src/modules/attachments/routes.ts',"request.query('SELECT * FROM shipit.attachments')").length);
 for(const path of [file,'apps/api/src/modules/security/jobs.ts'])
  assert.ok(inspectSource(path,"client.query('SELECT object_key FROM shipit.attachments')").length);
});

test('e-way current, history, receipts and policy require both owners and membership-only authority',()=>{
 const file='apps/api/src/modules/eway/repository.ts';
 for(const table of ['eway_records','eway_record_revisions','eway_commands','eway_policies']){
  assert.deepEqual(inspectSource(file,`scopedQuery(scope,['eway.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  for(const code of [`db.query('SELECT * FROM shipit.${table}')`,`scopedQuery(scope,['eway.read'],'SELECT * FROM shipit.${table} WHERE id=$1')`,
   `scopedQuery(scope,['eway.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
   `scopedQuery(scope,['eway.read'],'SELECT * FROM shipit.${table} WHERE franchise_id=$1')`,
   "import {issueTenantAccess} from '../security/scope.ts'","import {query} from '@shippingco/db'"])
   assert.ok(inspectSource(file,code).length,code);
 }
 assert.deepEqual(inspectSource('apps/api/src/modules/eway/routes.ts','service.read(request.query)'),[]);
 assert.ok(inspectSource('apps/api/src/modules/eway/routes.ts',"request.query('SELECT * FROM shipit.eway_records')").length);
});


test('WhatsApp registry queries require both owners and cannot mint authority',()=>{
 const file='apps/api/src/modules/whatsapp/repository.ts';
 for(const table of ['whatsapp_installations','whatsapp_templates','whatsapp_commands']){
  assert.deepEqual(inspectSource(file,`scopedQuery(scope,['whatsapp.read'],'SELECT id FROM shipit.${table} WHERE {{franchise:organization_id:franchise_id}}')`),[]);
  for(const source of [`db.query('SELECT * FROM shipit.${table}')`,
   `scopedQuery(scope,['whatsapp.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`,
   "import {issueTenantAccess} from '../security/scope.ts'"])assert.ok(inspectSource(file,source).length);
 }
 assert.deepEqual(inspectSource('apps/api/src/modules/whatsapp/routes.ts','service.read(request.query)'),[]);
 assert.ok(inspectSource('apps/api/src/modules/whatsapp/routes.ts',"request.query('SELECT * FROM shipit.whatsapp_installations')").length);
});

test('business inbox only exposes fixed ingress and scheduler calls through trusted adapters',()=>{
 const adapter='apps/api/src/modules/security/jobs.ts',other='apps/api/src/modules/whatsapp/repository.ts';
 for(const sql of ['SELECT shipit.whatsapp_receive($1,$2,$3)','SELECT organization_id,franchise_id,inbox_id FROM shipit.whatsapp_inbox_next()']) {
  assert.deepEqual(inspectSource(adapter,`tx.query('${sql}')`),[]);
  assert.ok(inspectSource(other,`tx.query('${sql}')`).length);
 }
 assert.ok(inspectSource(adapter,"tx.query('SELECT * FROM shipit.whatsapp_inbox')").length);
 for(const name of ['persistBusinessWebhook','withNextInboxScope','withNextConsentScope','withOutboundScope'])assert.ok(inspectSource(other,`import {${name}} from '../security/jobs.ts'`).length);
 assert.ok(inspectSource(other,"import * as jobs from '../security/jobs.ts'").length);
 assert.ok(inspectSource(other,"export * from '../security/jobs.ts'").length);
 for(const table of ['whatsapp_inbox','whatsapp_inbox_attempts','whatsapp_delivery_observations','whatsapp_consent_state','whatsapp_consent_receipts','whatsapp_consent_disclosures','whatsapp_outbound','whatsapp_outbound_attempts','whatsapp_outbound_redrives'])
  assert.ok(inspectSource(other,`scopedQuery(scope,['whatsapp.read'],'SELECT * FROM shipit.${table} WHERE {{organization:organization_id}}')`).length);
});
