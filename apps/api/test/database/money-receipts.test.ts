import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentSetup,collectionInput,paymentFault} from '../payment-support.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createPaymentService} from '../../src/modules/payments/service.ts';
import {instant} from '../../src/modules/pricing/types.ts';
import {createFinanceService} from '../../src/modules/reports/finance-service.ts';
import {contact} from '../customer-support.ts';
import {org,A,B,otherOrg,C} from '../audit-support.ts';
const q={organization_id:org,franchise_id:A};
const headers=(key:string)=>['idempotency-key',key];
await test('receipt service persists split cash/UPI against a 50000 bill and replays without a second inflow',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareMoneyReceipts();
 const accounts=createReceivingAccountService(s.pool),service=createMoneyReceiptService(s.pool),operator=await s.grant('operator',[A]);
 const account=async(method:'cash'|'upi')=>{const key=randomUUID();return accounts.configure(s.local.token,null,q,key,headers(key),{name:'Synthetic '+method+' receiving',methods:[method],other_method_name:null,active:true,expected_version:0},randomUUID());};
 const cash=await account('cash'),upi=await account('upi');
 const make=(amount:number,a:typeof cash,method:'cash'|'upi',version:number)=>({customer_id:s.source.id,account_id:a.id,expected_account_version:1,amount_paise:amount,currency:'INR',method,receiver_id:operator.id,custodian_id:operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:method==='upi'?'SYNTHETIC-UPI-REF':null,
 allocations:[{booking_id:s.bookingId,amount_paise:amount,context:'to_pay',expected_payment_version:version}]});
 const key=randomUUID(),body=make(20000,cash,'cash',0);
 const response=await s.app.inject({method:'POST',url:'/api/v1/money-receipts?'+new URLSearchParams(q),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(operator.token),payload:JSON.stringify(body)});
 assert.equal(response.statusCode,200,response.body);const first=response.json();
 assert.equal(first.received_paise,20000);assert.equal(first.unallocated_paise,0);assert.equal((await s.current()).json().outstanding_paise,30000);
 const secondKey=randomUUID(),second=await service.record(operator.token,q,secondKey,headers(secondKey),make(30000,upi,'upi',1),randomUUID());
 assert.equal(second.received_paise,30000);assert.equal((await s.current()).json().state,'settled');assert.deepEqual(await service.record(operator.token,q,key,headers(key),body,randomUUID()),first);
 assert.equal((await s.db.adminQuery('SELECT sum(amount_paise)::text total FROM shipit.money_receipts')).rows[0]!.total,'50000');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,2);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='payment.settled'")).rows[0]!.n,1);
 assert.ok(!/external_reference|receiver_id|SYNTHETIC-UPI-REF|key_digest|fingerprint/.test(JSON.stringify(second)));
 await assert.rejects(service.read(operator.token,second.receipt_id,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const evidence=await service.read(s.local.token,second.receipt_id,q,randomUUID());assert.equal(evidence.receipt.external_reference,'SYNTHETIC-UPI-REF');assert.equal(evidence.receipt.verification,'manually_recorded_unverified');
 assert.deepEqual(await service.summary(operator.token,second.receipt_id,q,randomUUID()),second);
 const disabled=createMoneyReceiptService(s.pool,false);assert.deepEqual(await disabled.record(operator.token,q,key,headers(key),body,randomUUID()),first);
 await assert.rejects(disabled.record(operator.token,q,randomUUID(),headers('disabled'),body,randomUUID()),{code:'MONEY_RECEIPTS_DISABLED'});
 assert.deepEqual(await disabled.summary(operator.token,second.receipt_id,q,randomUUID()),second);
 const get=(path:string,query:Record<string,string>,token=operator.token)=>s.app.inject({method:'GET',url:path+'?'+new URLSearchParams(query),headers:s.headers,cookies:s.cookies(token)});
 const page=await get('/api/v1/money-receipts',{...q,customer_id:s.source.id,limit:'1'});assert.equal(page.statusCode,200,page.body);assert.equal(page.json().items.length,1);assert.ok(page.json().next_cursor);
 const next=await get('/api/v1/money-receipts',{...q,customer_id:s.source.id,limit:'1',cursor:page.json().next_cursor});assert.equal(next.statusCode,200,next.body);assert.equal(next.json().next_cursor,null);
 assert.deepEqual(new Set([page.json().items[0].receipt_id,next.json().items[0].receipt_id]),new Set([first.receipt_id,second.receipt_id]));
 assert.ok(!/external_reference|receiver_id|SYNTHETIC-UPI-REF|key_digest|fingerprint/.test(page.body+next.body));
 const choices=await get('/api/v1/receiving-accounts',{...q,limit:'1'});assert.equal(choices.statusCode,200,choices.body);assert.equal(choices.json().items.length,1);assert.ok(choices.json().next_cursor);
 const bills=await get('/api/v1/money-receipt-bills',{...q,customer_id:s.source.id});assert.equal(bills.statusCode,200,bills.body);assert.deepEqual(bills.json().items,[{booking_id:s.bookingId,currency:'INR',gross_paise:50000,outstanding_paise:0,expected_payment_version:2}]);
 assert.equal((await get('/api/v1/money-receipts',{...q,customer_id:randomUUID()})).statusCode,404);
 assert.equal((await get('/api/v1/money-receipt-bills',{...q,franchise_id:B,customer_id:s.source.id},s.admin.token)).statusCode,404);
 assert.equal((await get('/api/v1/money-receipts',{...q,customer_id:s.source.id,limit:'101'})).statusCode,422);

 await assert.rejects(service.record(operator.token,q,key,headers(key),{...body,amount_paise:20001},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 const allocation={expected_version:1,allocations:[{booking_id:s.bookingId,amount_paise:1,context:'to_pay',expected_payment_version:2}]};
 const correction={expected_version:1,allocation_id:first.allocations[0].id,amount_paise:1,currency:'INR',reason_code:'incorrect_amount'};
 const config={name:'Synthetic denied configuration',methods:['cash'],other_method_name:null,active:true,expected_version:0};
 for(const role of ['accountant','read_only','dispatcher','delivery_agent']){
  const actor=await s.grant(role,[A]);
  await assert.rejects(service.record(actor.token,q,randomUUID(),headers('denied'),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(service.allocate(actor.token,first.receipt_id,q,randomUUID(),headers('denied'),allocation,randomUUID()),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(service.correct(actor.token,first.receipt_id,q,randomUUID(),headers('denied'),correction,randomUUID()),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(accounts.configure(actor.token,null,q,randomUUID(),headers('denied'),config,randomUUID()),{code:'ACTION_FORBIDDEN'});
  if(role==='accountant'){
   assert.deepEqual(await service.summary(actor.token,second.receipt_id,q,randomUUID()),second);
   assert.equal((await service.read(actor.token,second.receipt_id,q,randomUUID())).receipt.external_reference,'SYNTHETIC-UPI-REF');
   assert.equal((await accounts.read(actor.token,cash.id,q,randomUUID())).id,cash.id);
  }else{
   await assert.rejects(service.summary(actor.token,second.receipt_id,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
   await assert.rejects(service.read(actor.token,second.receipt_id,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
   await assert.rejects(accounts.read(actor.token,cash.id,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
  }
 }
 assert.deepEqual(await service.summary(s.admin.token,second.receipt_id,q,randomUUID()),second);
 assert.equal((await service.read(s.admin.token,second.receipt_id,q,randomUUID())).receipt.external_reference,'SYNTHETIC-UPI-REF');
 assert.equal((await accounts.read(s.admin.token,cash.id,q,randomUUID())).id,cash.id);
 await assert.rejects(service.allocate(s.admin.token,first.receipt_id,q,randomUUID(),headers('denied'),allocation,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.correct(s.admin.token,first.receipt_id,q,randomUUID(),headers('denied'),correction,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(accounts.configure(s.admin.token,null,q,randomUUID(),headers('denied'),config,randomUUID()),{code:'ACTION_FORBIDDEN'});
 // Validly shaped guessed nested IDs never create a partial receipt or leaf.
 for(const invalid of [{...body,customer_id:randomUUID()},{...body,account_id:randomUUID()},{...body,receiver_id:randomUUID(),custodian_id:randomUUID()},
  {...body,allocations:[{...body.allocations[0],booking_id:randomUUID()}]}]){
  const invalidKey=randomUUID();await assert.rejects(service.record(operator.token,q,invalidKey,headers(invalidKey),invalid,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 }
 const revokedReceiver=await s.grant('operator',[A]);await s.memberships.revokeMembership(s.admin.token,revokedReceiver.member.id,{expected_version:revokedReceiver.member.version});
 const receiverKey=randomUUID();await assert.rejects(service.record(operator.token,q,receiverKey,headers(receiverKey),{...body,receiver_id:revokedReceiver.id,custodian_id:revokedReceiver.id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,2);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipt_allocations')).rows[0]!.n,2);

 await assert.rejects(service.record(s.admin.token,q,randomUUID(),headers('denied'),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.summary(operator.token,second.receipt_id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.summary(s.admin.token,second.receipt_id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.summary(operator.token,second.receipt_id,{organization_id:otherOrg,franchise_id:C},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await s.memberships.revokeMembership(s.admin.token,operator.member.id,{expected_version:operator.member.version});
 await assert.rejects(service.record(operator.token,q,key,headers(key),body,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.history(operator.token,second.receipt_id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.receivers(operator.token,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('receipt service atomically pays 40000 and 50000 debt, holds 10000 advance and serializes competing allocation/correction',{timeout:30000},async t=>{
 const s=await paymentSetup(t,100000);await s.db.prepareMoneyReceipts();const service=createMoneyReceiptService(s.pool),operator=await s.grant('operator',[A]);
 const second=await s.book(s.paymentBookingInput);assert.equal(second.statusCode,201);const third=await s.book(s.paymentBookingInput);assert.equal(third.statusCode,201);
 const old=createPaymentService(s.pool);for(const [booking,amount] of [[s.bookingId,60000],[second.json().id,50000]] as const){const key=randomUUID();await old.execute(s.local.token,booking,null,q,key,headers(key),collectionInput(amount),'payments.collect',randomUUID());}
 const accountKey=randomUUID(),account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic bank receiving',methods:['bank_transfer'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const input={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:100000,currency:'INR',method:'bank_transfer',receiver_id:operator.id,custodian_id:operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:'SYNTHETIC-BANK-REF',
 allocations:[{booking_id:s.bookingId,amount_paise:40000,context:'to_pay',expected_payment_version:1},{booking_id:second.json().id,amount_paise:50000,context:'to_pay',expected_payment_version:1}]};
 const key=randomUUID(),recorded=await service.record(operator.token,q,key,headers(key),input,randomUUID());assert.equal(recorded.allocated_paise,90000);assert.equal(recorded.unallocated_paise,10000);
 assert.equal((await old.read(s.local.token,s.bookingId,q,randomUUID())).outstanding_paise,0);assert.equal((await old.read(s.local.token,second.json().id,q,randomUUID())).outstanding_paise,0);
 const application={expected_version:1,allocations:[{booking_id:third.json().id,amount_paise:10000,context:'to_pay',expected_payment_version:0}]};
 const applicationKeys=[randomUUID(),randomUUID()];
 const race=await Promise.allSettled(applicationKeys.map(key=>service.allocate(operator.token,recorded.receipt_id,q,key,headers(key),application,randomUUID())));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);const denied=race.find(r=>r.status==='rejected');assert.ok(denied?.status==='rejected');assert.equal(denied.reason.code,'VERSION_CONFLICT');
 const current=await service.summary(operator.token,recorded.receipt_id,q,randomUUID());assert.equal(current.allocated_paise,100000);assert.equal(current.unallocated_paise,0);assert.deepEqual(await service.record(operator.token,q,key,headers(key),input,randomUUID()),recorded);
 const target=recorded.allocations.find(a=>a.booking_id===s.bookingId)!,correction={expected_version:2,allocation_id:target.id,amount_paise:10000,currency:'INR',reason_code:'incorrect_amount'},correctKey=randomUUID();
 await assert.rejects(service.correct(operator.token,recorded.receipt_id,q,correctKey,headers(correctKey),correction,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const corrected=await service.correct(s.local.token,recorded.receipt_id,q,correctKey,headers(correctKey),correction,randomUUID());assert.equal(corrected.received_paise,100000);assert.equal(corrected.unallocated_paise,10000);assert.equal((await old.read(s.local.token,s.bookingId,q,randomUUID())).outstanding_paise,10000);
 assert.deepEqual(await service.correct(s.local.token,recorded.receipt_id,q,correctKey,headers(correctKey),correction,randomUUID()),corrected);
 const disabled=createMoneyReceiptService(s.pool,false);
 const winnerIndex=race.findIndex(result=>result.status==='fulfilled'),winner=race[winnerIndex]!;assert.ok(winner.status==='fulfilled');
 assert.deepEqual(await disabled.allocate(operator.token,recorded.receipt_id,q,applicationKeys[winnerIndex]!,headers(applicationKeys[winnerIndex]!),application,randomUUID()),winner.value);
 assert.deepEqual(await disabled.correct(s.local.token,recorded.receipt_id,q,correctKey,headers(correctKey),correction,randomUUID()),corrected);
 await assert.rejects(disabled.correct(s.local.token,recorded.receipt_id,q,randomUUID(),headers('disabled-correction'),{...correction,expected_version:corrected.version},randomUUID()),{code:'MONEY_RECEIPTS_DISABLED'});
 await assert.rejects(disabled.allocate(operator.token,recorded.receipt_id,q,randomUUID(),headers('disabled-allocation'),{expected_version:corrected.version,allocations:[{booking_id:s.bookingId,amount_paise:10000,context:'to_pay',expected_payment_version:2}]},randomUUID()),{code:'MONEY_RECEIPTS_DISABLED'});
 const disabledAccounts=createReceivingAccountService(s.pool,false);
 assert.deepEqual(await disabledAccounts.configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic bank receiving',methods:['bank_transfer'],other_method_name:null,active:true,expected_version:0},randomUUID()),account);
 await assert.rejects(disabledAccounts.configure(s.local.token,null,q,randomUUID(),headers('disabled-account'),{name:'Synthetic disabled new account',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID()),{code:'MONEY_RECEIPTS_DISABLED'});

 const history=await service.history(operator.token,recorded.receipt_id,{...q,limit:'100'},randomUUID());assert.equal(history.items.length,4);assert.equal(history.next_cursor,null);
 const original=history.items.find(row=>row.id===target.id)!;assert.equal(original.released_paise,10000);assert.equal(original.amount_paise,40000);assert.equal(original.version,1);
 const release=history.items.find(row=>row.kind==='release')!;assert.equal(release.release_of,target.id);assert.equal(release.amount_paise,10000);assert.equal(release.version,3);assert.ok(!/external_reference|receiver_id|SYNTHETIC-BANK-REF/.test(JSON.stringify(history)));
 const firstPage=await service.history(operator.token,recorded.receipt_id,{...q,limit:'1'},randomUUID());assert.equal(firstPage.items.length,1);assert.ok(firstPage.next_cursor);
 const nextPage=await service.history(operator.token,recorded.receipt_id,{...q,limit:'100',cursor:firstPage.next_cursor!},randomUUID());assert.equal(nextPage.items.length,3);assert.ok(!nextPage.items.some(row=>row.id===firstPage.items[0]!.id));
 await assert.rejects(service.history(s.admin.token,recorded.receipt_id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const receivers=await service.receivers(operator.token,q,randomUUID());assert.ok(receivers.items.some(row=>row.id===operator.id));assert.ok(!/phone|address|email/.test(JSON.stringify(receivers)));

 const disableKey=randomUUID();await createReceivingAccountService(s.pool).configure(s.local.token,account.id,q,disableKey,headers(disableKey),{name:account.name,methods:account.methods,other_method_name:null,active:false,expected_version:1},randomUUID());
 assert.deepEqual(await service.record(operator.token,q,key,headers(key),input,randomUUID()),recorded);
 const newKey=randomUUID();await assert.rejects(service.record(operator.token,q,newKey,headers(newKey),input,randomUUID()),{code:'VERSION_CONFLICT'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,1);
});
await test('receipt service failure and uncertain commit preserve exact atomic source/leaf/audit outcomes',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareMoneyReceipts();const key=randomUUID(),accountKey=randomUUID();
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic counter',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const input={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:50000,currency:'INR',method:'cash',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:null,allocations:[{booking_id:s.bookingId,amount_paise:50000,context:'to_pay',expected_payment_version:0}]};
 const invoke=(pool=s.pool)=>createMoneyReceiptService(pool).record(s.operator.token,q,key,headers(key),input,randomUUID());
 const counts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.money_receipts) receipts,(SELECT count(*)::int FROM shipit.money_receipt_commands) commands,
 (SELECT count(*)::int FROM shipit.money_receipt_allocations) allocations,(SELECT count(*)::int FROM shipit.money_receipt_audit_events) audits,(SELECT count(*)::int FROM shipit.payment_entries) entries,(SELECT count(*)::int FROM shipit.domain_events WHERE money_receipt_id IS NOT NULL) receipt_events`)).rows[0];
 await assert.rejects(invoke(paymentFault(s.pool,'UPDATE shipit.money_receipt_commands','before')),{code:'TEMPORARILY_UNAVAILABLE'});assert.deepEqual(await counts(),{receipts:0,commands:0,allocations:0,audits:0,entries:0,receipt_events:0});
 await assert.rejects(invoke(paymentFault(s.pool,'COMMIT','after')),{code:'TEMPORARILY_UNAVAILABLE'});assert.deepEqual(await counts(),{receipts:1,commands:1,allocations:1,audits:1,entries:1,receipt_events:1});
 const result=await invoke();assert.equal(result.received_paise,50000);assert.deepEqual(await invoke(),result);assert.deepEqual(await counts(),{receipts:1,commands:1,allocations:1,audits:1,entries:1,receipt_events:1});
});

await test('unallocated advances publish an exact private-safe aggregate and missing source events roll back the command',{timeout:30000},async t=>{
 const s=await paymentSetup(t);await s.db.prepareMoneyReceipts();const service=createMoneyReceiptService(s.pool),accountKey=randomUUID();
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic advance account',methods:['card'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const key=randomUUID(),input={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:100000,currency:'INR',method:'card',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:'SYNTHETIC-PRIVATE-CARD-REF',allocations:[]};
 await s.db.adminQuery('ALTER TABLE shipit.money_receipt_commands DISABLE TRIGGER money_receipt_command_publish');
 try{await assert.rejects(service.record(s.operator.token,q,key,headers(key),input,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});}
 finally{await s.db.adminQuery('ALTER TABLE shipit.money_receipt_commands ENABLE TRIGGER money_receipt_command_publish');}
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,0);
 const correlation=randomUUID(),result=await service.record(s.operator.token,q,key,headers(key),input,correlation);
 assert.equal(result.allocated_paise,0);assert.equal(result.unallocated_paise,100000);
 const rows=(await s.db.adminQuery('SELECT * FROM shipit.domain_events WHERE money_receipt_id=$1',[result.receipt_id])).rows;assert.equal(rows.length,1);const event=rows[0]!;
 assert.equal(event.booking_id,null);assert.equal(event.parcel_id,null);assert.equal(event.event_type,'money_receipt.recorded');assert.equal(event.aggregate_sequence,'1');
 assert.equal(Date.parse(event.envelope.occurred_at),event.occurred_at.getTime());
 const parent=(await s.db.adminQuery('SELECT recorded_at FROM shipit.money_receipt_commands WHERE id=$1',[event.command_id])).rows[0]!;assert.equal(event.occurred_at.getTime(),parent.recorded_at.getTime());
 assert.deepEqual(event.envelope,{event_id:event.event_id,event_type:'money_receipt.recorded',schema_version:1,organization_id:org,franchise_id:A,aggregate_type:'money_receipt',aggregate_id:result.receipt_id,aggregate_version:1,
 occurred_at:instant(event.occurred_at),actor:{type:'user',id:s.operator.id},correlation_id:correlation,causation_id:event.command_id,command_id:event.command_id,payload:{receipt_id:result.receipt_id}});
 assert.ok(!/SYNTHETIC-PRIVATE|external_reference|account_id|customer_id|receiver_id|amount_paise/.test(JSON.stringify(event.envelope)));
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n,0);
 assert.deepEqual(await service.record(s.operator.token,q,key,headers(key),input,randomUUID()),result);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.domain_events WHERE money_receipt_id=$1',[result.receipt_id])).rows[0]!.n,1);
});

await test('receipt allocation respects another owned customer, adjusted debt and actual legacy refund evidence',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareMoneyReceipts();await s.db.prepareReports();
 const service=createMoneyReceiptService(s.pool),finance=createFinanceService(s.pool),accountKey=randomUUID();
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic cheque account',methods:['other'],other_method_name:'Cheque',active:true,expected_version:0},randomUUID());
 const other=await s.customer.create(s.operator.token,org,A,randomUUID(),{...contact,name:'Other synthetic customer',phone:'+1 202-555-0199'},randomUUID());
 const otherBooking=await s.book({...s.paymentBookingInput,customer_id:other.id,expected_customer_version:1});assert.equal(otherBooking.statusCode,201,otherBooking.body);
 const key=randomUUID(),input={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:50000,currency:'INR',method:'other',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:'SYNTHETIC-CHEQUE-REF',allocations:[]};
 const recorded=await service.record(s.operator.token,q,key,headers(key),input,randomUUID());assert.equal(recorded.unallocated_paise,50000);
 const foreignKey=randomUUID();await assert.rejects(service.allocate(s.operator.token,recorded.receipt_id,q,foreignKey,headers(foreignKey),{expected_version:1,allocations:[{booking_id:otherBooking.json().id,amount_paise:100,context:'to_pay',expected_payment_version:0}]},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const current=await finance.read(s.local.token,q,s.bookingId,randomUUID()),discountKey=randomUUID();
 await finance.change(s.local.token,q,discountKey,headers(discountKey),{booking_id:s.bookingId,expected_version:0,payment_version:0,kind:'discount',reason:'customer_agreement',approval_ref:'SYNTHETIC_APPROVAL',pre_tax:10000,taxable:Math.min(10000,Number(current.taxable)),cgst:0,sgst:0,igst:0,rounding:0},randomUUID());
 assert.equal((await s.current()).json().outstanding_paise,40000);
 const overKey=randomUUID();await assert.rejects(service.allocate(s.operator.token,recorded.receipt_id,q,overKey,headers(overKey),{expected_version:1,allocations:[{booking_id:s.bookingId,amount_paise:50000,context:'to_pay',expected_payment_version:0}]},randomUUID()),{code:'ALLOCATION_CONFLICT'});
 assert.deepEqual(await service.summary(s.operator.token,recorded.receipt_id,q,randomUUID()),recorded);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipt_commands')).rows[0]!.n,1);
 const applyKey=randomUUID(),applied=await service.allocate(s.operator.token,recorded.receipt_id,q,applyKey,headers(applyKey),{expected_version:1,allocations:[{booking_id:s.bookingId,amount_paise:40000,context:'to_pay',expected_payment_version:0}]},randomUUID());
 assert.equal(applied.allocated_paise,40000);assert.equal(applied.unallocated_paise,10000);assert.equal((await s.current()).json().state,'settled');
 const adjusted=await finance.read(s.local.token,q,s.bookingId,randomUUID()),cancelKey=randomUUID();
 await finance.change(s.local.token,q,cancelKey,headers(cancelKey),{booking_id:s.bookingId,expected_version:1,payment_version:1,kind:'cancellation',reason:'booking_cancelled',approval_ref:'SYNTHETIC_CANCEL',pre_tax:Number(adjusted.pre_tax),taxable:Number(adjusted.taxable),cgst:Number(adjusted.cgst),sgst:Number(adjusted.sgst),igst:Number(adjusted.igst),rounding:Number(adjusted.rounding)},randomUUID());
 const refundKey=randomUUID();await finance.change(s.local.token,q,refundKey,headers(refundKey),{booking_id:s.bookingId,expected_version:2,payment_version:1,kind:'refund',reason:'customer_refund',approval_ref:'SYNTHETIC_REFUND',returned_to_ref:'SYNTHETIC_RETURN',refund:40000},randomUUID());
 const releaseKey=randomUUID();await assert.rejects(service.correct(s.local.token,recorded.receipt_id,q,releaseKey,headers(releaseKey),{expected_version:2,allocation_id:applied.allocations[0]!.id,amount_paise:1,currency:'INR',reason_code:'incorrect_amount'},randomUUID()),{code:'ALLOCATION_CONFLICT'});
 assert.deepEqual(await service.summary(s.operator.token,recorded.receipt_id,q,randomUUID()),applied);
 assert.deepEqual(await service.record(s.operator.token,q,key,headers(key),input,randomUUID()),recorded);
 assert.equal((await s.current()).json().collected_paise,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipt_allocations')).rows[0]!.n,1);
});
await test('legacy collection and receipt allocation race on the same debt without duplicate settlement',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareMoneyReceipts();const service=createMoneyReceiptService(s.pool),accountKey=randomUUID();
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic race drawer',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const key=randomUUID(),input={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:50000,currency:'INR',method:'cash',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:null,allocations:[{booking_id:s.bookingId,amount_paise:50000,context:'to_pay',expected_payment_version:0}]};
 const legacy=createPaymentService(s.pool),oldKey=randomUUID();
 const raced=await Promise.allSettled([service.record(s.operator.token,q,key,headers(key),input,randomUUID()),legacy.execute(s.local.token,s.bookingId,null,q,oldKey,headers(oldKey),collectionInput(50000),'payments.collect',randomUUID())]);
 assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
 const rejected=raced.find(result=>result.status==='rejected');assert.ok(rejected?.status==='rejected');assert.ok(['VERSION_CONFLICT','PAYMENT_OVER_COLLECTION'].includes(rejected.reason.code));
 const counts=(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.money_receipts) receipts,(SELECT count(*)::int FROM shipit.money_receipt_commands) commands,
 (SELECT count(*)::int FROM shipit.money_receipt_allocations) allocations,(SELECT count(*)::int FROM shipit.payment_entries) entries,(SELECT count(*)::int FROM shipit.payment_audit_events) audits,
 (SELECT count(*)::int FROM shipit.domain_events WHERE event_type='payment.settled') settlements,(SELECT sum(amount_paise)::text FROM shipit.payment_entries) collected`)).rows[0]!;
 const receiptWon=raced[0]!.status==='fulfilled';assert.deepEqual(counts,{receipts:receiptWon?1:0,commands:receiptWon?1:0,allocations:receiptWon?1:0,entries:1,audits:1,settlements:1,collected:'50000'});
 assert.equal((await s.current()).json().outstanding_paise,0);assert.equal((await s.current()).json().state,'settled');
 if(raced[0]!.status==='fulfilled')assert.deepEqual(await service.record(s.operator.token,q,key,headers(key),input,randomUUID()),raced[0]!.value);
 if(raced[1]!.status==='fulfilled')assert.deepEqual(await legacy.execute(s.local.token,s.bookingId,null,q,oldKey,headers(oldKey),collectionInput(50000),'payments.collect',randomUUID()),raced[1]!.value);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n,1);
});
