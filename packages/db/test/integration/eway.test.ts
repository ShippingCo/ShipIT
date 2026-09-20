import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { ewaySetup } from '../../../../apps/api/test/eway-support.ts';
import { org,A,B } from '../../../../apps/api/test/audit-support.ts';

await test('e-way migration upgrades populated attachment-era main, rolls back failure and leaves unknown declarations absent',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:20}),{applied:20});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','parcels','booking_commands','booking_obligations','domain_events','attachments'].map(async table=>[table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows])));
  const before=await snapshot(),dir=await mkdtemp(join(tmpdir(),'shipit-eway-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});const file=join(dir,'1790442000000-external-eway-records.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.eway_records') relation")).rows[0]!.relation,null);
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,20);assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await db.migrate(),{applied:0});await db.prepareEway();assert.deepEqual(await snapshot(),before);
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.eway_records')).rows[0]!.n,0);
  const state=await s.app.inject({url:'/api/v1/bookings/'+booked.json().id+'/eway?'+new URLSearchParams({organization_id:org,franchise_id:A}),cookies:s.cookies(s.operator.token)});
  assert.equal(state.statusCode,200,state.body);assert.equal(state.json().record,null);assert.equal(state.json().state.value_check_state,'unknown');
  // A released schema is repaired by a NEW migration; the installed file is never edited.
  const repair=await mkdtemp(join(tmpdir(),'shipit-eway-forward-'));t.after(()=>rm(repair,{recursive:true,force:true}));
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),repair,{recursive:true});
  await writeFile(join(repair,'1790528400001-synthetic-forward-repair.cjs'),"exports.up=p=>p.sql('CREATE INDEX synthetic_eway_repair ON shipit.eway_records(organization_id,franchise_id,version)');exports.down=()=>{throw new Error('Forward only');};");
  assert.deepEqual(await db.migrate({dir:repair}),{applied:1});assert.deepEqual(await snapshot(),before);
});

await test('e-way policy approval, immutable evidence, composite ownership and no-audit-bypass constraints hold in PostgreSQL',{timeout:30000},async t=>{
  const s=await ewaySetup(t);await s.policy();await s.ewayCreate();const owner=s.db.ownerPool();
  for(const table of ['eway_records','eway_record_revisions','eway_commands','eway_policies']){
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
    await assert.rejects(owner.query(`DELETE FROM shipit.${table}`));await assert.rejects(s.pool.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER ALL`));
  }
  await assert.rejects(s.pool.query('INSERT INTO shipit.eway_record_revisions SELECT * FROM shipit.eway_records'));
  await assert.rejects(s.pool.query("UPDATE shipit.eway_policies SET approved=false"));
  await assert.rejects(s.pool.query('UPDATE shipit.eway_records SET booking_id=$1',[randomUUID()]));
  await assert.rejects(owner.query('UPDATE shipit.eway_record_revisions SET distance_km=2'));
  await assert.rejects(owner.query('UPDATE shipit.eway_commands SET version=2'));
  await assert.rejects(owner.query(`INSERT INTO shipit.eway_records SELECT (jsonb_populate_record(NULL::shipit.eway_records,to_jsonb(r)||$1::jsonb)).* FROM shipit.eway_records r`,[JSON.stringify({id:randomUUID(),command_id:randomUUID(),franchise_id:B})]),e=>(e as {sqlState:string}).sqlState==='23503');
  await assert.rejects(owner.query('UPDATE shipit.eway_records SET distance_km=2,version=version+1,command_id=$1,reason_code=$2,reason_ref=$3',[randomUUID(),'metadata_correction','SYN_NO_RECEIPT']));
  await assert.rejects(owner.query("UPDATE shipit.eway_records SET estimate='{}',estimate_policy_id=$1,version=version+1,command_id=$2,reason_code='metadata_correction',reason_ref='SYN_ESTIMATE_BYPASS'",[randomUUID(),randomUUID()]));
  const insert=`INSERT INTO shipit.eway_policies(id,organization_id,franchise_id,version,approved,effective_from,source_ref,approval_ref) VALUES($1,$2,$3,2,true,$4,'SYN_SOURCE','SYN_APPROVAL')`;
  await assert.rejects(s.pool.query(insert,[randomUUID(),org,A,'2099-02-01T00:00:00Z']));
  await assert.rejects(owner.query(insert,[randomUUID(),org,A,'2000-01-01T00:00:00Z']));
  await assert.rejects(owner.query(insert,[randomUUID(),org,A,'2098-01-01T00:00:00Z']));
  await assert.rejects(owner.query(insert,[randomUUID(),org,A,'infinity']));
  const funcs=(await s.db.adminQuery("SELECT proname,has_function_privilege('public',oid,'EXECUTE') public FROM pg_proc WHERE pronamespace='shipit'::regnamespace AND proname IN ('guard_eway_policy','guard_eway_record','capture_eway_revision','check_eway_command')")).rows;
  assert.equal(funcs.length,4);assert.ok(funcs.every(f=>!f.public));assert.deepEqual(await s.ewayCounts(),{records:1,revisions:1,commands:1,audits:1});
});
