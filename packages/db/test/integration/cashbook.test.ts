import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {withTransaction,type TransactionExecutor} from '../../src/index.ts';
import {provisionDatabase} from '../support.ts';
import {auditSetup,org,A,B} from '../../../../apps/api/test/audit-support.ts';
import {paymentSetup,collectionInput} from '../../../../apps/api/test/payment-support.ts';
import {createPaymentService} from '../../../../apps/api/src/modules/payments/service.ts';
import {createReceivingAccountService} from '../../../../apps/api/src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../../../../apps/api/src/modules/payments/receipt-service.ts';
import {createFinancialWorkflowService} from '../../../../apps/api/src/modules/reports/finance-workflow-service.ts';
import {createFinanceService} from '../../../../apps/api/src/modules/reports/finance-service.ts';
import {withFinancialScope} from '../../../../apps/api/src/modules/memberships/service.ts';
import {assertTenantAccess,scopedQuery} from '../../../../apps/api/src/modules/security/scope.ts';
import * as finance from '../../../../apps/api/src/modules/reports/finance-repository.ts';
import * as workflow from '../../../../apps/api/src/modules/reports/finance-workflow-repository.ts';
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
 // Populated released booking attachment metadata, command and audits must retain their original tuple.
 const evidenceId=randomUUID(),evidenceKey='d'.repeat(64),evidenceNow=new Date().toISOString();
 await db.adminQuery(`INSERT INTO shipit.attachments(id,organization_id,franchise_id,booking_id,purpose,kind,object_key,declared_size,declared_type,expected_digest,retention_class,initiated_actor,actor_type,actor_id,correlation_id,created_at,upload_expires_at,cleanup_due_at)
 VALUES($1,$2,$3,$4,'shipment_evidence','image',$5,10,'image/png',$6,'operational_evidence',$7::uuid,'user',$7::text,$8,$9,$9::timestamptz+interval '15 minutes',$9::timestamptz+interval '30 minutes')`,[evidenceId,org,A,s.bookingId,'evidence/'+evidenceId,'a'.repeat(64),s.operator.id,randomUUID(),evidenceNow]);
 await db.adminQuery("UPDATE shipit.attachments SET state='quarantined',uploaded_at=clock_timestamp(),version=version+1 WHERE id=$1",[evidenceId]);
 await db.adminQuery("UPDATE shipit.attachments SET state='ready',scan_state='clean',actual_size=10,detected_type='image/png',digest=expected_digest,validated_at=clock_timestamp(),linked_at=clock_timestamp(),cleanup_due_at=NULL,version=version+1 WHERE id=$1",[evidenceId]);
 await db.adminQuery(`INSERT INTO shipit.attachment_commands(id,organization_id,franchise_id,booking_id,attachment_id,principal_id,operation,key_digest,fingerprint,result,created_at) VALUES($1,$2,$3,$4,$5,$6,'grant',$7,$8,$9,$10)`,[randomUUID(),org,A,s.bookingId,evidenceId,s.operator.id,evidenceKey,'e'.repeat(64),{url:'/synthetic-retained-booking-grant',expires_at:evidenceNow},evidenceNow]);
 const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','booking_obligations','payment_entries','payment_commands','domain_events','attachments','attachment_commands','attachment_audit_events'].map(async table=>[table,(await db.adminQuery(`SELECT to_jsonb(t)-'expense_request_id' AS row FROM shipit.${table} t ORDER BY 1`)).rows])));
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
 for(const table of ['cash_locations','cash_location_revisions','cashbook_source_versions','cashbook_requests','cashbook_request_decisions','cashbook_effects','cashbook_effect_legs','cash_handovers','cash_handover_commands','cash_handover_legs'])assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);
 assert.deepEqual(await payment.execute(s.local.token,s.bookingId,null,q,key,headers(key),input,'payments.collect',randomUUID()),paid);
 const sources=async()=>(await db.adminQuery('SELECT source_kind,location_id,account_id,direction,amount_paise::text amount,unknown_reason FROM shipit.cashbook_source_facts ORDER BY recorded_at,source_id')).rows;
 assert.deepEqual(await sources(),[{source_kind:'legacy_collection',location_id:null,account_id:null,direction:'in',amount:'20000',unknown_reason:'legacy_collection_custody_unknown'}]);
 const correctionKey=randomUUID();await payment.execute(s.local.token,s.bookingId,paid.entry.id,q,correctionKey,headers(correctionKey),{amount_paise:5000,currency:'INR',reason_code:'incorrect_amount'},'payments.reverse',randomUUID());
 assert.equal((await db.adminQuery('SELECT version::text v FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.v,'1');
 const after=await sources();assert.equal(after.length,2);assert.ok(after.every(row=>row.location_id===null&&row.account_id===null));assert.equal(after.reduce((sum,row)=>sum+(row.direction==='in'?1n:-1n)*BigInt(row.amount as string),0n),15000n);
 assert.equal(after.find(row=>row.source_kind==='legacy_collection_correction')!.direction,'out');

});

await test('pre-140 refund upgrade preserves original evidence and exact retained apply retry without inventing custody',{timeout:60000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:45}),{applied:45});const migrate=db.migrate;db.migrate=async()=>({applied:0});
 const s=await paymentSetup(t,50000,db);await db.prepareReceivingAccounts();const owner=db.ownerPool();
 await owner.query(`GRANT SELECT,INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_refund_evidence,shipit.financial_document_links TO "${db.runtimeRole}"`);
 const service=createFinancialWorkflowService(s.pool,true),policyKey=randomUUID();
 await service.configurePolicy(s.local.token,q,policyKey,headers(policyKey),{expected_version:0,enabled:true,discount_review_threshold_paise:null,allow_self_approval:false},randomUUID());
 const collectionKey=randomUUID();await createPaymentService(s.pool).execute(s.local.token,s.bookingId,null,q,collectionKey,headers(collectionKey),collectionInput(50000),'payments.collect',randomUUID());
 const proposal=async(body:unknown)=>{const key=randomUUID(),r=await service.request(s.operator.token,q,key,headers(key),body,randomUUID()),decisionKey=randomUUID();
  await service.decide(s.local.token,q,r.id,decisionKey,headers(decisionKey),{expected_version:0,outcome:'approved'},randomUUID());return r.id;};
 const current=await createFinanceService(s.pool).read(s.local.token,q,s.bookingId,randomUUID());
 const cancellation=await proposal({booking_id:s.bookingId,expected_version:0,payment_version:1,kind:'cancellation',reason:'booking_cancelled',pre_tax:Number(current.pre_tax),taxable:Number(current.taxable),cgst:Number(current.cgst),sgst:Number(current.sgst),igst:Number(current.igst),rounding:Number(current.rounding)}),cancelKey=randomUUID();
 await service.apply(s.local.token,q,cancellation,cancelKey,headers(cancelKey),{expected_version:1},randomUUID());
 const accountKey=randomUUID(),a=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic old refund source',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const request=await proposal({booking_id:s.bookingId,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',refund:5000});
 // Reproduce the released #139 writer's column list and caller-intent digest on actual migration 45.
 // The current writer includes the new columns, so invoking it here would not test an old populated source.
 const evidence={account_id:a.id,expected_account_version:1,method:'cash',occurred_at:'2026-01-01T00:00:00Z',returned_to_ref:'SYN_OLD_BENEFICIARY',transfer_ref:'SYN_PRE140_REFUND'},key=randomUUID();
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex'),keyDigest=digest('financial.apply:'+key),fingerprint=digest(JSON.stringify({id:request,expected:1,evidence})),change=randomUUID();
 const applied=await withFinancialScope(s.pool,s.local.token,org,A,'finance.apply',randomUUID(),async scope=>{
  await finance.lock(scope);await finance.append(scope,change,keyDigest,fingerprint,{booking_id:s.bookingId,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',pre_tax:0,taxable:0,cgst:0,sgst:0,igst:0,rounding:0,refund:5000,approval_ref:request,returned_to_ref:evidence.returned_to_ref});
  const c=assertTenantAccess(scope,['finance.apply']);await scopedQuery(scope,['finance.apply'],`INSERT INTO shipit.financial_refund_evidence
  (id,organization_id,franchise_id,request_id,actor_id,source_account_id,source_revision_id,method,occurred_at,returned_to_ref,transfer_ref)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,[change,A,request,c.actor.id,a.id,a.revision_id,evidence.method,evidence.occurred_at,evidence.returned_to_ref,evidence.transfer_ref,org]);
  return workflow.appendApplied(scope,keyDigest,fingerprint,request,change);
 });
 const oldEvidence=(await owner.query('SELECT * FROM shipit.financial_refund_evidence WHERE id=$1',[change])).rows[0]!;
 const snapshot=async()=>Object.fromEntries(await Promise.all(['financial_changes','financial_adjustment_requests','financial_request_decisions','payment_entries','bookings'].map(async table=>[table,(await owner.query(`SELECT * FROM shipit.${table} ORDER BY 1`)).rows])));
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});
 const after=(await owner.query('SELECT * FROM shipit.financial_refund_evidence WHERE id=$1',[change])).rows[0]!;
 assert.deepEqual(Object.fromEntries(Object.keys(oldEvidence).map(field=>[field,after[field]])),oldEvidence);assert.equal(after.cash_location_id,null);assert.equal(after.cash_location_revision_id,null);assert.deepEqual(await snapshot(),before);
 for(const table of ['cash_locations','cash_location_revisions','cashbook_source_versions','cashbook_requests','cashbook_request_decisions','cashbook_effects','cashbook_effect_legs','cash_handovers','cash_handover_commands','cash_handover_legs'])assert.equal((await owner.query(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);
 assert.deepEqual((await owner.query("SELECT location_id,account_id,direction,amount_paise::text amount,unknown_reason FROM shipit.cashbook_source_facts WHERE source_kind='refund' AND source_id=$1",[change])).rows,[{location_id:null,account_id:a.id,direction:'out',amount:'5000',unknown_reason:'cash_refund_custody_unknown'}]);
 // Current cashbook enforcement is enabled, while financial writes are disabled: retained retries must still return the old result.
 const upgraded=createFinancialWorkflowService(s.pool,false,true);
 assert.deepEqual(await upgraded.apply(s.local.token,q,request,key,headers(key),{expected_version:1,refund_evidence:evidence},randomUUID()),applied);
 await assert.rejects(upgraded.apply(s.local.token,q,request,key,headers(key),{expected_version:1,refund_evidence:{...evidence,transfer_ref:'SYN_CHANGED'}},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 assert.deepEqual(await snapshot(),before);assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_refund_evidence WHERE id=$1',[change])).rows[0],after);
 await assert.rejects(owner.query('UPDATE shipit.financial_refund_evidence SET cash_location_id=cash_location_id WHERE id=$1',[change]));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.cashbook_source_versions')).rows[0]!.n,0);
});
