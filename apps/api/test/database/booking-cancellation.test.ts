import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withTransaction} from '@shippingco/db';
import {paymentSetup,collectionInput} from '../payment-support.ts';
import {statementSetup} from '../account-statement-support.ts';
import {finalizedManifest} from '../route-support.ts';
import {org,A,B} from '../audit-support.ts';
import {contact} from '../customer-support.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createDailyService} from '../../src/modules/reports/daily-service.ts';

const q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
type Actor={id:string;token:string};

async function setup(t:TestContext) {
  const s=await paymentSetup(t);
  const query=new URLSearchParams(q);
  const url=(booking:string=s.bookingId)=>`/api/v1/bookings/${booking}/cancellation?${query}`;
  const input={reason:'Customer withdrew the booking',expected_financial_version:0,expected_payment_version:0};
  const cancel=(body:Record<string,unknown>=input,key=randomUUID(),token=s.operator.token,booking=s.bookingId)=>s.app.inject({method:'POST',url:url(booking),
    cookies:s.cookies(token),headers:{...s.headers,'idempotency-key':key},payload:body});
  const preview=(token=s.operator.token,booking=s.bookingId)=>s.app.inject({method:'GET',url:url(booking),cookies:s.cookies(token)});
  const parcel=(parcelId:string,path:string,body:Record<string,unknown>,actor:Actor=s.operator)=>s.app.inject({method:'POST',url:`/api/v1/parcels/${parcelId}/${path}?${query}`,
    cookies:s.cookies(actor.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:{evidence_ref:randomUUID(),...body}});
  const checkIn=(parcelId:string)=>parcel(parcelId,'check-in',{expected_version:1,location_ref:randomUUID()});
  return {...s,query,url,input,cancel,preview,parcel,checkIn};
}

/** Receiving accounts and cash drawers as the counter uses them. */
async function money(s:Awaited<ReturnType<typeof setup>>) {
  await s.db.prepareCashbook();
  const accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true),receipts=createMoneyReceiptService(s.pool);
  const account=(method:'cash'|'upi')=>accounts.configure(s.local.token,null,q,randomUUID(),headers,{name:'Synthetic '+method,methods:[method],other_method_name:null,active:true,expected_version:0},randomUUID());
  const drawer=(account:string,custodian:Actor|null)=>locations.configure(s.local.token,null,q,randomUUID(),headers,{account_id:account,expected_account_version:1,
    custodian_id:custodian?.id??null,name:custodian?'Synthetic drawer '+custodian.id.slice(0,8):'Synthetic recorded funds',active:true,expected_version:0},randomUUID());
  const receive=(account:string,method:'cash'|'upi',amount:number,custodian:Actor,booking:string|null=s.bookingId)=>receipts.record(custodian.token,q,randomUUID(),headers,{customer_id:s.source.id,
    account_id:account,expected_account_version:1,amount_paise:amount,currency:'INR',method,receiver_id:custodian.id,custodian_id:custodian.id,
    occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:method==='cash'?null:'SYN_UPI_'+randomUUID().slice(0,8),
    allocations:booking?[{booking_id:booking,amount_paise:amount,context:'to_pay',expected_payment_version:0}]:[]},randomUUID());
  return {account,drawer,receive,receipts};
}

async function policy(s:Awaited<ReturnType<typeof setup>>) {
  const digest=()=>randomBytes(32).toString('hex');
  await s.db.adminQuery(`INSERT INTO shipit.financial_policy_revisions
    (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
    VALUES($1,$2,$3,1,NULL,false,true,$4,$5,$6,$7)`,[randomUUID(),org,A,s.local.id,randomUUID(),digest(),digest()]);
}

await test('cancels an unpaid booking at once, reverses its whole charge and replays the original command',async t=>{
  const s=await setup(t),before=await s.preview();
  assert.equal(before.statusCode,200,before.body);
  assert.deepEqual(before.json(),{booking_id:s.bookingId,parcel_count:2,outstanding_paise:String(s.gross),reversed_paise:String(s.gross),refund_paise:'0',refunds:[],
    financial_version:0,payment_version:0,blocked_reason:null,in_bag:false});
  const opening=await s.db.adminQuery('SELECT * FROM shipit.booking_obligations');
  const key=randomUUID();const [first,replay]=await Promise.all([s.cancel(s.input,key),s.cancel(s.input,key)]);
  assert.equal(first.statusCode,200,first.body);assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(first.json(),replay.json());
  const {id,cancelled_at,...saved}=first.json();assert.ok(id);assert.ok(Date.parse(cancelled_at));
  assert.deepEqual(saved,{booking_id:s.bookingId,parcel_count:2,outstanding_paise:String(s.gross),reversed_paise:String(s.gross),refunded_paise:'0',refunds:[]});
  assert.deepEqual((await s.cancel(s.input,key)).json(),first.json());
  assert.equal((await s.cancel({...s.input,reason:'A different reason'},key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await s.cancel()).json().error.code,'BOOKING_CANCELLATION_BLOCKED');
  const after=(await s.preview()).json();assert.equal(after.blocked_reason,'already_cancelled');assert.equal(after.outstanding_paise,'0');
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,opening.rows);
  assert.deepEqual((await s.db.adminQuery('SELECT state,version FROM shipit.bookings')).rows,[{state:'cancelled',version:2}]);
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels')).rows,[{status:'cancelled',version:2},{status:'cancelled',version:2}]);
  assert.deepEqual((await s.db.adminQuery('SELECT actor_id,reason,reversed_paise::int,refunded_paise::int FROM shipit.booking_cancellations')).rows,
    [{actor_id:s.operator.id,reason:s.input.reason,reversed_paise:s.gross,refunded_paise:0}]);
  const changes=(await s.db.adminQuery(`SELECT kind,reason,approval_ref,actor_id,(pre_tax+cgst+sgst+igst+rounding)::int gross FROM shipit.financial_changes`)).rows;
  assert.deepEqual(changes,[{kind:'cancellation',reason:'booking_cancelled',approval_ref:'booking_cancellation:'+id,actor_id:s.operator.id,gross:s.gross}]);
  const payments=await s.current();assert.equal(payments.statusCode,200,payments.body);assert.equal(payments.json().outstanding_paise,0);
  assert.equal((await s.pay(collectionInput(1))).statusCode,409);
  const audit=await s.list(s.local.token,{resource_type:'booking'});
  assert.equal(audit.statusCode,200,audit.body);assert.ok(audit.json().items.some((e:{action:string})=>e.action==='bookings.cancel'));
  assert.ok(!audit.body.includes(s.input.reason));
  const list=await s.app.inject({url:`/api/v1/parcels?${s.query}&status=cancelled`,cookies:s.cookies(s.operator.token)});
  assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items.length,2);
  const firstParcel=s.booked.parcels[0].id;
  const timeline=await s.app.inject({url:`/api/v1/parcels/${firstParcel}/timeline?${s.query}`,cookies:s.cookies(s.operator.token)});
  assert.equal(timeline.statusCode,200,timeline.body);assert.equal(timeline.json().items.at(-1).code,'booking.cancelled');
  assert.equal((await s.checkIn(firstParcel)).json().error.code,'PARCEL_STATE_CONFLICT');
});

await test('refunds a paid cash booking without review from the drawer that took it, once in the cashbook, daily report and balances',{timeout:60000},async t=>{
  const s=await setup(t),m=await money(s),cash=await m.account('cash');
  const operatorDrawer=await m.drawer(cash.id,s.operator),adminDrawer=await m.drawer(cash.id,s.local);
  // The money went into the admin's drawer; the operator's own drawer is empty. That no longer
  // stops the operator: the refund leaves the drawer that took the money in.
  const received=await m.receive(cash.id,'cash',s.gross,s.local);assert.equal(received.allocated_paise,s.gross);
  await policy(s);
  const ready=(await s.preview()).json();
  assert.deepEqual(ready,{booking_id:s.bookingId,parcel_count:2,outstanding_paise:'0',reversed_paise:String(s.gross),refund_paise:String(s.gross),
    refunds:[{method:'cash',amount_paise:String(s.gross)}],financial_version:0,payment_version:1,blocked_reason:null,in_bag:false});
  const body={...s.input,expected_payment_version:1};
  const cancelled=await s.cancel(body);assert.equal(cancelled.statusCode,200,cancelled.body);
  const {id,cancelled_at:_at,...saved}=cancelled.json();void _at;
  assert.deepEqual(saved,{booking_id:s.bookingId,parcel_count:2,outstanding_paise:'0',reversed_paise:String(s.gross),refunded_paise:String(s.gross),
    refunds:[{method:'cash',amount_paise:String(s.gross)}]});
  const changes=(await s.db.adminQuery(`SELECT c.kind,c.version,c.refund::int,c.approval_ref,e.method,e.cash_location_id,e.cancellation_id,e.request_id
    FROM shipit.financial_changes c LEFT JOIN shipit.financial_refund_evidence e ON e.id=c.id ORDER BY c.version`)).rows;
  assert.deepEqual(changes,[
    {kind:'cancellation',version:1,refund:0,approval_ref:'booking_cancellation:'+id,method:null,cash_location_id:null,cancellation_id:null,request_id:null},
    {kind:'refund',version:2,refund:s.gross,approval_ref:'booking_cancellation:'+id,method:'cash',cash_location_id:adminDrawer.id,cancellation_id:id,request_id:null}]);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.financial_request_decisions')).rows[0]!.n,0);
  // Cashbook: the receipt came in once and the refund went out of the same drawer.
  const facts=(await s.db.adminQuery(`SELECT source_kind,direction,amount_paise::int,location_id,unknown_reason FROM shipit.cashbook_source_facts ORDER BY source_kind`)).rows;
  assert.deepEqual(facts,[{source_kind:'receipt',direction:'in',amount_paise:s.gross,location_id:adminDrawer.id,unknown_reason:null},
    {source_kind:'refund',direction:'out',amount_paise:s.gross,location_id:adminDrawer.id,unknown_reason:null}]);
  assert.notEqual(operatorDrawer.id,adminDrawer.id);
  // The receipt allocation stays; the booking and customer owe and hold nothing.
  const receipt=await m.receipts.read(s.local.token,received.receipt_id,q,randomUUID());
  assert.equal(receipt.balance.allocated_paise,s.gross);assert.equal(receipt.balance.unallocated_paise,0);
  const payments=(await s.current()).json();assert.equal(payments.outstanding_paise,0);assert.equal(payments.collected_paise,0);assert.equal(payments.refundable_credit_paise,undefined);
  await s.db.prepareReports();
  const daily=await createDailyService(s.pool).create(s.local.token,q,randomUUID(),headers,{mode:'complete_day'},randomUUID());
  assert.equal(daily.snapshot.today.refunds,String(s.gross));assert.equal(daily.snapshot.today.collections,String(s.gross));
  assert.equal(daily.snapshot.today.outstanding,'0');assert.equal(daily.snapshot.today.bookings,0);
  // A later reversal or allocation release would count the money twice.
  const entry=(await s.db.adminQuery("SELECT id FROM shipit.payment_entries WHERE kind='collection'")).rows[0]!.id as string;
  assert.equal((await s.reverse(entry,s.gross)).statusCode,409);
  await assert.rejects(m.receipts.correct(s.local.token,received.receipt_id,q,randomUUID(),headers,{expected_version:receipt.balance.version,
    allocation_id:(await s.db.adminQuery('SELECT id FROM shipit.money_receipt_allocations')).rows[0]!.id,amount_paise:s.gross,currency:'INR',reason_code:'incorrect_amount'},randomUUID()));
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipt_allocations')).rows[0]!.n,1);
});

await test('refunds cash that never reached a drawer the same way, with custody unknown, instead of blocking',{timeout:60000},async t=>{
  const s=await setup(t),m=await money(s),cash=await m.account('cash');
  await m.receive(cash.id,'cash',s.gross,s.local);
  const ready=(await s.preview()).json();assert.equal(ready.blocked_reason,null);assert.equal(ready.refund_paise,String(s.gross));
  const cancelled=await s.cancel({...s.input,expected_payment_version:1});assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.deepEqual((await s.db.adminQuery('SELECT method,cash_location_id FROM shipit.financial_refund_evidence')).rows,[{method:'cash',cash_location_id:null}]);
  const facts=(await s.db.adminQuery('SELECT source_kind,direction,amount_paise::int,location_id,unknown_reason FROM shipit.cashbook_source_facts ORDER BY source_kind')).rows;
  assert.deepEqual(facts,[{source_kind:'receipt',direction:'in',amount_paise:s.gross,location_id:null,unknown_reason:'unassigned_receipt_location'},
    {source_kind:'refund',direction:'out',amount_paise:s.gross,location_id:null,unknown_reason:'cash_refund_custody_unknown'}]);
  assert.equal((await s.current()).json().outstanding_paise,0);
});

await test('refunds legacy collections through the single branch account for their method and blocks an unknown source',async t=>{
  const s=await setup(t);
  assert.equal((await s.pay({...collectionInput(1000),method:'upi'})).statusCode,200);
  const blocked=(await s.preview()).json();assert.equal(blocked.blocked_reason,'refund_source_missing');assert.equal(blocked.refund_paise,'1000');
  const m=await money(s),upi=await m.account('upi');
  const ready=(await s.preview()).json();assert.equal(ready.blocked_reason,null);assert.deepEqual(ready.refunds,[{method:'upi',amount_paise:'1000'}]);
  assert.equal(ready.outstanding_paise,String(s.gross-1000));
  const cancelled=await s.cancel({...s.input,expected_payment_version:1});assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.equal(cancelled.json().refunded_paise,'1000');assert.equal(cancelled.json().outstanding_paise,String(s.gross-1000));
  assert.deepEqual((await s.db.adminQuery('SELECT source_account_id,method,cash_location_id FROM shipit.financial_refund_evidence')).rows,[{source_account_id:upi.id,method:'upi',cash_location_id:null}]);
  assert.equal((await s.current()).json().outstanding_paise,0);
});

await test('cancels a booking whose parcels are checked in at the hub and keeps a dispatched parcel blocked',{timeout:60000},async t=>{
  const s=await setup(t);await s.db.prepareRoutes();
  const [first]=s.booked.parcels as {id:string}[];
  assert.equal((await s.checkIn(first!.id)).statusCode,200);
  assert.equal((await s.preview()).json().blocked_reason,null);
  const cancelled=await s.cancel();assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.deepEqual((await s.db.adminQuery('SELECT status,custody,version FROM shipit.parcels ORDER BY position')).rows,
    [{status:'cancelled',custody:'franchise_office',version:3},{status:'cancelled',custody:'awaiting_intake',version:2}]);
  const timeline=await s.app.inject({url:`/api/v1/parcels/${first!.id}/timeline?${s.query}`,cookies:s.cookies(s.operator.token)});
  assert.deepEqual(timeline.json().items.map((e:{code:string})=>e.code).slice(-2),['parcel.checked_in','booking.cancelled']);

  const other=await s.book();assert.equal(other.statusCode,201,other.body);
  const booking=other.json().id as string,parcel=other.json().parcels[0].id as string;
  assert.equal((await s.checkIn(parcel)).statusCode,200);
  const manifest=await finalizedManifest(s.pool,s.keys.browser,s.operator.token,[parcel]);
  assert.equal((await s.preview(s.operator.token,booking)).json().blocked_reason,'operational_commitment');
  const dispatched=await s.parcel(parcel,'dispatch',{expected_version:2,manifest_id:manifest});assert.equal(dispatched.statusCode,200,dispatched.body);
  assert.equal((await s.preview(s.operator.token,booking)).json().blocked_reason,'parcel_processed');
  const refused=await s.cancel(s.input,randomUUID(),s.operator.token,booking);assert.equal(refused.statusCode,409);assert.equal(refused.json().error.code,'BOOKING_CANCELLATION_BLOCKED');
  assert.equal((await s.db.adminQuery('SELECT status FROM shipit.parcels WHERE id=$1',[parcel])).rows[0]!.status,'dispatched');
});

await test('refuses stale revisions, cross-branch and unauthorized access',async t=>{
  const s=await setup(t);
  const reader=await s.grant('read_only',[A]);assert.equal((await s.preview(reader.token)).statusCode,403);
  assert.equal((await s.cancel(s.input,randomUUID(),reader.token)).statusCode,403);
  const offBranch=await s.app.inject({url:s.url().replace(A,B),cookies:s.cookies(s.operator.token)});assert.equal(offBranch.statusCode,404);
  assert.equal((await s.cancel({...s.input,expected_financial_version:1})).json().error.code,'VERSION_CONFLICT');
  assert.equal((await s.cancel({...s.input,reason:' '})).statusCode,422);
  await (await money(s)).account('upi');
  assert.equal((await s.pay({...collectionInput(1),method:'upi'})).statusCode,200);
  assert.equal((await s.cancel()).json().error.code,'VERSION_CONFLICT');
  assert.equal((await s.db.adminQuery('SELECT id FROM shipit.booking_cancellations')).rows.length,0);
});

await test('non-cancellation refunds and forged cancellation references still require review',async t=>{
  const s=await setup(t);
  const paid=await s.pay(collectionInput(s.gross));assert.equal(paid.statusCode,200,paid.body);
  const other=await s.book();assert.equal(other.statusCode,201,other.body);
  const digest=()=>randomBytes(32).toString('hex'),tax=s.booked.charges.tax;
  // Each insert passes every immediate guard; only the deferred review rule can reject it at commit.
  const owner=s.db.ownerPool(),inserted:string[]=[];
  const change=(version:number,kind:string,reason:string,approval:string,amounts:{pre_tax?:number;taxable?:number;cgst?:number;sgst?:number;igst?:number;rounding?:number;refund?:number},
    correlation=randomUUID(),actor=s.local.id)=>withTransaction(owner,async tx=>{
    await tx.query(`INSERT INTO shipit.financial_changes
    (id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,pre_tax,taxable,cgst,sgst,igst,rounding,refund,returned_to_ref,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[randomUUID(),org,A,s.bookingId,actor,digest(),digest(),version,kind,reason,approval,
      amounts.pre_tax??0,amounts.taxable??0,amounts.cgst??0,amounts.sgst??0,amounts.igst??0,amounts.rounding??0,amounts.refund??0,kind==='refund'?'SYN_CUSTOMER':null,correlation]);
    inserted.push(approval);await tx.query('SET CONSTRAINTS ALL IMMEDIATE');});
  // Without a policy the legacy path records a one-paise discount, leaving one paise to refund.
  await change(1,'discount','customer_agreement','SYN_PRE_POLICY',{pre_tax:1,taxable:1});
  await policy(s);
  await assert.rejects(change(2,'refund','customer_refund','SYN_UNREVIEWED',{refund:1}),{sqlState:'23514'});
  const cancelled=await s.cancel(s.input,randomUUID(),s.operator.token,other.json().id);assert.equal(cancelled.statusCode,200,cancelled.body);
  const source=(await s.db.adminQuery('SELECT id,correlation_id FROM shipit.booking_cancellations')).rows[0]!;
  await assert.rejects(change(2,'cancellation','booking_cancelled','booking_cancellation:'+source.id,{pre_tax:tax.pre_tax_paise-1,taxable:tax.taxable_basis_paise-1,
    cgst:tax.cgst_paise,sgst:tax.sgst_paise,igst:tax.igst_paise,rounding:tax.rounding_adjustment_paise},source.correlation_id,s.operator.id),{sqlState:'23514'});
  assert.deepEqual(inserted,['SYN_PRE_POLICY','SYN_UNREVIEWED','booking_cancellation:'+source.id]);
  assert.deepEqual((await s.db.adminQuery('SELECT approval_ref FROM shipit.financial_changes WHERE booking_id=$1',[s.bookingId])).rows,[{approval_ref:'SYN_PRE_POLICY'}]);
});

await test('takes a bagged parcel out of its lot through the lot command, but only when the bag is the one obstacle',{timeout:60000},async t=>{
  const s=await setup(t),m=await money(s);
  await s.db.prepareLots();
  const post=(path:string,body:Record<string,unknown>)=>s.app.inject({method:'POST',url:`/api/v1/${path}?${s.query}`,
    cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:body});
  const lot=await post('lots',{name:'Synthetic cancellation lot',destination_key:'SYN_DEST'});assert.equal(lot.statusCode,201,lot.body);
  const attach=await post(`lots/${lot.json().id}/parcels`,{parcel_id:s.booked.parcels[0].id,expected_version:1});assert.equal(attach.statusCode,200,attach.body);
  const active=async()=>(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.lot_memberships WHERE ended_at IS NULL')).rows[0]!.n;
  // A UPI payment with no UPI account to refund through blocks the cancel, so the bag is left alone.
  assert.equal((await s.pay({...collectionInput(1000),method:'upi'})).statusCode,200);
  const body={...s.input,expected_payment_version:1};
  assert.equal((await s.preview()).json().blocked_reason,'refund_source_missing');
  assert.equal((await s.cancel(body)).json().error.code,'BOOKING_CANCELLATION_BLOCKED');assert.equal(await active(),1);
  // Once the account exists the bag is the only obstacle: the preview offers the cancel and says so.
  await m.account('upi');
  const ready=(await s.preview()).json();assert.equal(ready.blocked_reason,null);assert.equal(ready.in_bag,true);
  const key=randomUUID(),cancelled=await s.cancel(body,key);assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.equal(await active(),0);
  const ended=(await s.db.adminQuery("SELECT end_reason FROM shipit.lot_memberships")).rows;assert.deepEqual(ended,[{end_reason:'removed'}]);
  const lotRow=(await s.db.adminQuery('SELECT version FROM shipit.lots WHERE id=$1',[lot.json().id])).rows[0]!;assert.equal(lotRow.version,3);
  const removals=(await s.db.adminQuery("SELECT count(*)::int n FROM shipit.lot_commands WHERE operation_id='api.v1.lots.membership.remove' AND principal_id=$1",[s.operator.id])).rows[0]!.n;assert.equal(removals,1);
  assert.equal((await s.db.adminQuery("SELECT count(DISTINCT status)::int n FROM shipit.parcels WHERE booking_id=$1 AND status<>'cancelled'",[s.bookingId])).rows[0]!.n,0);
  // A retried cancel with the same key replays without touching the lot again.
  const replay=await s.cancel(body,key);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,cancelled.json().id);
  assert.equal((await s.db.adminQuery('SELECT version FROM shipit.lots WHERE id=$1',[lot.json().id])).rows[0]!.version,3);
});

await test('cancels an unbilled monthly account booking and blocks one already on an issued statement',{timeout:60000},async t=>{
  const s=await statementSetup(t),unbilled=await s.book(),billed=await s.book();
  const input={reason:'Account booking requested cancellation',expected_financial_version:0,expected_payment_version:0};
  const preview=await s.booking.cancellationPreview(s.operator.token,q,unbilled.id,randomUUID());
  assert.equal(preview.blocked_reason,null);assert.equal(preview.refund_paise,'0');
  const saved=await s.booking.cancelBooking(s.operator.token,q,unbilled.id,randomUUID(),input,randomUUID());
  assert.equal(saved.outstanding_paise,preview.outstanding_paise);assert.equal(saved.refunded_paise,'0');
  await s.issue();
  assert.ok((await s.db.adminQuery('SELECT 1 FROM shipit.account_statement_lines WHERE booking_id=$1',[billed.id])).rows.length);
  assert.equal((await s.booking.cancellationPreview(s.operator.token,q,billed.id,randomUUID())).blocked_reason,'account_billed');
  await assert.rejects(s.booking.cancelBooking(s.operator.token,q,billed.id,randomUUID(),input,randomUUID()),{code:'BOOKING_CANCELLATION_BLOCKED'});
});

await test('commits a cancellation racing first intake without splitting the booking',async t=>{
  const s=await setup(t);
  const [cancelled,checked]=await Promise.all([s.cancel(),s.checkIn(s.booked.parcels[0].id)]);
  assert.equal(cancelled.statusCode,200,cancelled.body);assert.ok([200,409].includes(checked.statusCode),checked.body);
  const statuses=(await s.db.adminQuery('SELECT status FROM shipit.parcels ORDER BY position')).rows.map(r=>r.status);
  assert.deepEqual(statuses,['cancelled','cancelled']);
});

await test('cancels many bookings for different customers one request and key at a time',async t=>{
  const s=await setup(t);
  const customer=await s.customer.create(s.operator.token,org,A,randomUUID(),{...contact,name:'Second Synthetic Sender',phone:'+1 202-555-0177'},randomUUID());
  const second=await s.book({...s.body,customer_id:customer.id});assert.equal(second.statusCode,201,second.body);
  const bookings=[s.bookingId,second.json().id as string];
  const results=await Promise.all(bookings.map(booking=>s.cancel(s.input,randomUUID(),s.operator.token,booking)));
  assert.deepEqual(results.map(r=>r.statusCode),[200,200]);
  assert.deepEqual((await s.db.adminQuery('SELECT DISTINCT state FROM shipit.bookings')).rows,[{state:'cancelled'}]);
});
