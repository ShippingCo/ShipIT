import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { DatabaseError } from '@shippingco/db';
import assert from 'node:assert/strict';
import { bookingSetup } from './booking-support.ts';
import { input as pricingInput } from './pricing-support.ts';
import { taxFacts } from './tax-support.ts';
import { org,A } from './audit-support.ts';
export const collectionInput=(amount:number,reference:string=randomUUID())=>({amount_paise:amount,currency:'INR' as const,context:'to_pay' as const,method:'cash' as const,collection_reference:reference});
export function paymentFault(pool:DatabasePool,point:string,mode:'before'|'after'|'omit'='after'):DatabasePool {
 return {...pool,async connect(){const c=await pool.connect();return {release:discard=>c.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
  if(sql.includes(point)&&mode==='before')throw new DatabaseError('DB_CONNECTION_FAILED');
  if(sql.includes(point)&&mode==='omit')return {rows:[],rowCount:0,command:'SELECT',oid:0,fields:[]};
  const r=await c.query<Row>(sql,params);if(sql.includes(point)&&mode==='after')throw new DatabaseError('DB_CONNECTION_FAILED');return r;
 }};}};
}
export async function paymentSetup(t:Parameters<typeof bookingSetup>[0],requestedGross?:50000|100000) {
 const s=await bookingSetup(t);await s.db.preparePayments();
 let body=s.body;
 if(requestedGross){
  const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.operator.id,role:'franchise_admin',franchise_ids:[A]});
  await s.memberships.acceptInvitation(s.operator.token,{token:invite.acceptance_token});
  const pricing={...pricingInput,override:{freight_paise:Number(BigInt(requestedGross)*20n/21n)-249,reason_code:'commercial_exception' as const}};
  const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID());
  const intentBody={quote_id:quote.id,pricing_input:pricing,facts:taxFacts};
  const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),intentBody,randomUUID());
  const calculation=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
  body={...body,tax_calculation_id:calculation.id,tax_intent:intentBody};
 }
 const booked=await s.book({...body,parcels:[{...s.body.parcels[0],weight_grams:400},{...s.body.parcels[0],weight_grams:599}]});
 assert.equal(booked.statusCode,201,booked.body);if(requestedGross)assert.equal(booked.json().payment_obligation.total_paise,requestedGross);const booking=booked.json().id as string,gross=booked.json().payment_obligation.total_paise as number;
 const request=(method:'POST'|'GET',path:string,body?:unknown,actor:{id:string;token:string}=s.local,key:string|undefined=randomUUID(),organization=org,franchise=A)=>s.app.inject({method,
  url:'/api/v1/bookings/'+path+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),headers:{...s.headers,...(key?{'idempotency-key':key}:{})},
  cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
 const pay=(body:unknown=collectionInput(gross),key=randomUUID(),actor:{id:string;token:string}=s.local)=>request('POST',booking+'/payments',body,actor,key);
 const reverse=(id:string,amount:number,key=randomUUID(),actor:{id:string;token:string}=s.local)=>request('POST',booking+'/payments/'+id+'/reversals',{amount_paise:amount,currency:'INR',reason_code:'incorrect_amount'},actor,key);
 const current=()=>request('GET',booking+'/payments');
 const counts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.payment_commands) commands,
  (SELECT count(*)::int FROM shipit.payment_entries) entries,(SELECT count(*)::int FROM shipit.payment_audit_events) audits,
  (SELECT count(*)::int FROM shipit.domain_events WHERE event_type='payment.settled') settlements`)).rows[0];
 return {...s,bookingId:booking,gross,booked:booked.json(),request,pay,reverse,current,paymentCounts:counts};
}
