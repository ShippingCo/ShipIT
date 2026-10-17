import {createPricingService} from '../../src/modules/pricing/service.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingSetup} from '../booking-support.ts';
import {createCustomerAccountService} from '../../src/modules/customer-accounts/service.ts';
import {org,A,B} from '../audit-support.ts';
const q={organization_id:org,franchise_id:A};
await test('account revisions are scoped, immutable, replayable and admin-only',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);const service=createCustomerAccountService(s.pool,true,s.clock);
 const body={expected_version:0,debtor_customer_id:s.source.id,shipping_customer_ids:[s.source.id],name:'Fictional Monthly Account',billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'SYN_ATTESTATION'},closing_day:31,due_days:10,credit_limit_paise:100000,state:'active',reason:'Owner approved terms'};
 const key=randomUUID(),headers=['idempotency-key',key];
 const first=await service.configure(s.local.token,null,q,key,headers,body,randomUUID());assert.equal(first.version,1);
 assert.deepEqual(await service.configure(s.local.token,null,q,key,headers,body,randomUUID()),first);
 const endpoint='/api/v1/customer-accounts?'+new URLSearchParams(q);
 const replayHttp=await s.app.inject({method:'POST',url:endpoint,headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(s.local.token),payload:JSON.stringify(body)});assert.equal(replayHttp.statusCode,200,replayHttp.body);assert.deepEqual(replayHttp.json(),first);
 const noCsrf=await s.app.inject({method:'POST',url:endpoint,headers:{'content-type':'application/json','idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:JSON.stringify(body)});assert.equal(noCsrf.statusCode,403);
 const massAssigned=await s.app.inject({method:'POST',url:endpoint,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:JSON.stringify({...body,organization_id:randomUUID()})});assert.equal(massAssigned.statusCode,422);
 const unauthorized=await s.app.inject({method:'POST',url:endpoint,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload:JSON.stringify(body)});assert.equal(unauthorized.statusCode,403);
 await assert.rejects(service.configure(s.operator.token,null,q,randomUUID(),headers,body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.read(s.local.token,first.id,{...q,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const next=await service.configure(s.local.token,first.id,q,randomUUID(),headers,{...body,expected_version:1,credit_limit_paise:90000},randomUUID());assert.equal(next.version,2);
 assert.deepEqual(await service.configure(s.local.token,null,q,key,headers,body,randomUUID()),first);
 assert.equal((await service.credit(s.local.token,first.id,q,randomUUID())).available_paise,'90000');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.customer_account_audit_events')).rows[0]!.n,2);
 await assert.rejects(s.db.adminQuery('UPDATE shipit.customer_account_revisions SET credit_limit_paise=1'));
});

import {createBookingService} from '../../src/modules/bookings/service.ts';
import {input as priceInput,start} from '../pricing-support.ts';
import {taxFacts} from '../tax-support.ts';
await test('account negotiated price is frozen and concurrent bookings cannot overspend credit',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);const service=createCustomerAccountService(s.pool,true,s.clock),bookings=createBookingService(s.pool,s.keys.browser,s.clock,true);
 const headers=['idempotency-key','synthetic'];
 const a=await service.configure(s.local.token,null,q,randomUUID(),headers,{expected_version:0,debtor_customer_id:s.source.id,shipping_customer_ids:[s.source.id],name:'Synthetic Company',billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'ATTESTED'},closing_day:31,due_days:10,credit_limit_paise:100000,state:'active',reason:'Approved credit'},randomUUID());
 const rate={expected_version:0,effective_from:start,effective_to:'2099-01-02T00:00:00Z',approval_ref:'SYN_RATE',rules:[{destination_key:priceInput.destination_key,service:priceInput.service,min_weight_grams:1,max_weight_grams:null,freight_paise:57143,packing_paise:0}]};
 const revision=await service.publishRate(s.local.token,a.id,q,randomUUID(),headers,rate,randomUUID());
 for(const rules of [[{...rate.rules[0],freight_paise:-1}],[{...rate.rules[0],min_weight_grams:1.5}],[rate.rules[0],rate.rules[0]],[{...rate.rules[0],extra:'unapproved'}]]) {
  await assert.rejects(s.db.adminQuery(`INSERT INTO shipit.customer_account_rates(id,organization_id,franchise_id,account_id,version,effective_from,effective_to,approval_ref,rules,actor_id,correlation_id,key_digest,fingerprint)
   SELECT $1,organization_id,franchise_id,account_id,version+1,effective_from,effective_to,approval_ref,$2,actor_id,$3,$4,fingerprint FROM shipit.customer_account_rates WHERE id=$5`,[randomUUID(),JSON.stringify(rules),randomUUID(),'f'.repeat(64),revision.id]));
 }
 assert.equal((await service.history(s.local.token,a.id,q,randomUUID(),true)).items.length,1);
 const pricing={...priceInput,customer_account_id:a.id};
 const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID());assert.equal(quote.freight_paise,57143);assert.equal(quote.account?.rate_revision_id,revision.id);assert.equal(quote.rule_id,null);
 const taxIntent={quote_id:quote.id,pricing_input:pricing,facts:taxFacts};
 const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),taxIntent,randomUUID());
 const tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());assert.equal(tax.final_payable_paise,60000);
 const body={...s.body,tax_intent:taxIntent,tax_calculation_id:tax.id};
 const keys=[randomUUID(),randomUUID()];const outcomes=await Promise.allSettled(keys.map(key=>bookings.create(s.operator.token,org,A,key,body,randomUUID())));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const denied=outcomes.find(x=>x.status==='rejected');assert.equal(denied?.status==='rejected'&&denied.reason.code,'ACCOUNT_CREDIT_EXCEEDED');
 const won=outcomes.findIndex(x=>x.status==='fulfilled'),booked=(outcomes[won] as PromiseFulfilledResult<Awaited<ReturnType<typeof bookings.create>>>).value;
 assert.equal(booked.account?.due_date,'2099-02-10');assert.equal(booked.charges.pricing.account?.rate_source,'account');
 assert.deepEqual(await bookings.create(s.operator.token,org,A,keys[won],body,randomUUID()),booked);
 assert.equal((await service.credit(s.local.token,a.id,q,randomUUID())).outstanding_paise,'60000');
 await service.publishRate(s.local.token,a.id,q,randomUUID(),headers,{...rate,expected_version:1,rules:[{...rate.rules[0],freight_paise:12000}]},randomUUID());
 await assert.rejects(bookings.create(s.operator.token,org,A,randomUUID(),body,randomUUID()),{code:'QUOTE_STALE'});
 const saved=(await s.db.adminQuery('SELECT pricing_snapshot FROM shipit.bookings WHERE id=$1',[booked.id])).rows[0]!.pricing_snapshot as {freight_paise:number};assert.equal(saved.freight_paise,57143);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.customer_account_bookings')).rows[0]!.n,1);
});

await test('credit exceptions bind one exact intent, are admin-only and cannot bypass held accounts',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);const service=createCustomerAccountService(s.pool,true,s.clock),bookings=createBookingService(s.pool,s.keys.browser,s.clock,true),headers=['idempotency-key','synthetic'];
 const profile={expected_version:0,debtor_customer_id:s.source.id,shipping_customer_ids:[s.source.id],name:'Synthetic Credit Approval',billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'ATTESTED'},closing_day:1,due_days:0,credit_limit_paise:0,state:'active',reason:'Approved credit'};
 const a=await service.configure(s.local.token,null,q,randomUUID(),headers,profile,randomUUID());
 const pricing={...priceInput,customer_account_id:a.id},quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID());assert.equal(quote.account?.rate_source,'normal');
 const taxIntent={quote_id:quote.id,pricing_input:pricing,facts:taxFacts},intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),taxIntent,randomUUID());
 const tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID()),body={...s.body,tax_intent:taxIntent,tax_calculation_id:tax.id};
 const request={operator_id:s.operator.id,booking:body,reason:'Owner approved this shipment'};
 await assert.rejects(service.approve(s.operator.token,q,randomUUID(),headers,request,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(bookings.create(s.operator.token,org,A,randomUUID(),body,randomUUID()),{code:'ACCOUNT_CREDIT_EXCEEDED'});
 const approval=await service.approve(s.local.token,q,randomUUID(),headers,request,randomUUID());assert.equal(Date.parse(approval.expires_at),Math.min(Date.parse(quote.expires_at),Date.parse(tax.expires_at)));
 await assert.rejects(bookings.create(s.operator.token,org,A,randomUUID(),{...body,credit_approval_id:approval.id,parcels:[{...body.parcels[0],recipient:{...body.parcels[0]!.recipient,name:'Changed Recipient'}}]},randomUUID()),{code:'ACCOUNT_APPROVAL_INVALID'});
 const key=randomUUID(),approved={...body,credit_approval_id:approval.id},saved=await bookings.create(s.operator.token,org,A,key,approved,randomUUID());assert.equal(saved.account?.approval_id,approval.id);
 assert.deepEqual(await bookings.create(s.operator.token,org,A,key,approved,randomUUID()),saved);
 await assert.rejects(bookings.create(s.operator.token,org,A,randomUUID(),approved,randomUUID()),{code:'ACCOUNT_APPROVAL_INVALID'});
 await service.configure(s.local.token,a.id,q,randomUUID(),headers,{...profile,expected_version:1,state:'held'},randomUUID());
 await assert.rejects(s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID()),{code:'ACCOUNT_HELD'});
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.customer_account_audit_events WHERE action='customer_accounts.approve'")).rows[0]!.n,1);
});

import {otherOrg,C} from '../audit-support.ts';
import {paymentFault} from '../payment-support.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {contact} from '../customer-support.ts';
import {draft} from '../pricing-support.ts';
const headers=['idempotency-key','synthetic'];
const profile=(customer:string,limit=100000)=>({expected_version:0,debtor_customer_id:customer,shipping_customer_ids:[customer],name:'Synthetic Same Company',billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'ATTESTED'},closing_day:1,due_days:0,credit_limit_paise:limit,state:'active',reason:'Owner approved terms'});
async function accountIntent(s:Awaited<ReturnType<typeof bookingSetup>>,account:string) {
 const pricing={...priceInput,customer_account_id:account},quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID());
 const tax_intent={quote_id:quote.id,pricing_input:pricing,facts:taxFacts},intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),tax_intent,randomUUID()),tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 return {quote,tax,body:{...s.body,tax_intent,tax_calculation_id:tax.id}};
}
await test('request-review-approve is scoped, recovers lost acknowledgement and rechecks current grants',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);const service=createCustomerAccountService(s.pool,true,s.clock),disabled=createCustomerAccountService(s.pool,false,s.clock);
 const a=await service.configure(s.local.token,null,q,randomUUID(),headers,profile(s.source.id,0),randomUUID()),{body}=await accountIntent(s,a.id),key=randomUUID();
 const invoke=(source=service)=>source.requestCredit(s.operator.token,q,key,headers,body,randomUUID());
 await assert.rejects(invoke(createCustomerAccountService(paymentFault(s.pool,'COMMIT','after'),true,s.clock)),{code:'TEMPORARILY_UNAVAILABLE'});
 const request=await invoke(disabled);assert.deepEqual(await invoke(),request);
 await assert.rejects(service.requestCredit(s.operator.token,q,key,headers,{...body,parcels:[{...body.parcels[0],recipient:{...body.parcels[0]!.recipient,name:'Different'}}]},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 const stranger=await s.grant('operator',[A]),readonly=await s.grant('read_only',[A]),beta=await s.beta('franchise_admin');
 await assert.rejects(service.creditRequest(stranger.token,request.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.pendingCredit(s.operator.token,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.read(readonly.token,a.id,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.read(beta.token,a.id,{organization_id:otherOrg,franchise_id:C},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.history(beta.token,a.id,{organization_id:otherOrg,franchise_id:C},randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 const pending=await service.pendingCredit(s.local.token,q,randomUUID());assert.equal(pending.items.length,1);assert.equal(pending.items[0]!.id,request.id);
 const review=await service.reviewCredit(s.local.token,request.id,q,randomUUID());assert.equal(review.customer_id,s.source.id);assert.equal(review.parcels[0]!.recipient_name,'Synthetic Recipient');
 const approvalKey=randomUUID(),approve=(source=service)=>source.approveRequest(s.local.token,request.id,q,approvalKey,headers,{reason:'Reviewed this exact intent'},randomUUID());
 await assert.rejects(approve(createCustomerAccountService(paymentFault(s.pool,'COMMIT','after'),true,s.clock)),{code:'TEMPORARILY_UNAVAILABLE'});
 const approval=await approve(disabled);assert.deepEqual(await approve(),approval);assert.equal((await service.creditRequest(s.operator.token,request.id,q,randomUUID())).approval_id,approval.id);
 await assert.rejects(service.approveRequest(s.local.token,request.id,q,randomUUID(),headers,{reason:'Duplicate new approval'},randomUUID()),{code:'ACCOUNT_APPROVAL_INVALID'});
 assert.equal((await service.pendingCredit(s.local.token,q,randomUUID())).items.length,0);
 await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:s.local.member.version});
 await assert.rejects(approve(),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(createBookingService(s.pool,s.keys.browser,s.clock,true).create(s.operator.token,org,A,randomUUID(),{...body,credit_approval_id:approval.id},randomUUID()),{code:'ACCOUNT_APPROVAL_INVALID'});
 const audit=(await s.db.adminQuery('SELECT action FROM shipit.customer_account_audit_events ORDER BY action')).rows.map(r=>r.action);assert.deepEqual(audit,['customer_accounts.approve','customer_accounts.configure','customer_accounts.request']);
});
await test('overdue debt blocks booking and approval; an explicit debtor allocation restores available credit',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);const service=createCustomerAccountService(s.pool,true,s.clock),bookings=createBookingService(s.pool,s.keys.browser,s.clock,true);
 const debtor=await s.customer.create(s.operator.token,org,A,randomUUID(),{...contact,name:'Separate Synthetic Debtor',phone:'+12025550102'},randomUUID());
 const a=await service.configure(s.local.token,null,q,randomUUID(),headers,{...profile(debtor.id),shipping_customer_ids:[s.source.id]},randomUUID());
 const first=await accountIntent(s,a.id),booked=await bookings.create(s.operator.token,org,A,randomUUID(),first.body,randomUUID());assert.equal(booked.account?.debtor.source_customer_id,debtor.id);assert.equal(booked.customer.source_customer_id,s.source.id);
 const cutoff=await service.credit(s.local.token,a.id,q,randomUUID()),sources=await service.sources(s.operator.token,a.id,{...q,as_of:cutoff.as_of},randomUUID());assert.equal(sources.items[0]!.booking_id,booked.id);assert.equal(sources.items.reduce((sum,r)=>sum+BigInt(r.outstanding_paise),0n).toString(),cutoff.outstanding_paise);
 s.setNow('2099-01-01T18:31:00Z');const next=await accountIntent(s,a.id);
 await assert.rejects(bookings.create(s.operator.token,org,A,randomUUID(),next.body,randomUUID()),{code:'ACCOUNT_OVERDUE'});
 await assert.rejects(service.requestCredit(s.operator.token,q,randomUUID(),headers,next.body,randomUUID()),{code:'ACCOUNT_OVERDUE'});
 await assert.rejects(service.approve(s.local.token,q,randomUUID(),headers,{operator_id:s.operator.id,booking:next.body,reason:'Cannot override overdue'},randomUUID()),{code:'ACCOUNT_OVERDUE'});
 // Read at the real server cutoff, then prove a later backdated allocation cannot enter old evidence.
 const live=createCustomerAccountService(s.pool,true);await s.db.adminQuery('SELECT pg_sleep(0.002)');
 const beforePayment=await live.credit(s.local.token,a.id,q,randomUUID());assert.equal(beforePayment.outstanding_paise,String(first.tax.final_payable_paise));
 const receiving=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,randomUUID(),headers,{name:'Synthetic receiving',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const receipts=createMoneyReceiptService(s.pool),input={customer_id:debtor.id,account_id:receiving.id,expected_account_version:1,method:'cash',currency:'INR',amount_paise:first.tax.final_payable_paise,receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:'2026-01-01T00:00:00Z',external_reference:null,allocations:[]};
 const advance=await receipts.record(s.operator.token,q,randomUUID(),headers,input,randomUUID());assert.equal((await service.credit(s.local.token,a.id,q,randomUUID())).outstanding_paise,String(first.tax.final_payable_paise));
 await receipts.allocate(s.operator.token,advance.receipt_id,q,randomUUID(),headers,{expected_version:1,allocations:[{booking_id:booked.id,amount_paise:first.tax.final_payable_paise,context:'to_pay',expected_payment_version:0}]},randomUUID());
 const priorSources=await live.sources(s.local.token,a.id,{...q,as_of:beforePayment.as_of},randomUUID());
 assert.equal(priorSources.items[0]!.outstanding_paise,beforePayment.outstanding_paise);assert.equal(priorSources.items[0]!.collected_paise,'0');
 assert.equal((await service.credit(s.local.token,a.id,q,randomUUID())).outstanding_paise,'0');assert.equal((await service.credit(s.local.token,a.id,q,randomUUID())).overdue_paise,'0');
 await bookings.create(s.operator.token,org,A,randomUUID(),next.body,randomUUID());
});
await test('150 normal versus 120 negotiated freezes rate evidence and date boundary matches SQL',{timeout:30000},async t=>{
 const s=await bookingSetup(t,undefined,{pricingDraft:{...draft,rules:[{...draft.rules[0]!,freight_paise:15000,packing_paise:0}]}});await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);
 const service=createCustomerAccountService(s.pool,true,s.clock),a=await service.configure(s.local.token,null,q,randomUUID(),headers,profile(s.source.id),randomUUID());
 const ordinary=await s.pricing.quote(s.operator.token,org,A,randomUUID(),priceInput,randomUUID());assert.equal(ordinary.freight_paise,15000);
 const rate={expected_version:0,effective_from:start,effective_to:'2099-01-02T00:00:00Z',approval_ref:'SYN120',rules:[{...draft.rules[0]!,freight_paise:12000,packing_paise:0}]};
 await service.publishRate(s.local.token,a.id,q,randomUUID(),headers,rate,randomUUID());const prepared=await accountIntent(s,a.id);assert.equal(prepared.quote.freight_paise,12000);
 const booking=await createBookingService(s.pool,s.keys.browser,s.clock,true).create(s.operator.token,org,A,randomUUID(),prepared.body,randomUUID());
 await service.publishRate(s.local.token,a.id,q,randomUUID(),headers,{...rate,expected_version:1,rules:[{...rate.rules[0]!,freight_paise:13000}]},randomUUID());
 assert.equal((await accountIntent(s,a.id)).quote.freight_paise,13000);assert.equal((await s.db.adminQuery('SELECT pricing_snapshot FROM shipit.bookings WHERE id=$1',[booking.id])).rows[0]!.pricing_snapshot.freight_paise,12000);
 // A valid schedule with no matching weight falls back; expiry cannot resurrect an older schedule.
 await service.publishRate(s.local.token,a.id,q,randomUUID(),headers,{...rate,expected_version:2,effective_to:'2099-01-01T00:01:00Z',rules:[{...rate.rules[0]!,min_weight_grams:1000,max_weight_grams:null}]},randomUUID());
 const unmatched=await accountIntent(s,a.id);assert.equal(unmatched.quote.freight_paise,15000);assert.equal(unmatched.quote.account?.rate_source,'normal');assert.equal(unmatched.quote.account?.rate_revision_id,null);assert.ok(unmatched.quote.rule_id);
 s.setNow('2099-01-01T00:02:00Z');const expired=await accountIntent(s,a.id);assert.equal(expired.quote.freight_paise,15000);assert.equal(expired.quote.account?.rate_source,'normal');
 for(const [at,closing,days,wanted] of [['2028-02-29T18:29:59Z',31,0,'2028-02-29'],['2028-02-29T18:30:00Z',1,0,'2028-03-01'],['2027-02-28T18:29:59Z',31,10,'2027-03-10'],['2026-12-31T18:30:00Z',31,0,'2027-01-31']] as const){assert.equal((await s.db.adminQuery('SELECT shipit.customer_account_due_date($1,$2,$3)::text due',[at,closing,days])).rows[0]!.due,wanted);}
});

await test('omitted account snapshot cannot commit; disabled new writes preserve existing outcomes',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();s.pricing=createPricingService(s.pool,s.clock,true);
 const service=createCustomerAccountService(s.pool,true,s.clock),a=await service.configure(s.local.token,null,q,randomUUID(),headers,profile(s.source.id),randomUUID()),prepared=await accountIntent(s,a.id),key=randomUUID();
 await assert.rejects(createBookingService(paymentFault(s.pool,'INSERT INTO shipit.customer_account_bookings','omit'),s.keys.browser,s.clock,true).create(s.operator.token,org,A,key,prepared.body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await s.counts())!.bookings,0);assert.equal((await s.counts())!.commands,0);
 const saved=await createBookingService(s.pool,s.keys.browser,s.clock,true).create(s.operator.token,org,A,key,prepared.body,randomUUID());
 const disabled=createBookingService(s.pool,s.keys.browser,s.clock,false);assert.deepEqual(await disabled.create(s.operator.token,org,A,key,prepared.body,randomUUID()),saved);
 await assert.rejects(disabled.create(s.operator.token,org,A,randomUUID(),prepared.body,randomUUID()),{code:'CUSTOMER_ACCOUNTS_DISABLED'});
 await assert.rejects(createPricingService(s.pool,s.clock).quote(s.operator.token,org,A,randomUUID(),{...priceInput,customer_account_id:a.id},randomUUID()),{code:'CUSTOMER_ACCOUNTS_DISABLED'});
 const ordinary=await createPricingService(s.pool,s.clock).quote(s.operator.token,org,A,randomUUID(),priceInput,randomUUID());assert.equal(ordinary.account,undefined);
});

await test('identical company names remain private across franchises and organizations, including retries and rates',{timeout:30000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();const service=createCustomerAccountService(s.pool,true,s.clock);
 const siblingOwner=await s.grant('franchise_admin',[B]),siblingOperator=await s.grant('operator',[B]),foreignAdmin=await s.beta('org_admin');
 const foreignGrant=async(role:string)=>{const actor=await s.user(),invite=await s.memberships.createInvitation(foreignAdmin.token,{organization_id:otherOrg,invitee_user_id:actor.id,role,franchise_ids:[C]});await s.memberships.acceptInvitation(actor.token,{token:invite.acceptance_token});return actor;};
 const foreignOwner=await foreignGrant('franchise_admin'),foreignOperator=await foreignGrant('operator');
 const siblingCustomer=await s.customer.create(siblingOperator.token,org,B,randomUUID(),contact,randomUUID()),foreignCustomer=await s.customer.create(foreignOperator.token,otherOrg,C,randomUUID(),contact,randomUUID());
 const siblingQuery={organization_id:org,franchise_id:B},foreignQuery={organization_id:otherOrg,franchise_id:C},key=randomUUID();
 const first=await service.configure(s.local.token,null,q,key,headers,profile(s.source.id),randomUUID());
 const sibling=await service.configure(siblingOwner.token,null,siblingQuery,randomUUID(),headers,profile(siblingCustomer.id),randomUUID()),foreign=await service.configure(foreignOwner.token,null,foreignQuery,randomUUID(),headers,profile(foreignCustomer.id),randomUUID());
 assert.equal(first.name,sibling.name);assert.equal(first.name,foreign.name);assert.notEqual(first.id,sibling.id);
 const rate={expected_version:0,effective_from:start,effective_to:'2099-01-02T00:00:00Z',approval_ref:'SYN_PRIVATE_RATE',rules:draft.rules};
 await service.publishRate(s.local.token,first.id,q,randomUUID(),headers,rate,randomUUID());
 for(const [actor,selection,customer] of [[siblingOwner,siblingQuery,siblingCustomer],[foreignOwner,foreignQuery,foreignCustomer]] as const){
  const local=await service.list(actor.token,selection,randomUUID());assert.equal(local.items.length,1);assert.equal(local.items[0]!.debtor_customer_id,customer.id);
  for(const id of [first.id,randomUUID()]){
   await assert.rejects(service.read(actor.token,id,selection,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
   await assert.rejects(service.history(actor.token,id,selection,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
   await assert.rejects(service.credit(actor.token,id,selection,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
   await assert.rejects(service.configure(actor.token,id,selection,key,headers,{...profile(customer.id),expected_version:1},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
   await assert.rejects(service.publishRate(actor.token,id,selection,randomUUID(),headers,rate,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  }
  await assert.rejects(service.read(actor.token,first.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(service.configure(actor.token,null,selection,key,headers,profile(s.source.id),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  assert.equal((await service.choices(actor.token,{...selection,customer_id:s.source.id},randomUUID())).items.length,0);
 }
 const accountant=await s.grant('accountant',[A]);assert.equal((await service.read(accountant.token,first.id,q,randomUUID())).id,first.id);
 await assert.rejects(service.configure(accountant.token,null,q,randomUUID(),headers,profile(s.source.id),randomUUID()),{code:'ACTION_FORBIDDEN'});
 assert.equal((await service.read(s.admin.token,sibling.id,siblingQuery,randomUUID())).id,sibling.id);
 await assert.rejects(service.publishRate(s.admin.token,first.id,q,randomUUID(),headers,rate,randomUUID()),{code:'ACTION_FORBIDDEN'});
});
