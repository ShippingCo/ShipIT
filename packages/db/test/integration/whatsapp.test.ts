import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { whatsappSetup } from '../../../../apps/api/test/whatsapp-support.ts';
import { org,A,B } from '../../../../apps/api/test/audit-support.ts';

await test('WhatsApp additive upgrade preserves populated #35 baseline and audit, rollback and retry',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:22}),{applied:22});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db);assert.equal((await s.book()).statusCode,201);db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','parcels','domain_events','outbox_jobs','audit_history'].map(async table=>
    [table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows])));
  const before=await snapshot(),directory=await mkdtemp(join(tmpdir(),'shipit-whatsapp-upgrade-'));
  t.after(()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('shipit-whatsapp-upgrade-'));return rm(directory,{recursive:true,force:true});});
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),directory,{recursive:true});
  const file=join(directory,'1790614800000-whatsapp-registry.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT missing_issue36_function()');};\n");
  await assert.rejects(db.migrate({dir:directory}));assert.equal((await db.adminQuery("SELECT to_regclass('shipit.whatsapp_installations') value")).rows[0]!.value,null);
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
});

await test('WhatsApp owner constraints, immutable history, revisions and restricted runtime privileges',{timeout:30000},async t=>{
  const s=await whatsappSetup(t),response=await s.connect();assert.equal(response.statusCode,200,response.body);const id=response.json().id;
  assert.equal((await s.request(`installations/${id}/sync`,{expected_version:1,name:'parcel_update',language:'en_US'})).statusCode,200);
  const pool=s.db.runtimePool();
  for(const sql of ['DELETE FROM shipit.whatsapp_installations','TRUNCATE shipit.whatsapp_installations','UPDATE shipit.whatsapp_templates SET status=\'APPROVED\'',
    'DELETE FROM shipit.whatsapp_commands','UPDATE shipit.whatsapp_commands SET version=1','UPDATE shipit.whatsapp_installations SET organization_id=gen_random_uuid()',
    'UPDATE shipit.whatsapp_installations SET version=version+2','UPDATE shipit.whatsapp_installations SET phone_number_id=\'999\''])await assert.rejects(pool.query(sql));
  await assert.rejects(s.db.adminQuery(`INSERT INTO shipit.whatsapp_templates SELECT organization_id,$1,installation_id,name,language,version+1,credential_revision,provider_id,status,category,supported,shape_hash,variables,checked_at,command_id FROM shipit.whatsapp_templates`,[B]));
  await assert.rejects(s.db.adminQuery(`INSERT INTO shipit.whatsapp_templates SELECT organization_id,franchise_id,installation_id,name,language,version+1,credential_revision,provider_id,status,category,supported,shape_hash,'[{"type":"number"}]'::jsonb,checked_at,command_id FROM shipit.whatsapp_templates`));
  // An old successful sync command cannot justify a new template revision.
  await assert.rejects(pool.query(`INSERT INTO shipit.whatsapp_templates SELECT organization_id,franchise_id,installation_id,name,language,version+1,credential_revision,provider_id,status,category,supported,shape_hash,variables,checked_at,command_id FROM shipit.whatsapp_templates`));
  await assert.rejects(s.db.adminQuery(`INSERT INTO shipit.whatsapp_installations SELECT gen_random_uuid(),organization_id,$1,binding_key,waba_id,phone_number_id,credential_ref,1,1,state,validated_at,command_id FROM shipit.whatsapp_installations`,[B]));
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_installations WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.n,1);
  assert.deepEqual(await s.counts(),{installations:1,commands:2,templates:1});
});
