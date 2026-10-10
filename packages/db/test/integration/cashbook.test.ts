import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withTransaction,type TransactionExecutor} from '../../src/index.ts';
import {provisionDatabase} from '../support.ts';
import {auditSetup,org,A,B} from '../../../../apps/api/test/audit-support.ts';
import {paymentSetup,collectionInput} from '../../../../apps/api/test/payment-support.ts';
import {createPaymentService} from '../../../../apps/api/src/modules/payments/service.ts';
import {createReceivingAccountService} from '../../../../apps/api/src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../../../../apps/api/src/modules/payments/receipt-service.ts';
const hash=()=>randomBytes(32).toString('hex'),headers=(key:string)=>['idempotency-key',key],q={organization_id:org,franchise_id:A};
async function account(tx:TransactionExecutor,actor:string,methods:string[]=['cash']) {
 const id=randomUUID(),revision=randomUUID();await tx.query('INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id) VALUES($1,$2,$3)',[id,org,A]);
 await tx.query(`INSERT INTO shipit.receiving_account_revisions(id,organization_id,franchise_id,account_id,version,name,methods,active,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,$4,1,'Synthetic receiving account',$5,true,$6,$7,$8,$9)`,[revision,org,A,id,methods,actor,randomUUID(),hash(),hash()]);return {id,revision};
}
async function locationRevision(tx:TransactionExecutor,location:string,a:{id:string;revision:string},actor:string,version=1,active=true) {
 const id=randomUUID();await tx.query(`INSERT INTO shipit.cash_location_revisions
 (id,organization_id,franchise_id,location_id,account_id,account_revision_id,version,name,active,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,$4,$5,$6,$7,'Synthetic drawer',$8,$9,$10,$11,$12)`,[id,org,A,location,a.id,a.revision,version,active,actor,randomUUID(),hash(),hash()]);return id;
}
await test('cash locations enforce immutable scoped account/custodian/current revisions and prohibit fabricated source versions',{timeout:30000},async t=>{
 const s=await auditSetup(t),admin=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]),sibling=await s.grant('operator',[B]),owner=s.db.ownerPool();
 const a=await withTransaction(owner,tx=>account(tx,admin.id)),location=randomUUID();
 const add=(custodian:string|null,kind='cash',actor=admin.id,id=randomUUID())=>withTransaction(owner,async tx=>{
  await tx.query('INSERT INTO shipit.cash_locations(id,organization_id,franchise_id,account_id,kind,custodian_id) VALUES($1,$2,$3,$4,$5,$6)',[id,org,A,a.id,kind,custodian]);return locationRevision(tx,id,a,actor);
 });
 const revision=await add(operator.id,'cash',admin.id,location),before=(await owner.query('SELECT * FROM shipit.cash_location_revisions WHERE id=$1',[revision])).rows[0];
 assert.ok(before,'Committed revision must exist');
 assert.equal(before.version,1);assert.ok(before.recorded_at instanceof Date);assert.equal((await owner.query('SELECT version::text v FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.v,'1');
 await assert.rejects(add(operator.id));await assert.rejects(add(sibling.id));await assert.rejects(add(null,'noncash'));await assert.rejects(add(admin.id,'cash',operator.id));await assert.rejects(add(admin.id,'cash',s.admin.id));
 const attempts=await Promise.allSettled([withTransaction(owner,tx=>locationRevision(tx,location,a,admin.id,2)),withTransaction(owner,tx=>locationRevision(tx,location,a,admin.id,2))]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
 assert.deepEqual((await owner.query('SELECT * FROM shipit.cash_location_revisions WHERE id=$1',[revision])).rows[0],before);
 assert.equal((await owner.query('SELECT version::text v FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.v,'2');
 for(const sql of ['UPDATE shipit.cash_locations SET id=id','DELETE FROM shipit.cash_location_revisions','UPDATE shipit.cash_location_revisions SET version=version','UPDATE shipit.cashbook_source_versions SET version=version+1','DELETE FROM shipit.cashbook_source_versions'])await assert.rejects(owner.query(sql));
 await assert.rejects(owner.query('INSERT INTO shipit.cashbook_source_versions VALUES($1,$2,1)',[org,B]));
 const orphan=randomUUID();await assert.rejects(withTransaction(owner,async tx=>{await tx.query('INSERT INTO shipit.cash_locations(id,organization_id,franchise_id,account_id,kind,custodian_id) VALUES($1,$2,$3,$4,$5,$6)',[orphan,org,A,a.id,'cash',admin.id]);}));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.cash_locations WHERE id=$1',[orphan])).rows[0]!.n,0);
 await assert.rejects(s.pool.query('SELECT * FROM shipit.cash_locations'));await assert.rejects(s.pool.query('UPDATE shipit.cashbook_source_versions SET version=version+1'));
 // Revoked custodians cannot receive new active assignments, but an admin can append deactivation.
 await s.memberships.revokeMembership(s.admin.token,operator.member.id,{expected_version:operator.member.version});
 await assert.rejects(withTransaction(owner,tx=>locationRevision(tx,location,a,admin.id,3,true)));
 await withTransaction(owner,tx=>locationRevision(tx,location,a,admin.id,3,false));
 assert.deepEqual((await owner.query('SELECT * FROM shipit.cash_location_revisions WHERE id=$1',[revision])).rows[0],before);
});
await test('actual receipt increments custody source once; allocation release and exact replay cannot fabricate a second cash inflow/version',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareMoneyReceipts();const accounts=createReceivingAccountService(s.pool),service=createMoneyReceiptService(s.pool);
 const key=randomUUID(),a=await accounts.configure(s.local.token,null,q,key,headers(key),{name:'Synthetic cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const occurred=(await s.db.adminQuery("SELECT clock_timestamp()-interval '1 second' t")).rows[0]!.t.toISOString();
 const body={customer_id:s.source.id,account_id:a.id,expected_account_version:1,amount_paise:40000,currency:'INR',method:'cash',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:occurred,external_reference:null,allocations:[{booking_id:s.bookingId,amount_paise:40000,context:'to_pay',expected_payment_version:0}]};
 const receiptKey=randomUUID(),saved=await service.record(s.operator.token,q,receiptKey,headers(receiptKey),body,randomUUID());
 const version=async()=>(await s.db.adminQuery('SELECT version::text v FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.v;
 assert.equal(await version(),'1');assert.deepEqual(await service.record(s.operator.token,q,receiptKey,headers(receiptKey),body,randomUUID()),saved);assert.equal(await version(),'1');
 const correctionKey=randomUUID(),corrected=await service.correct(s.local.token,saved.receipt_id,q,correctionKey,headers(correctionKey),{expected_version:1,allocation_id:saved.allocations[0]!.id,amount_paise:10000,currency:'INR',reason_code:'incorrect_amount'},randomUUID());
 assert.equal(corrected.received_paise,40000);assert.equal(corrected.allocated_paise,30000);assert.equal(corrected.unallocated_paise,10000);assert.equal(await version(),'1');
 const badKey=randomUUID();await assert.rejects(service.record(s.operator.token,q,badKey,headers(badKey),{...body,allocations:[],occurred_at:'2099-01-01T00:00:00.000Z'},randomUUID()),{code:'VALIDATION_FAILED'});
 assert.equal(await version(),'1');assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,1);
 const nextKey=randomUUID();await service.record(s.operator.token,q,nextKey,headers(nextKey),{...body,amount_paise:1,allocations:[]},randomUUID());assert.equal(await version(),'2');
});
await test('populated pre-140 upgrade retains all collection evidence and creates no drawer, opening or inferred custody',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:45}),{applied:45});const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await paymentSetup(t,50000,db);
 const payment=createPaymentService(s.pool),key=randomUUID(),input=collectionInput(20000),paid=await payment.execute(s.local.token,s.bookingId,null,q,key,headers(key),input,'payments.collect',randomUUID());
 const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','booking_obligations','payment_entries','payment_commands','domain_events'].map(async table=>[table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY 1`)).rows])));
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
 for(const table of ['cash_locations','cash_location_revisions','cashbook_source_versions'])assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);
 assert.deepEqual(await payment.execute(s.local.token,s.bookingId,null,q,key,headers(key),input,'payments.collect',randomUUID()),paid);
});
