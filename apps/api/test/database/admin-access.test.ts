import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingSetup} from '../booking-support.ts';
import {org,A,B,otherOrg,C} from '../audit-support.ts';
import {contact} from '../customer-support.ts';
import {draft,input} from '../pricing-support.ts';
import {taxPolicy,taxFacts} from '../tax-support.ts';
import {finalizedManifest} from '../route-support.ts';
import {createBookingService} from '../../src/modules/bookings/service.ts';
import {createReceiptService} from '../../src/modules/receipts/service.ts';
import {createParcelService} from '../../src/modules/parcels/service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../../src/modules/cashbook/effect-service.ts';
import * as scopes from '../../src/modules/memberships/service.ts';
import {createDeliveryWorker} from '../../src/modules/auth/worker.ts';
import type {Delivery} from '../../src/modules/auth/delivery.ts';

await test('#190 owner-only onboarding and admin-only counter through receipt and dispatch retain real actor and tenant scope',{timeout:60000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareReceipts();await s.db.prepareRoutes();await s.db.prepareCashbook();
 const newcomer=await s.user(),onboarded=await s.memberships.onboard(newcomer.token,randomUUID(),{
  display_name:'Synthetic Independent Owner',franchise:{display_name:'Synthetic Main Counter',franchise_code:'MAIN'},
 });
 const freshOrg=onboarded.organization.id,freshFranchise=onboarded.franchise.id;
 const context=await s.memberships.operatorContext(newcomer.token,freshFranchise);
 assert.deepEqual(context.franchises[0]!.roles,['org_admin']);
 let ownerParcel='';
 for(const actor of [
  {...newcomer,organization:freshOrg,franchise:freshFranchise},
  {...s.local,organization:org,franchise:A},
 ]){
  const {token,organization,franchise}=actor,q={organization_id:organization,franchise_id:franchise};
  if(organization===freshOrg){
   const price=await s.create(draft,token,randomUUID(),franchise,organization);assert.equal(price.statusCode,201,price.body);
   assert.equal((await s.publish(price.json().id,{expected_version:1},token,randomUUID(),franchise,organization)).statusCode,200);
   const tax=await s.tax.create(token,organization,franchise,randomUUID(),taxPolicy,randomUUID());
   await s.tax.publish(token,organization,franchise,tax.id,randomUUID(),{expected_version:1},randomUUID());
  }
  const customer=await s.customer.create(token,organization,franchise,randomUUID(),contact,randomUUID());
  const quoted=await s.quote(input,token,randomUUID(),franchise,organization);assert.equal(quoted.statusCode,200,quoted.body);
  const intent={quote_id:quoted.json().id,pricing_input:input,facts:taxFacts};
  const prepared=await s.tax.prepare(token,organization,franchise,randomUUID(),intent,randomUUID());
  const tax=await s.tax.calculate(token,organization,franchise,randomUUID(),{intent_id:prepared.id},randomUUID());
  const body={...s.body,customer_id:customer.id,tax_intent:intent,tax_calculation_id:tax.id},key=randomUUID();
  const booked=await s.book(body,key,token,franchise,organization);assert.equal(booked.statusCode,201,booked.body);
  const value=booked.json(),id=value.id,parcel=value.parcels[0].id;
  if(actor.id===newcomer.id)ownerParcel=parcel;
  // New service instances read durable facts and replay the same actor-bound intent.
  const restarted=createBookingService(s.db.runtimePool(),s.keys.browser,s.clock);
  assert.deepEqual(await restarted.create(token,organization,franchise,key,body,randomUUID()),value);
  const receipts=createReceiptService(s.db.runtimePool()),receipt=await receipts.read(token,id,null,q,randomUUID());
  assert.deepEqual(await createReceiptService(s.db.runtimePool()).read(token,id,null,q,randomUUID()),receipt);
  const accountKey=randomUUID(),account=await createReceivingAccountService(s.pool).configure(token,null,q,accountKey,['idempotency-key',accountKey],{
   name:'Synthetic owner/admin cash drawer',methods:['cash'],other_method_name:null,active:true,expected_version:0,
  },randomUUID());
  const locationKey=randomUUID(),location=await createCashLocationService(s.pool,true).configure(token,null,q,locationKey,['idempotency-key',locationKey],{
   account_id:account.id,expected_account_version:1,custodian_id:actor.id,name:'Synthetic real custodian',active:true,expected_version:0,
  },randomUUID());
  const moneyKey=randomUUID(),money=await createMoneyReceiptService(s.pool).record(token,q,moneyKey,['idempotency-key',moneyKey],{
   customer_id:customer.id,account_id:account.id,expected_account_version:1,amount_paise:100,currency:'INR',method:'cash',
   receiver_id:actor.id,custodian_id:actor.id,occurred_at:new Date().toISOString(),external_reference:null,
   allocations:[{booking_id:id,amount_paise:100,context:'to_pay',expected_payment_version:0}],
  },randomUUID());
  assert.equal(money.received_paise,100);assert.equal(money.unallocated_paise,0);
  const position=await createCashbookEffectService(s.pool).position(token,q,randomUUID()),expenseKey=randomUUID();
  const expense=await createCashbookRequestService(s.pool,true).submit(token,q,expenseKey,['idempotency-key',expenseKey],{
   kind:'expense',payment_method:'cash',source_location_id:location.id,source_revision_id:location.revision_id,
   target_location_id:null,target_revision_id:null,expected_source_version:position.source_version,amount_paise:1,currency:'INR',
   category:'supplies',payee:'Synthetic supplier',responsible_employee_id:actor.id,reason:'Synthetic office supplies',occurred_at:new Date().toISOString(),
  },randomUUID());
  assert.equal(expense.actor_id,actor.id);assert.equal(expense.responsible_employee_id,actor.id);
  assert.deepEqual(await receipts.read(token,id,null,q,randomUUID()),receipt);
  const lifecycle=createParcelService(s.pool,s.clock),intakeKey=randomUUID();
  await lifecycle.execute(token,parcel,q,intakeKey,['idempotency-key',intakeKey],{
   expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID(),
  },'parcels.check_in',randomUUID());
  const manifest=await finalizedManifest(s.pool,s.keys.browser,token,[parcel],organization,franchise),dispatchKey=randomUUID();
  await lifecycle.execute(token,parcel,q,dispatchKey,['idempotency-key',dispatchKey],{
   expected_version:2,evidence_ref:randomUUID(),manifest_id:manifest,
  },'parcels.dispatch',randomUUID());
  const facts=(await s.db.adminQuery<{status:string;actor_id:string}>(`SELECT p.status,c.principal_id AS actor_id FROM shipit.parcels p
   JOIN shipit.booking_commands c ON c.booking_id=p.booking_id WHERE p.id=$1`,[parcel])).rows[0]!;
  assert.equal(facts.status,'dispatched');assert.equal(facts.actor_id,actor.id);
  assert.equal((await s.db.adminQuery('SELECT id FROM shipit.memberships WHERE user_id=$1',[actor.id])).rows.length,1);
 }
 await assert.rejects(s.customer.create(newcomer.token,org,A,randomUUID(),contact,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const privateCustomer=await s.customer.create(s.admin.token,org,B,randomUUID(),contact,randomUUID());
 await assert.rejects(s.customer.read(s.local.token,org,B,privateCustomer.id,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(s.customer.create(s.admin.token,otherOrg,C,randomUUID(),contact,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await s.auth.logout(newcomer.token);
 await assert.rejects(s.memberships.operatorContext(newcomer.token),{code:'UNAUTHENTICATED'});
 const address=(await s.db.adminQuery<{address:string}>('SELECT address FROM shipit.auth_identifiers WHERE user_id=$1',[newcomer.id])).rows[0]!.address;
 const challenge=await s.auth.start('email',address,'synthetic-browser','synthetic-ip');
 let delivered:Delivery|undefined;
 const worker=createDeliveryWorker(s.pool,s.keys,async message=>{delivered=message;return {state:'accepted',reference:'synthetic-login'};});
 await worker.tick();assert.ok(delivered);
 const login=await s.auth.verify(challenge.challenge_id,delivered.code,'synthetic-browser','synthetic-ip');assert.ok(!login.linked&&login.token);
 const signedIn=await s.memberships.operatorContext(login.token,freshFranchise);
 assert.deepEqual(signedIn.franchises[0]!.roles,['org_admin']);
 const persisted=await createBookingService(s.db.runtimePool(),s.keys.browser).read(login.token,ownerParcel,{organization_id:freshOrg,franchise_id:freshFranchise},randomUUID());
 assert.equal(persisted.status,'dispatched');
});

await test('#190 live administrative coordinators resolve only owned or explicitly granted franchises',{timeout:60000},async t=>{
 const s=await bookingSetup(t),both=await s.grant('franchise_admin',[A,B]);
 const boundaries=[
  ['outbox.redrive',scopes.withOutboxScope],['whatsapp.write',scopes.withWhatsappScope],
  ['finance.approve',scopes.withFinancialScope],['receiving_accounts.configure',scopes.withReceivingAccountScope],
  ['money_receipts.record',scopes.withMoneyReceiptScope],['cashbook.configure',scopes.withCashbookScope],
  ['agent_money.configure',scopes.withAgentMoneyScope],['agent_statement.decide',scopes.withAgentStatementScope],
  ['cashbook.close.decide',scopes.withCashCloseScope],['customer_accounts.configure',scopes.withCustomerAccountScope],
  ['reconciliation.import',scopes.withReconciliationScope],
 ] as const;
 for(const [action,resolve] of boundaries){
  // Real transaction/session/membership resolution; no domain callback may widen this capability.
  const run=(token:string,franchise:string)=>{
   const call=resolve as (db:typeof s.pool,token:string,org:string,franchise:string,action:string,correlation:string,work:(value:unknown)=>Promise<boolean>)=>Promise<boolean>;
   return call(s.pool,token,org,franchise,action,randomUUID(),async value=>{
    const candidate=value as {context?:{actor:{id:string};permittedFranchiseIds:readonly string[]};access?:{context:{actor:{id:string};permittedFranchiseIds:readonly string[]}};command?:{context:{actor:{id:string};permittedFranchiseIds:readonly string[]}}};
    const context=candidate.context??candidate.access?.context??candidate.command?.context;
    assert.ok(context,action);assert.deepEqual(context.permittedFranchiseIds,[franchise]);return true;
   });
  };
  assert.equal(await run(s.admin.token,B),true,action);
  assert.equal(await run(s.local.token,A),true,action);
  assert.equal(await run(both.token,B),true,action);
  await assert.rejects(run(s.local.token,B),{code:'RESOURCE_NOT_FOUND'},action);
  await assert.rejects(run(s.admin.token,C),{code:'RESOURCE_NOT_FOUND'},action);
 }
 await s.memberships.revokeMembership(s.admin.token,both.member.id,{expected_version:both.member.version});
 await assert.rejects(scopes.withBookingTenantScope(s.pool,both.token,org,A,randomUUID(),async()=>true),{code:'RESOURCE_NOT_FOUND'});
});
