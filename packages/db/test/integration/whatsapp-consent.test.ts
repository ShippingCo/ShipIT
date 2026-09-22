import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { provisionDatabase } from '../support.ts';
import { whatsappSetup } from '../../../../apps/api/test/whatsapp-support.ts';
import { org,A } from '../../../../apps/api/test/audit-support.ts';
import { normalizeBusinessWebhook } from '../../../../apps/api/src/modules/whatsapp/webhook-payload.ts';
import { persistBusinessWebhook } from '../../../../apps/api/src/modules/security/jobs.ts';
import { createInboxWorker } from '../../../../apps/api/src/modules/whatsapp/inbox-worker.ts';
import { callback,inbound,webhookConfig } from '../../../../apps/api/test/webhook-fixture.ts';

await test('consent upgrade preserves populated #37 source/audit, creates unknown contact identities and rolls back safely',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:24}),{applied:24});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await whatsappSetup(t,db);await db.prepareWhatsappInbox();await s.connect();
  const customer=randomUUID();await db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,created_at,updated_at)
    VALUES($1,$2,$3,'Upgrade fiction','+15550000001','+15550000001',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day')`,[customer,org,A]);
  await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([inbound()],{kind:'messages'}))),webhookConfig),webhookConfig.waba_ids,randomUUID());
  await createInboxWorker(s.pool).tick();db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['whatsapp_installations','whatsapp_inbox','whatsapp_inbox_attempts','audit_history'].map(async table=>
    [table,(await db.adminQuery(`SELECT row_to_json(t) value FROM shipit.${table} t ORDER BY row_to_json(t)::text`)).rows])));
  const before=await snapshot(),directory=await mkdtemp(join(tmpdir(),'shipit-consent-upgrade-'));
  t.after(()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('shipit-consent-upgrade-'));return rm(directory,{recursive:true,force:true});});
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),directory,{recursive:true});
  const file=join(directory,'1790787600000-scoped-messaging-consent.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT missing_issue38_function()');};\n");
  await assert.rejects(db.migrate({dir:directory}));assert.deepEqual(await snapshot(),before);
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.whatsapp_consent_state') value")).rows[0]!.value,null);
  assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
  const c=(await db.adminQuery('SELECT contact_version,contact_changed_at,updated_at FROM shipit.customers WHERE id=$1',[customer])).rows[0]!;
  assert.ok(c.contact_version);assert.deepEqual(c.contact_changed_at,c.updated_at);
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_consent_state')).rows[0]!.n,0);
  assert.equal((await s.request('installation')).statusCode,200);
  const count=(await db.adminQuery(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='shipit'
    AND p.proname IN ('whatsapp_consent_next','whatsapp_consent_apply') AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0]!.n;
  assert.equal(count,0);
});
