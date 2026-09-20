import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { attachmentSetup } from '../../../../apps/api/test/attachment-support.ts';
await test('attachment upgrade preserves populated main, rolls back failed migration and repeats without backfill',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:19}),{applied:19});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db),b=await s.book();assert.equal(b.statusCode,201,b.body);db.migrate=migrate;
 const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','parcels','booking_commands','booking_obligations','domain_events'].map(async table=>[table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows])));
 const before=await snapshot(),dir=await mkdtemp(join(tmpdir(),'shipit-attachment-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});const file=join(dir,'1790355600000-private-attachments.cjs');
 await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
 await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});assert.equal((await db.adminQuery("SELECT to_regclass('shipit.attachments') relation")).rows[0]!.relation,null);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,19);assert.deepEqual(await snapshot(),before);
 assert.deepEqual(await db.migrate(),{applied:7});assert.deepEqual(await db.migrate(),{applied:0});await db.prepareAttachments();assert.deepEqual(await snapshot(),before);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.attachments')).rows[0]!.n,0);
});
await test('attachment identity, ready facts and append-only command/audit are protected by PostgreSQL',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),owner=s.db.ownerPool(),id=(await s.initiate()).json().id;await s.upload(id);
 await assert.rejects(owner.query('UPDATE shipit.attachments SET object_key=object_key||$1,version=version+1 WHERE id=$2',['x',id]),e=>(e as {sqlState:string}).sqlState==='23514');
 await assert.rejects(owner.query("UPDATE shipit.attachments SET state='ready',scan_state='clean',linked_at=now(),uploaded_at=now(),validated_at=now(),version=version+1 WHERE id=$1",[id]),e=>(e as {sqlState:string}).sqlState==='23514');
 for(const table of ['attachments','attachment_commands','attachment_audit_events']){
  await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`),e=>(e as {sqlState:string}).sqlState==='42501');
  await assert.rejects(owner.query(`DELETE FROM shipit.${table}`),e=>(e as {sqlState:string}).sqlState==='23514');
  await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));await assert.rejects(s.pool.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER ALL`));
 }
 await assert.rejects(s.pool.query('SELECT * FROM shipit.attachment_audit_events'));await assert.rejects(s.pool.query('INSERT INTO shipit.attachment_audit_events(id) SELECT id FROM shipit.attachments'));
 assert.equal((await s.finalize(id)).statusCode,200);await assert.rejects(owner.query('UPDATE shipit.attachments SET version=version+1 WHERE id=$1',[id]),e=>(e as {sqlState:string}).sqlState==='23514');
 const funcs=(await s.db.adminQuery("SELECT proname,has_function_privilege('public',oid,'EXECUTE') public FROM pg_proc WHERE pronamespace='shipit'::regnamespace AND proname IN ('guard_attachment','audit_attachment','audit_attachment_grant','attachment_cleanup_scope')")).rows;
 assert.equal(funcs.length,4);assert.ok(funcs.every(f=>!f.public));assert.match(String((await s.pool.query('SELECT current_user')).rows[0]!.current_user),/runtime/);
});
