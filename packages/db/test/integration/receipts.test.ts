import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { receiptSetup } from '../../../../apps/api/test/receipt-support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { createPaymentService } from '../../../../apps/api/src/modules/payments/service.ts';
import { createReceiptService } from '../../../../apps/api/src/modules/receipts/service.ts';
import { collectionInput } from '../../../../apps/api/test/payment-support.ts';
import { org,A,B,otherOrg } from '../../../../apps/api/test/audit-support.ts';
await test('populated pre-30 migration rolls back on failure, preserves source facts and never backfills issuance',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:18}),{applied:18});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db);await db.preparePayments();
 const booking=await s.book();assert.equal(booking.statusCode,201,booking.body);
 const key=randomUUID(),paid=await createPaymentService(s.pool).execute(s.local.token,booking.json().id,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],collectionInput(100),'payments.collect',randomUUID());
 const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','booking_obligations','payment_entries','payment_commands','domain_events'].map(async table=>[table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows])));
 const before=await snapshot();db.migrate=migrate;
 const dir=await mkdtemp(join(tmpdir(),'shipit-receipt-upgrade-'));t.after(async()=>{assert.equal(dirname(dir),tmpdir());await rm(dir,{recursive:true,force:true});});
 await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});const file=join(dir,'1790269200000-immutable-issued-receipts.cjs');
 await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
 await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});assert.equal((await db.adminQuery("SELECT to_regclass('shipit.issued_receipts') relation")).rows[0]!.relation,null);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,18);assert.deepEqual(await snapshot(),before);
 assert.deepEqual(await db.migrate(),{applied:7});assert.deepEqual(await db.migrate(),{applied:0});await db.prepareReceipts();
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.issued_receipts')).rows[0]!.n,0);assert.deepEqual(await snapshot(),before);
 const dto=await createReceiptService(s.pool).read(s.local.token,booking.json().id,paid.entry.id,{organization_id:org,franchise_id:A},randomUUID());
 assert.equal(dto.kind,'collection_acknowledgement');assert.notEqual(dto.issued_at,booking.json().confirmed_at);assert.deepEqual(await snapshot(),before);
});
await test('runtime inserts derive contents; owner and runtime cannot edit/delete issued receipts or audit',{timeout:30000},async t=>{
 const s=await receiptSetup(t),owner=s.db.ownerPool();
 const sql=`INSERT INTO shipit.issued_receipts(id,organization_id,franchise_id,booking_id,obligation_id,kind,payment_entry_id,booking_receipt_id,correction_of,actor_id,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,number,snapshot`;
 const values=[randomUUID(),org,A,s.bookingId,s.booked.payment_obligation.id,'booking_charge',null,null,null,s.local.id,randomUUID()];
 const inserted=await s.pool.query(sql,values);assert.equal(inserted.rows.length,1);assert.equal((await s.receipt()).json().id,values[0]);
 const before=await s.effects();
 for(const table of ['issued_receipts','receipt_audit_events']){
  for(const query of [`UPDATE shipit.${table} SET id=id`,`DELETE FROM shipit.${table}`]){
   await assert.rejects(s.pool.query(query),e=>(e as {sqlState?:string}).sqlState==='42501');await assert.rejects(owner.query(query),e=>(e as {sqlState?:string}).sqlState==='23514');
  }
  await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
 }
 await assert.rejects(s.pool.query("SELECT nextval('shipit.issued_receipt_numbers')"));
 await assert.rejects(s.pool.query('INSERT INTO shipit.receipt_audit_events(id) VALUES($1)',[randomUUID()]));
 await assert.rejects(s.pool.query('ALTER TABLE shipit.issued_receipts DISABLE TRIGGER issued_receipt_snapshot'));
 // Generated columns cannot be supplied even by a runtime with INSERT on identity columns.
 for(const [field,value] of [['snapshot',{currency:'INR'}],['number','RCT-0000000000000000001'],['schema_version',2],['version',2],['issued_at',new Date()]]){
  await assert.rejects(s.pool.query(`INSERT INTO shipit.issued_receipts(${field}) VALUES($1)`,[value]),e=>(e as {sqlState?:string}).sqlState==='42501');
  await assert.rejects(owner.query(`INSERT INTO shipit.issued_receipts(${field}) VALUES($1)`,[value]),e=>(e as {sqlState?:string}).sqlState==='23514');
 }
 await assert.rejects(s.pool.query(sql,[randomUUID(),...values.slice(1)]),e=>(e as {sqlState?:string}).sqlState==='23505');
 for(const [index,value] of [[1,otherOrg],[2,B],[3,randomUUID()],[4,randomUUID()],[5,'unknown'],[6,randomUUID()],[8,randomUUID()]] as const){const v=[...values];v[0]=randomUUID();v[index]=value;await assert.rejects(s.pool.query(sql,v),e=>(e as {sqlState?:string}).sqlState==='23514');}
 assert.deepEqual(await s.effects(),before);
});
await test('receipt constraints enforce global number uniqueness and same-owner payment/correction links',{timeout:30000},async t=>{
 const s=await receiptSetup(t),first=(await s.receipt()).json(),paid=await s.pay(collectionInput(500)),ack=(await s.receipt(paid.json().entry.id)).json(),rev=await s.reverse(paid.json().entry.id,100);
 const sql=`INSERT INTO shipit.issued_receipts(id,organization_id,franchise_id,booking_id,obligation_id,kind,payment_entry_id,booking_receipt_id,correction_of,actor_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
 const values=[randomUUID(),org,A,s.bookingId,s.booked.payment_obligation.id,'collection_reversal',rev.json().entry.id,first.id,ack.id,s.local.id,randomUUID()];
 for(const [index,value] of [[1,otherOrg],[2,B],[6,paid.json().entry.id],[7,ack.id],[8,first.id],[8,randomUUID()],[8,null],[5,'collection_acknowledgement']] as const){const v=[...values];v[index]=value;await assert.rejects(s.pool.query(sql,v),e=>(e as {sqlState?:string}).sqlState==='23514');}
 await s.pool.query(sql,values);assert.equal((await s.receipt(rev.json().entry.id)).json().correction_of,ack.id);
 const next=await s.book();assert.equal(next.statusCode,201,next.body);
 const serial=(await s.db.adminQuery('SELECT last_value FROM shipit.issued_receipt_numbers')).rows[0]!.last_value;
 // Test-only sequence rewind forces a collision across different Bookings. It is restored immediately.
 await s.db.adminQuery('SELECT setval($1::regclass,$2::bigint,false)',['shipit.issued_receipt_numbers',BigInt(first.number.slice(4)).toString()]);
 try {await assert.rejects(s.pool.query(sql,[randomUUID(),org,A,next.json().id,next.json().payment_obligation.id,'booking_charge',null,null,null,s.local.id,randomUUID()]),e=>(e as {sqlState?:string}).sqlState==='23505');}
 finally {await s.db.adminQuery('SELECT setval($1::regclass,$2::bigint,true)',['shipit.issued_receipt_numbers',serial]);}
 const constraints=(await s.db.adminQuery("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='shipit.issued_receipts'::regclass")).rows.map(x=>x.definition);
 assert.ok(constraints.some(x=>String(x).includes('UNIQUE (number)')));assert.equal(constraints.filter(x=>String(x).includes('FOREIGN KEY (organization_id, franchise_id, booking_id')).length,4);
});
