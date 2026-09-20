import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { org,A,B } from '../../../../apps/api/test/audit-support.ts';
import { randomUUID } from 'node:crypto';

await test('outbox upgrade preserves populated producers and audit; failed migration rolls back and retries safely',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:21}),{applied:21});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','parcels','domain_events','booking_commands','audit_history'].map(async table=>
    [table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows])));
  const before=await snapshot(),directory=await mkdtemp(join(tmpdir(),'shipit-outbox-upgrade-'));
  t.after(()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('shipit-outbox-upgrade-'));return rm(directory,{recursive:true,force:true});});
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),directory,{recursive:true});
  const file=join(directory,'1790528400000-durable-outbox.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir:directory}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.outbox_jobs') value")).rows[0]!.value,null);
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await db.migrate(),{applied:3});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual(await snapshot(),before);await db.prepareOutbox();
  const event=booked.json().event_id;
  await assert.rejects(db.adminQuery(`INSERT INTO shipit.outbox_jobs(organization_id,franchise_id,event_id,consumer_id) VALUES($1,$2,$3,'synthetic')`,[org,B,event]));
  const id=randomUUID();await db.adminQuery(`INSERT INTO shipit.outbox_jobs(id,organization_id,franchise_id,event_id,consumer_id) VALUES($1,$2,$3,$4,'synthetic')`,[id,org,A,event]);
  await assert.rejects(db.adminQuery(`INSERT INTO shipit.outbox_jobs(organization_id,franchise_id,event_id,consumer_id) VALUES($1,$2,$3,'synthetic')`,[org,A,event]));
  const runtime=db.runtimePool();
  for(const sql of ["INSERT INTO shipit.outbox_jobs(organization_id,franchise_id,event_id,consumer_id) VALUES($1,$2,$3,'synthetic.other')",
    'UPDATE shipit.outbox_jobs SET consumer_id=\'forged\'', 'DELETE FROM shipit.outbox_jobs','TRUNCATE shipit.outbox_jobs']) {
    await assert.rejects(runtime.query(sql,sql.includes('$1')?[org,A,event]:[]));
  }
  assert.equal((await runtime.query('SELECT shipit.outbox_finish($1,$2,$3,$4,NULL,1000,NULL) saved',[org,A,id,randomUUID()])).rows[0]!.saved,false);
  const claimed=(await runtime.query('SELECT * FROM shipit.outbox_claim($1,$2,$3,NULL)',[org,A,'synthetic'])).rows[0]!;
  assert.equal((await runtime.query("SELECT shipit.outbox_receipt($1,$2,$3,NULL,'applied',NULL) saved",[org,A,id])).rows[0]!.saved,false);
  assert.equal((await runtime.query("SELECT shipit.outbox_finish($1,$2,$3,NULL,'permanent_failure',1000,NULL) saved",[org,A,id])).rows[0]!.saved,false);
  assert.equal((await runtime.query("SELECT shipit.outbox_finish($1,$2,$3,$4,'permanent_failure',1000,NULL) saved",[org,A,id,claimed.lease_token])).rows[0]!.saved,true);
  assert.equal((await runtime.query("SELECT shipit.outbox_redrive($1,$2,$3,$4,$5,$6,$7,NULL,'consumer_upgraded') version",
    [org,A,id,s.admin.id,randomUUID(),'a'.repeat(64),'b'.repeat(64)])).rows[0]!.version,null);
  const fks=(await db.adminQuery(`SELECT confdeltype FROM pg_constraint WHERE conrelid IN
    ('shipit.outbox_jobs'::regclass,'shipit.outbox_receipts'::regclass,'shipit.outbox_attempts'::regclass,'shipit.outbox_redrives'::regclass) AND contype='f'`)).rows;
  assert.ok(fks.length>=5);assert.ok(fks.every(r=>r.confdeltype==='r'));
  await assert.rejects(db.adminQuery('UPDATE shipit.domain_events SET envelope=envelope WHERE event_id=$1',[event]));
});
