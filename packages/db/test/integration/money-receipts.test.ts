import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withTransaction,type TransactionExecutor} from '../../src/index.ts';
import {bookingSetup} from '../../../../apps/api/test/booking-support.ts';
import {createReceivingAccountService} from '../../../../apps/api/src/modules/payments/account-service.ts';
import {createReceiptService} from '../../../../apps/api/src/modules/receipts/service.ts';
import {createPaymentService} from '../../../../apps/api/src/modules/payments/service.ts';
import {org,A} from '../../../../apps/api/test/audit-support.ts';
import type {MoneyReceiptInput,ReceiptAllocationInput} from '../../../shared/src/index.ts';
const digest=()=>randomBytes(32).toString('hex');
type Parent={id:string;receipt_id:string;principal_id:string;correlation_id:string;recorded_at:Date;version:number};
async function reserve(tx:TransactionExecutor,actor:string,receipt:string,version:number,input:unknown,kind='record'):Promise<Parent> {
 return (await tx.query<Parent>(`INSERT INTO shipit.money_receipt_commands
 (id,organization_id,franchise_id,receipt_id,principal_id,operation_id,version,key_digest,fingerprint,input,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[randomUUID(),org,A,receipt,actor,'api.v1.money_receipts.'+kind,version,digest(),digest(),input,randomUUID()])).rows[0]!;
}
async function source(tx:TransactionExecutor,p:Parent,accountRevision:string,b:MoneyReceiptInput) {
 await tx.query(`INSERT INTO shipit.money_receipts(id,organization_id,franchise_id,command_id,customer_id,account_id,account_revision_id,
 amount_paise,currency,method,receiver_id,initial_custodian_id,occurred_at,external_reference)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[p.receipt_id,org,A,p.id,b.customer_id,b.account_id,accountRevision,b.amount_paise,b.currency,b.method,b.receiver_id,b.custodian_id,b.occurred_at,b.external_reference]);
}
async function leaf(tx:TransactionExecutor,p:Parent,item:ReceiptAllocationInput,method:string,release:{id:string;payment_entry_id:string}|null=null) {
 const obligation=(await tx.query<{id:string}>(`SELECT id FROM shipit.booking_obligations WHERE organization_id=$1 AND franchise_id=$2 AND booking_id=$3 FOR UPDATE`,[org,A,item.booking_id])).rows[0]!.id;
 const command=randomUUID(),entry=randomUUID(),link=randomUUID(),reference=randomUUID();
 const input=release?{amount_paise:item.amount_paise,currency:'INR',reason_code:'incorrect_amount'}:{amount_paise:item.amount_paise,currency:'INR',context:item.context,method,collection_reference:reference};
 await tx.query(`INSERT INTO shipit.payment_commands(id,organization_id,franchise_id,booking_id,obligation_id,principal_id,operation_id,key_digest,fingerprint,input,reversal_of,correlation_id,occurred_at,receipt_command_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[command,org,A,item.booking_id,obligation,p.principal_id,release?'api.v1.payments.reverse':'api.v1.payments.collect',digest(),digest(),input,release?.payment_entry_id??null,p.correlation_id,p.recorded_at,p.id]);
 await tx.query(`INSERT INTO shipit.payment_entries(id,organization_id,franchise_id,booking_id,obligation_id,command_id,kind,amount_paise,currency,context,method,collection_reference,reversal_of,reason_code,sequence,actor_id,correlation_id,occurred_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,'INR',$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[entry,org,A,item.booking_id,obligation,command,release?'reversal':'collection',item.amount_paise,item.context,method,release?null:reference,release?.payment_entry_id??null,release?'incorrect_amount':null,item.expected_payment_version+1,p.principal_id,p.correlation_id,p.recorded_at]);
 await tx.query(`INSERT INTO shipit.money_receipt_allocations(id,organization_id,franchise_id,receipt_id,command_id,command_version,booking_id,obligation_id,payment_entry_id,kind,amount_paise,release_of)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[link,org,A,p.receipt_id,p.id,p.version,item.booking_id,obligation,entry,release?'release':'allocation',item.amount_paise,release?.id??null]);
 await tx.query('SELECT shipit.append_payment_audit($1,$2,$3,$4,$5)',[org,A,item.booking_id,command,entry]);
 await tx.query(`UPDATE shipit.payment_commands SET state='committed',entry_id=$2,http_status=200,result=shipit.payment_result(organization_id,franchise_id,$2),committed_at=clock_timestamp(),retain_until='infinity' WHERE id=$1`,[command,entry]);
 return {id:link,payment_entry_id:entry};
}
async function finish(tx:TransactionExecutor,p:Parent) {
 return (await tx.query<{result:{received_paise:number;allocated_paise:number;unallocated_paise:number;allocations:unknown[]}}>(`UPDATE shipit.money_receipt_commands SET state='committed',result=shipit.money_receipt_result(organization_id,franchise_id,id),committed_at=clock_timestamp() WHERE id=$1 RETURNING result`,[p.id])).rows[0]!.result;
}
await test('receipt source conserves one inflow through multi-bill allocation and paired release; legacy reversal cannot bypass source',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.preparePayments();await s.db.prepareReceivingAccounts();const owner=s.db.ownerPool();
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,{organization_id:org,franchise_id:A},'account',['idempotency-key','account'],{name:'Synthetic card clearing',methods:['card'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const one=await s.book(),two=await s.book();assert.equal(one.statusCode,201);assert.equal(two.statusCode,201);
 const receipt=randomUUID(),items:ReceiptAllocationInput[]=[{booking_id:one.json().id,amount_paise:100,context:'to_pay',expected_payment_version:0},{booking_id:two.json().id,amount_paise:200,context:'to_pay',expected_payment_version:0}];
 const b:MoneyReceiptInput={customer_id:s.source.id,account_id:account.id,expected_account_version:1,method:'card',amount_paise:1000,currency:'INR',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:'SYNTHETIC-CARD-TXN',allocations:items};
 const recorded=await withTransaction(owner,async tx=>{const p=await reserve(tx,s.operator.id,receipt,1,b);await source(tx,p,account.revision_id,b);const links=[];for(const item of items)links.push(await leaf(tx,p,item,'card'));return {parent:p,links,result:await finish(tx,p)};});
 assert.deepEqual({received:recorded.result.received_paise,applied:recorded.result.allocated_paise,advance:recorded.result.unallocated_paise},{received:1000,applied:300,advance:700});
 const original=(await owner.query('SELECT * FROM shipit.money_receipts WHERE id=$1',[receipt])).rows[0]!;
 assert.equal(original.external_reference,'SYNTHETIC-CARD-TXN');assert.equal(original.recorded_at.toISOString(),recorded.parent.recorded_at.toISOString());assert.notEqual(original.occurred_at.toISOString(),original.recorded_at.toISOString());
 const link=recorded.links[0]!;await s.db.prepareReceipts();const documents=createReceiptService(s.pool),q={organization_id:org,franchise_id:A};
 const acknowledgement=await documents.read(s.local.token,items[0]!.booking_id,link.payment_entry_id,q,randomUUID());
 assert.equal(acknowledgement.schema_version,2);assert.equal(acknowledgement.kind,'collection_acknowledgement');
 assert.ok('allocation_source' in acknowledgement);if(!('allocation_source' in acknowledgement))throw new Error('Missing allocation source');
 assert.equal(acknowledgement.allocation_source!.receipt_id,receipt);assert.equal(acknowledgement.allocation_source!.allocation_id,link.id);
 assert.ok(!/SYNTHETIC-CARD-TXN|external_reference|receiver_id|custodian_id/.test(JSON.stringify(acknowledgement)));
 const released=await withTransaction(owner,async tx=>{const p=await reserve(tx,s.local.id,receipt,2,{expected_version:1,allocation_id:link.id,amount_paise:50,currency:'INR',reason_code:'incorrect_amount'},'correct');await leaf(tx,p,{...items[0]!,amount_paise:50,expected_payment_version:1},'card',link);return finish(tx,p);});
 const correctionEntry=(await owner.query<{payment_entry_id:string}>("SELECT payment_entry_id FROM shipit.money_receipt_allocations WHERE receipt_id=$1 AND kind='release'",[receipt])).rows[0]!.payment_entry_id;
 const correction=await documents.read(s.local.token,items[0]!.booking_id,correctionEntry,q,randomUUID());assert.equal(correction.schema_version,2);assert.equal(correction.kind,'collection_reversal');
 assert.ok('allocation_source' in correction&&correction.allocation_source?.kind==='release');
 assert.deepEqual(await documents.read(s.local.token,items[0]!.booking_id,link.payment_entry_id,q,randomUUID()),acknowledgement);
 assert.equal(released.received_paise,1000);assert.equal(released.allocated_paise,250);assert.equal(released.unallocated_paise,750);
 assert.deepEqual((await owner.query('SELECT * FROM shipit.money_receipts WHERE id=$1',[receipt])).rows[0],original);
 assert.deepEqual((await owner.query('SELECT result FROM shipit.money_receipt_commands WHERE id=$1',[recorded.parent.id])).rows[0]!.result,recorded.result);
 const projection=await createPaymentService(s.pool).read(s.local.token,items[0]!.booking_id,{organization_id:org,franchise_id:A},randomUUID());assert.equal(projection.collected_paise,50);assert.equal(projection.version,2);
 const oldReverse=createPaymentService(s.pool);await assert.rejects(oldReverse.execute(s.local.token,items[0]!.booking_id,link.payment_entry_id,{organization_id:org,franchise_id:A},'old-reversal',['idempotency-key','old-reversal'],{amount_paise:1,currency:'INR',reason_code:'incorrect_amount'},'payments.reverse',randomUUID()),{code:'PAYMENT_ALLOCATION_CORRECTION_REQUIRED'});
 await assert.rejects(withTransaction(owner,async tx=>{const p=await reserve(tx,s.operator.id,receipt,3,{expected_version:2,allocations:[{...items[1]!,amount_paise:751,expected_payment_version:1}]},'allocate');await leaf(tx,p,{...items[1]!,amount_paise:751,expected_payment_version:1},'card');await finish(tx,p);}));
 await assert.rejects(withTransaction(owner,async tx=>{await reserve(tx,s.operator.id,receipt,3,{expected_version:2,allocations:[{...items[1]!,expected_payment_version:1}]},'allocate');}));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.money_receipt_commands WHERE receipt_id=$1',[receipt])).rows[0]!.n,2);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.money_receipt_audit_events WHERE receipt_id=$1',[receipt])).rows[0]!.n,2);
 assert.ok(!/SYNTHETIC-CARD-TXN|external_reference|receiver_id|custodian_id/.test(JSON.stringify((await owner.query("SELECT * FROM shipit.audit_history WHERE action LIKE 'money_receipts.%'")).rows)));
 // Last available funds: the receipt row/version lock permits exactly one winner.
 const last={...items[1]!,amount_paise:750,expected_payment_version:1};
 const race=await Promise.allSettled([1,2].map(()=>withTransaction(owner,async tx=>{const p=await reserve(tx,s.operator.id,receipt,3,{expected_version:2,allocations:[last]},'allocate');await leaf(tx,p,last,'card');return finish(tx,p);})));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
 const winner=race.find(r=>r.status==='fulfilled');assert.ok(winner&&winner.status==='fulfilled');assert.equal(winner.value.allocated_paise,1000);assert.equal(winner.value.unallocated_paise,0);
 const net=(await owner.query<{net:string}>("SELECT sum(CASE kind WHEN 'collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END)::text net FROM shipit.payment_entries")).rows[0]!.net;assert.equal(net,'1000');
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,1);
 // A separately held advance adds a receipt, never a bill entry or booked sale.
 const beforeEntries=(await owner.query('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n;
 const advanceInput={...b,external_reference:null,allocations:[]},advance=randomUUID();
 const held=await withTransaction(owner,async tx=>{const p=await reserve(tx,s.operator.id,advance,1,advanceInput);await source(tx,p,account.revision_id,advanceInput);return finish(tx,p);});
 assert.equal(held.received_paise,1000);assert.equal(held.allocated_paise,0);assert.equal(held.unallocated_paise,1000);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n,beforeEntries);
 const futureInput={...advanceInput,occurred_at:new Date(Date.now()+60000).toISOString()};
 await assert.rejects(withTransaction(owner,async tx=>{const p=await reserve(tx,s.operator.id,randomUUID(),1,futureInput);await source(tx,p,account.revision_id,futureInput);await finish(tx,p);}));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,2);
 for(const sql of ['UPDATE shipit.money_receipts SET amount_paise=amount_paise','DELETE FROM shipit.money_receipt_allocations','UPDATE shipit.money_receipt_commands SET fingerprint=fingerprint','DELETE FROM shipit.money_receipt_audit_events'])await assert.rejects(owner.query(sql));
});
