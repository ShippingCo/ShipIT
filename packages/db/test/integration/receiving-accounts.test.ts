import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withTransaction,type TransactionExecutor} from '../../src/index.ts';
import {provisionDatabase} from '../support.ts';
import {auditSetup,org,A,B} from '../../../../apps/api/test/audit-support.ts';
import {bookingSetup} from '../../../../apps/api/test/booking-support.ts';
import {createPaymentService} from '../../../../apps/api/src/modules/payments/service.ts';
import {createReceiptService} from '../../../../apps/api/src/modules/receipts/service.ts';
import {collectionInput} from '../../../../apps/api/test/payment-support.ts';
const digest=()=>randomBytes(32).toString('hex');
async function revision(tx:TransactionExecutor,account:string,actor:string,version:number,methods:string[]=['cash'],key=digest(),franchise=A) {
 const id=randomUUID();
 await tx.query(`INSERT INTO shipit.receiving_account_revisions
 (id,organization_id,franchise_id,account_id,version,name,methods,other_method_name,active,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,$4,$5,'Synthetic front counter',$6,$7,$8,$9,$10,$11,$12)`,
 [id,org,franchise,account,version,methods,methods.includes('other')?'Synthetic cheque':null,version===1,actor,randomUUID(),key,digest()]);return id;
}
await test('receiving accounts serialize immutable revisions, protect owner links and commit safe audit together',{timeout:30000},async t=>{
 const s=await auditSetup(t),owner=s.db.ownerPool(),account=randomUUID();
 const first=await withTransaction(owner,async tx=>{
  await tx.query('INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id) VALUES($1,$2,$3)',[account,org,A]);
  return revision(tx,account,s.admin.id,1);
 });
 const before=(await owner.query('SELECT * FROM shipit.receiving_account_revisions WHERE id=$1',[first])).rows[0]!;
 assert.equal(before.version,1);assert.deepEqual(before.methods,['cash']);assert.ok(before.recorded_at instanceof Date);
 const concurrent=await Promise.allSettled([withTransaction(owner,tx=>revision(tx,account,s.admin.id,2)),withTransaction(owner,tx=>revision(tx,account,s.admin.id,2))]);
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
 assert.deepEqual((await owner.query('SELECT * FROM shipit.receiving_account_revisions WHERE id=$1',[first])).rows[0],before);
 const audit=(await owner.query('SELECT * FROM shipit.receiving_account_audit_events WHERE account_id=$1 ORDER BY version',[account])).rows;
 assert.equal(audit.length,2);assert.equal(audit[0]!.id,first);assert.equal(audit[0]!.actor_id,s.admin.id);assert.equal(audit[0]!.occurred_at.toISOString(),before.recorded_at.toISOString());
 assert.ok(audit.every(row=>!Object.hasOwn(row,'name')&&!Object.hasOwn(row,'methods')&&!Object.hasOwn(row,'fingerprint')));
 for(const sql of ['UPDATE shipit.receiving_accounts SET id=id','DELETE FROM shipit.receiving_account_revisions','UPDATE shipit.receiving_account_audit_events SET version=version'])await assert.rejects(owner.query(sql));
 for(const methods of [['cash','upi'],['upi','upi'],['credit'],['upi','card'],['other',null],[]])await assert.rejects(withTransaction(owner,tx=>revision(tx,account,s.admin.id,3,methods as string[])));
 await assert.rejects(withTransaction(owner,tx=>revision(tx,account,s.admin.id,3,['cash'],digest(),B)));
 const duplicateKey=digest();await withTransaction(owner,tx=>revision(tx,account,s.admin.id,3,['card','other','upi'],duplicateKey));
 await assert.rejects(withTransaction(owner,tx=>revision(tx,account,s.admin.id,4,['cash'],duplicateKey)));
 const orphan=randomUUID();await assert.rejects(withTransaction(owner,async tx=>{await tx.query('INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id) VALUES($1,$2,$3)',[orphan,org,A]);}));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.receiving_accounts WHERE id=$1',[orphan])).rows[0]!.n,0);
 assert.equal((await owner.query("SELECT count(*)::int n FROM shipit.audit_history WHERE action='receiving_accounts.configure' AND resource_id=$1",[account])).rows[0]!.n,3);
 await assert.rejects(s.pool.query('SELECT * FROM shipit.receiving_account_revisions'));
 await assert.rejects(s.pool.query('INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id) VALUES($1,$2,$3)',[randomUUID(),org,A]));
});
await test('pre-138 populated upgrade preserves legacy collections, replay results and unknown receiving evidence',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:43}),{applied:43});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db);await db.preparePayments();
 const booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id;
 const payment=createPaymentService(s.pool),key=randomUUID(),input=collectionInput(100);
 const paid=await payment.execute(s.local.token,booking,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],input,'payments.collect',randomUUID());
 await db.prepareReceipts();const documents=createReceiptService(s.pool),q={organization_id:org,franchise_id:A};
 const acknowledgement=await documents.read(s.local.token,booking,paid.entry.id,q,randomUUID());assert.equal(acknowledgement.schema_version,1);assert.ok(!('allocation_source' in acknowledgement));
 const snapshot=async()=>({entries:(await db.adminQuery('SELECT * FROM shipit.payment_entries')).rows,commands:(await db.adminQuery('SELECT * FROM shipit.payment_commands')).rows.map(({receipt_command_id:_r,...row})=>row),
  obligations:(await db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,bookings:(await db.adminQuery('SELECT * FROM shipit.bookings')).rows,
  issued:(await db.adminQuery('SELECT * FROM shipit.issued_receipts ORDER BY id')).rows,
  events:(await db.adminQuery('SELECT * FROM shipit.domain_events ORDER BY event_id')).rows.map(({money_receipt_id:_r,money_receipt_command_id:_c,...row})=>row)});
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
 assert.equal((await db.adminQuery('SELECT bool_and(receipt_command_id IS NULL) unknown FROM shipit.payment_commands')).rows[0]!.unknown,true);
 assert.deepEqual(await payment.execute(s.local.token,booking,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],input,'payments.collect',randomUUID()),paid);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.receiving_accounts')).rows[0]!.n,0);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.receiving_account_revisions')).rows[0]!.n,0);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,0);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.domain_events WHERE money_receipt_id IS NOT NULL OR money_receipt_command_id IS NOT NULL')).rows[0]!.n,0);
 assert.deepEqual(await documents.read(s.local.token,booking,paid.entry.id,q,randomUUID()),acknowledgement);
 assert.deepEqual(await documents.readId(s.local.token,acknowledgement.id,q,randomUUID()),acknowledgement);
});
