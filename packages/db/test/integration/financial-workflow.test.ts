import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withTransaction,type TransactionExecutor} from '../../src/index.ts';
import {provisionDatabase} from '../support.ts';
import {bookingSetup} from '../../../../apps/api/test/booking-support.ts';
import {org,A,B} from '../../../../apps/api/test/audit-support.ts';
import {createPaymentService} from '../../../../apps/api/src/modules/payments/service.ts';
import {collectionInput} from '../../../../apps/api/test/payment-support.ts';
const digest=()=>randomBytes(32).toString('hex');
async function policy(tx:TransactionExecutor,actor:string,version=1,threshold:number|null=null) {
 const id=randomUUID();await tx.query(`INSERT INTO shipit.financial_policy_revisions
 (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,$4,$5,false,true,$6,$7,$8,$9)`,[id,org,A,version,threshold,actor,randomUUID(),digest(),digest()]);return id;
}
async function request(tx:TransactionExecutor,booking:string,actor:string,policyId:string|null,franchise=A) {
 const id=randomUUID();await tx.query(`INSERT INTO shipit.financial_adjustment_requests
 (id,organization_id,franchise_id,booking_id,actor_id,policy_id,expected_financial_version,expected_payment_version,kind,reason,pre_tax,taxable,cgst,sgst,igst,rounding,refund,key_digest,fingerprint,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,0,0,'discount','customer_agreement',1,1,0,0,0,0,0,$7,$8,$9)`,[id,org,franchise,booking,actor,policyId,digest(),digest(),randomUUID()]);return id;
}
async function decide(tx:TransactionExecutor,requestId:string,actor:string,outcome='approved',change:string|null=null) {
 const id=randomUUID();await tx.query(`INSERT INTO shipit.financial_request_decisions
 (id,organization_id,franchise_id,request_id,actor_id,version,outcome,financial_change_id,reason,key_digest,fingerprint,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,org,A,requestId,actor,outcome==='applied'?2:1,outcome,change,outcome==='applied'?'approved_change_applied':outcome==='rejected'?'review_rejected':'review_approved',digest(),digest(),randomUUID()]);return id;
}
await test('financial requests preserve scoped source, policy and distinct approval with matching immutable applied effect',{timeout:60000},async t=>{
 const s=await bookingSetup(t),owner=s.db.ownerPool(),booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id;
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_policy_revisions')).rows[0]!.n,0);
 const noPolicy=await withTransaction(owner,tx=>request(tx,booking,s.operator.id,null));
 await assert.rejects(withTransaction(owner,tx=>decide(tx,noPolicy,s.local.id)));
 await withTransaction(owner,tx=>decide(tx,noPolicy,s.local.id,'rejected'));
 const p=await withTransaction(owner,tx=>policy(tx,s.local.id));
 await assert.rejects(withTransaction(owner,tx=>policy(tx,s.local.id,1)));
 await assert.rejects(withTransaction(owner,tx=>policy(tx,s.local.id,2,-1)));
 await assert.rejects(withTransaction(owner,tx=>request(tx,booking,s.operator.id,p,B)));
 await assert.rejects(withTransaction(owner,tx=>request(tx,booking,s.operator.id,null)));
 const own=await withTransaction(owner,tx=>request(tx,booking,s.local.id,p));
 await assert.rejects(withTransaction(owner,tx=>decide(tx,own,s.local.id)));
 const pending=await withTransaction(owner,tx=>request(tx,booking,s.operator.id,p));
 const races=await Promise.allSettled([withTransaction(owner,tx=>decide(tx,pending,s.local.id)),withTransaction(owner,tx=>decide(tx,pending,s.local.id))]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.filter(r=>r.status==='rejected').length,1);
 const change=randomUUID();await withTransaction(owner,async tx=>{
  await tx.query(`INSERT INTO shipit.financial_changes
  (id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,pre_tax,taxable,correlation_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,1,0,'discount','customer_agreement',$8,1,1,$9)`,[change,org,A,booking,s.local.id,digest(),digest(),pending,randomUUID()]);
  await decide(tx,pending,s.local.id,'applied',change);
 });
 const history=(await owner.query('SELECT version,outcome,financial_change_id FROM shipit.financial_request_decisions WHERE request_id=$1 ORDER BY version',[pending])).rows;
 assert.deepEqual(history.map(r=>r.outcome),['approved','applied']);assert.equal(history[1]!.financial_change_id,change);
 await assert.rejects(withTransaction(owner,tx=>decide(tx,pending,s.local.id,'applied',change)));
 await assert.rejects(withTransaction(owner,tx=>decide(tx,own,s.operator.id)));
 for(const table of ['financial_policy_revisions','financial_adjustment_requests','financial_request_decisions']) {
  await assert.rejects(owner.query(`UPDATE shipit.${table} SET id=id`));await assert.rejects(owner.query(`DELETE FROM shipit.${table}`));
  await assert.rejects(s.pool.query(`SELECT * FROM shipit.${table}`));
 }
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,1);
});
await test('populated pre-139 upgrade preserves original financial evidence without seeded policies or synthetic requests',{timeout:60000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:44}),{applied:44});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201);
 const booking=booked.json().id,owner=db.ownerPool();await db.preparePayments();
 const bookedSource=(await db.adminQuery('SELECT final_payable_paise FROM shipit.bookings WHERE id=$1',[booking])).rows[0]!;
 const key=randomUUID();await createPaymentService(s.pool).execute(s.local.token,booking,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],collectionInput(Number(bookedSource.final_payable_paise)),'payments.collect',randomUUID());
 await withTransaction(owner,tx=>tx.query(`INSERT INTO shipit.financial_changes
 (id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,pre_tax,taxable,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,1,1,'discount','customer_agreement','SYN_PRE_UPGRADE',100,100,$8)`,[randomUUID(),org,A,booking,s.local.id,digest(),digest(),randomUUID()]));
 const snapshot=async()=>({bookings:(await db.adminQuery('SELECT * FROM shipit.bookings ORDER BY id')).rows,obligations:(await db.adminQuery('SELECT * FROM shipit.booking_obligations ORDER BY id')).rows,
  changes:(await db.adminQuery("SELECT to_jsonb(c)-'refund_correction_of' AS original FROM shipit.financial_changes c ORDER BY id")).rows,entries:(await db.adminQuery('SELECT * FROM shipit.payment_entries ORDER BY id')).rows});
 const before=await snapshot();assert.equal(before.changes.length,1);assert.equal(before.entries.length,1);db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);assert.equal((await db.adminQuery('SELECT refund_correction_of FROM shipit.financial_changes')).rows[0]!.refund_correction_of,null);
 for(const table of ['financial_policy_revisions','financial_adjustment_requests','financial_request_decisions','financial_refund_evidence','financial_deletion_denials','financial_document_links'])assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);
});
