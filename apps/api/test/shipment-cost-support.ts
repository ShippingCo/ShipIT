import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {pricingSetup,draft,input as pricingInput} from './pricing-support.ts';
import {taxPolicy,taxFacts} from './tax-support.ts';
import {contact} from './customer-support.ts';
import {org,A} from './audit-support.ts';
import {createTaxService} from '../src/modules/tax/service.ts';
import {createCustomerService} from '../src/modules/customers/service.ts';
import {createBookingService} from '../src/modules/bookings/service.ts';
import {createShipmentCostService} from '../src/modules/shipment-costs/service.ts';
import {createContributionService} from '../src/modules/shipment-costs/contribution-service.ts';
import {createAgentFeeService} from '../src/modules/agent-settlements/fee-service.ts';
import {createReceivingAccountService} from '../src/modules/payments/account-service.ts';
import {createCashLocationService} from '../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../src/modules/cashbook/effect-service.ts';
import {startTestDelivery,testDeliveryCode} from './delivery-support.ts';
import type {ShipmentCostInput,ShipmentCostCategory} from '@shippingco/shared';
export const costQuery={organization_id:org,franchise_id:A},costHeaders=(key:string)=>['idempotency-key',key];
/** Production services on a real limited-runtime-role DB. No report/cost output seeds. */
export async function setupShipmentCosts(t:Parameters<typeof pricingSetup>[0]){
 const s=await pricingSetup(t);await s.db.prepareShipmentCosts();const now=Date.now(),from=new Date(now+1000).toISOString(),to=new Date(now+86400000).toISOString();s.setNow(new Date(now-120000).toISOString());
 await s.published({...draft,effective_from:from,effective_to:to,rules:[{...draft.rules[0]!,freight_paise:9751,packing_paise:249}]});
 const tax=createTaxService(s.pool,s.clock),policy=await tax.create(s.local.token,org,A,randomUUID(),{...taxPolicy,effective_from:from,effective_to:to},randomUUID());await tax.publish(s.local.token,org,A,policy.id,randomUUID(),{expected_version:1},randomUUID());
 await delay(Math.max(0,Date.parse(from)-Date.now()));s.setNow(from);
 const customer=await createCustomerService(s.pool,s.keys.browser).create(s.operator.token,org,A,randomUUID(),contact,randomUUID()),booking=createBookingService(s.pool,s.keys.browser,s.clock);
 async function book(parcels=1){const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricingInput,randomUUID()),intentBody={quote_id:quote.id,pricing_input:pricingInput,facts:taxFacts},intent=await tax.prepare(s.operator.token,org,A,randomUUID(),intentBody,randomUUID()),calculation=await tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID()),key=randomUUID();const body={customer_id:customer.id,expected_customer_version:1,tax_calculation_id:calculation.id,tax_intent:intentBody,parcels:Array.from({length:parcels},(_,i)=>({weight_grams:i===0?999-(parcels-1):1,recipient:{name:'Synthetic Cost Recipient',phone:'+1 202-555-0101',address:'21 Fictional Cost Street'}}))};
  return booking.create(s.operator.token,org,A,key,body,randomUUID());}
 const booked=await book(2),costs=createShipmentCostService(s.pool,true),contribution=createContributionService(s.pool),day=new Date(Date.parse(booked.charges.confirmed_at)+19800000).toISOString().slice(0,10),filter={from_day:day,to_day:day,effective_at:null,recorded_at:null};
 const input=(category:ShipmentCostCategory='courier',amount=6000,bookingId=booked.id):ShipmentCostInput=>({source_id:null,expected_version:0,category,state:'actual',amount_paise:amount,effective_at:new Date().toISOString(),reason:'Synthetic invoice evidence',reference:'SYN-INVOICE',supplier:'SYN-SUPPLIER',document:randomUUID(),line:'1',expense_id:null,rate_import_id:null,rate_booking_id:null,allocations:[{booking_id:bookingId,parcel_id:null,amount_paise:amount}]});
 const record=(body:ShipmentCostInput,key=randomUUID(),actor:{id:string;token:string}=s.local)=>costs.record(actor.token,costQuery,body.source_id,key,costHeaders(key),body,randomUUID());
 const capture=(body:unknown=filter,key=randomUUID(),actor:{id:string;token:string}=s.local)=>contribution.create(actor.token,costQuery,key,costHeaders(key),body,randomUUID());
 const na=(category:ShipmentCostCategory,bookingId=booked.id)=>record({...input(category,0,bookingId),state:'not_applicable',supplier:null,document:null,line:null});
 const reviewer=await s.grant('franchise_admin',[A]),accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true),requests=createCashbookRequestService(s.pool,true,true),effects=createCashbookEffectService(s.pool,true,true);
 const ak=randomUUID(),account=await accounts.configure(s.local.token,null,costQuery,ak,costHeaders(ak),{name:'Synthetic cost account',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID()),lk=randomUUID(),location=await locations.configure(s.local.token,null,costQuery,lk,costHeaders(lk),{account_id:account.id,expected_account_version:1,custodian_id:s.operator.id,name:'Synthetic cost drawer',active:true,expected_version:0},randomUUID());
 async function expense(amount:number,extra:Record<string,unknown>={}){const key=randomUUID(),request=await requests.submit(s.local.token,costQuery,key,costHeaders(key),{kind:'expense',source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,payment_method:'cash',expected_source_version:(await effects.position(s.local.token,costQuery,randomUUID())).source_version,amount_paise:amount,currency:'INR',category:'supplies',payee:'Synthetic provider',responsible_employee_id:s.operator.id,reason:'Synthetic applied cost',occurred_at:new Date().toISOString(),...extra},randomUUID());const dk=randomUUID(),decision=await requests.decide(reviewer.token,request.id,costQuery,dk,costHeaders(dk),{decision:'approved',reason:'Synthetic independent cost review',expected_version:1},randomUUID()),apply=randomUUID(),effect=await effects.apply(s.local.token,request.id,costQuery,apply,costHeaders(apply),{decision_id:decision.id,expected_version:2},randomUUID());return {request,effect};}
 async function agentFee(){const agent=await s.grant('delivery_agent',[A]),fees=createAgentFeeService(s.pool,true),key=randomUUID(),term=await fees.configure(s.local.token,agent.id,costQuery,key,costHeaders(key),{expected_version:0,basis:'per_delivery',amount_paise:1000,currency:'INR',valid_from:from,valid_until:to,active:true},randomUUID());
  const live={...s,clock:()=>new Date()},parcel=booked.parcels[0]!.id,start=await startTestDelivery(live,parcel,agent),proofCode=await testDeliveryCode(live,parcel),complete=randomUUID();await start.service.complete(agent.token,parcel,costQuery,complete,costHeaders(complete),{expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:proofCode},false,randomUUID());const proof=(await s.db.adminQuery('SELECT id FROM shipit.delivery_proofs WHERE parcel_id=$1',[parcel])).rows[0]!.id,key2=randomUUID(),earning=await fees.earn(s.local.token,costQuery,key2,costHeaders(key2),{proof_id:proof,term_revision_id:term.resource_id},randomUUID());
  const applied=await expense(1000,{category:'transport',agent_payee_id:agent.id,fee_earning_id:earning.resource_id,fee_cash_paise:0,fee_advance_paise:0,fee_advance_request_id:null});return {...applied,agent,earning,proof};}
 assert.equal(booked.charges.tax.pre_tax_paise,10000);
 return {...s,tax,customer,booking,book,booked,costs,contribution,filter,input,record,capture,na,expense,agentFee,reviewer,location,requests,effects};
}
