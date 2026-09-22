import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { provisionDatabase } from '../support.ts';
import { whatsappSetup } from '../../../../apps/api/test/whatsapp-support.ts';
import { callback,inbound,webhookConfig } from '../../../../apps/api/test/webhook-fixture.ts';
import { normalizeBusinessWebhook } from '../../../../apps/api/src/modules/whatsapp/webhook-payload.ts';
import { persistBusinessWebhook } from '../../../../apps/api/src/modules/security/jobs.ts';
import { createInboxWorker } from '../../../../apps/api/src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../../../../apps/api/src/modules/whatsapp/consent-worker.ts';

await test('populated #38/#39 upgrades preserve evidence and both forward migrations roll back and retry',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:25}),{applied:25});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await whatsappSetup(t,db);await db.prepareWhatsappConsent();await s.connect();
 const body=Buffer.from(JSON.stringify(callback([inbound()],{kind:'messages'})));
 await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(body,webhookConfig),webhookConfig.waba_ids,randomUUID());
 await createInboxWorker(s.pool).tick();await createConsentWorker(s.pool,webhookConfig).tick();db.migrate=migrate;
 const snapshot=async()=>Object.fromEntries(await Promise.all(['whatsapp_installations','whatsapp_inbox','whatsapp_consent_state','whatsapp_consent_receipts','audit_history'].map(async table=>
  [table,(await db.adminQuery(`SELECT row_to_json(t) value FROM shipit.${table} t ORDER BY row_to_json(t)::text`)).rows])));
 const before=await snapshot(),directory=await mkdtemp(join(tmpdir(),'shipit-outbound-upgrade-'));
 t.after(()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('shipit-outbound-upgrade-'));return rm(directory,{recursive:true,force:true});});
 await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),directory,{recursive:true});
 const file=join(directory,'1790874000000-whatsapp-outbound.cjs');
 await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT missing_issue39_function()');};\n");
 await assert.rejects(db.migrate({dir:directory}));assert.deepEqual(await snapshot(),before);
 assert.equal((await db.adminQuery("SELECT to_regclass('shipit.whatsapp_outbound') value")).rows[0]!.value,null);
 assert.deepEqual(await db.migrate({count:1}),{applied:1});const beforeAutomation=await snapshot();
 const automationDirectory=await mkdtemp(join(tmpdir(),'shipit-automation-upgrade-'));
 t.after(()=>{assert.equal(dirname(automationDirectory),tmpdir());assert.ok(basename(automationDirectory).startsWith('shipit-automation-upgrade-'));return rm(automationDirectory,{recursive:true,force:true});});
 await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),automationDirectory,{recursive:true});
 const automationFile=join(automationDirectory,'1790960400000-notification-automation.cjs');
 await writeFile(automationFile,(await readFile(automationFile,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT missing_issue40_function()');};\n");
 await assert.rejects(db.migrate({dir:automationDirectory}));assert.deepEqual(await snapshot(),beforeAutomation);
 assert.equal((await db.adminQuery("SELECT to_regclass('shipit.notification_automation_decisions') value")).rows[0]!.value,null);
 assert.equal((await db.adminQuery("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='shipit' AND table_name='whatsapp_outbound' AND column_name='affected_entity_id'")).rows[0]!.n,0);
 assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
 const count=(await db.adminQuery(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
 LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='shipit'
 AND p.proname LIKE '%outbound%' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0]!.n;assert.equal(count,0);
});
