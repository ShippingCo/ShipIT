import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { attachmentSetup, intent as attachmentIntent, photo } from '../attachment-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { contact, customerPath } from '../customer-support.ts';
import { input } from '../pricing-support.ts';
import { taxFacts } from '../tax-support.ts';
import { paymentFault } from '../payment-support.ts';
import { createBookingService } from '../../src/modules/bookings/service.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';

await test('#33 composed counter journey survives lost acknowledgement and fresh HTTP server; private resources remain scoped', {timeout:60000}, async t=>{
 const s=await attachmentSetup(t);await s.db.preparePayments();await s.db.prepareReceipts();
 const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.operator.id,role:'franchise_admin',franchise_ids:[A]});await s.memberships.acceptInvitation(s.operator.token,{token:invite.acceptance_token});
 const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
 const fresh=buildServer({config,database:s.db.runtimePool(),auth:{keys:s.keys,delivery:{},webhook:undefined},pricingClock:s.clock,attachments:s.deps,logSink:{write:x=>s.logs.push(x)}});t.after(()=>fresh.close());
 // attachmentSetup's clock is for upload expiry; pricing retains its original test clock.
 const clock=()=>new Date('2099-01-01T00:00:00Z');
 const app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},pricingClock:clock,attachments:s.deps,logSink:{write:x=>s.logs.push(x)}});t.after(()=>app.close());
 const q=(organization=org,franchise=A)=>'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise});
 const request=(path:string,body?:unknown,key=randomUUID(),token=s.operator.token,server=app)=>server.inject({method:body===undefined?'GET':'POST',url:path,headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
 const created=await request(customerPath(),{...contact,name:'Synthetic Counter Visitor'});assert.equal(created.statusCode,201,created.body);const customer=created.json();
 const lookup=await request(customerPath()+'?search_by=phone&q='+encodeURIComponent(contact.phone),undefined,undefined,undefined,fresh);assert.equal(lookup.statusCode,200,lookup.body);assert.ok(lookup.json().items.some((item:{id:string})=>item.id===customer.id));
 const pricingInput={...input,override:{freight_paise:12501,reason_code:'customer_agreement'}};
 const quote=await request('/api/v1/pricing/quote'+q(),pricingInput);assert.equal(quote.statusCode,200,quote.body);assert.equal(quote.json().override_status,'within_tolerance');assert.equal(quote.json().freight_paise,12501);
 const taxInput={quote_id:quote.json().id,pricing_input:pricingInput,facts:taxFacts};const prepared=await request('/api/v1/tax/intents'+q(),taxInput);assert.equal(prepared.statusCode,200,prepared.body);
 const tax=await request('/api/v1/tax/calculations'+q(),{intent_id:prepared.json().id});assert.equal(tax.statusCode,200,tax.body);
 const body={customer_id:customer.id,expected_customer_version:customer.version,tax_calculation_id:tax.json().id,tax_intent:taxInput,parcels:[{weight_grams:999,recipient:{name:'Synthetic Receiver',phone:'+1 202-555-0101',address:'21 Fictional Street'}}]};
 const before=await s.counts();
 for(const invalid of [{...body,total_paise:0},{...body,expected_customer_version:99},{...body,tax_intent:{...taxInput,pricing_input:{...input,weight_grams:998}}}]) {
  const response=await request('/api/v1/bookings'+q(),invalid);assert.ok([409,422].includes(response.statusCode));assert.deepEqual(await s.counts(),before);
 }
 // A dependency failure rolls back every booking child, obligation, audit and event.
 const failed=createBookingService(paymentFault(s.pool,'INSERT INTO shipit.parcels'),s.keys.browser,clock);
 await assert.rejects(failed.create(s.operator.token,org,A,randomUUID(),body,randomUUID()));assert.deepEqual(await s.counts(),before);
 const key=randomUUID(),lost=createBookingService(paymentFault(s.pool,'COMMIT'),s.keys.browser,clock);
 await assert.rejects(lost.create(s.operator.token,org,A,key,body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const replays=await Promise.all([request('/api/v1/bookings'+q(),body,key,s.operator.token,fresh),request('/api/v1/bookings'+q(),body,key,s.operator.token,fresh)]);
 for(const response of replays)assert.equal(response.statusCode,201,response.body);assert.deepEqual(replays[0]!.json(),replays[1]!.json());
 const booked=replays[0]!.json(),booking=booked.id,parcel=booked.parcels[0];assert.equal((await s.counts())!.bookings,Number(before!.bookings)+1);assert.equal((await s.counts())!.parcels,Number(before!.parcels)+1);
 const list=await request('/api/v1/parcels'+q()+'&docket='+parcel.docket,undefined,undefined,undefined,fresh);assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items[0].id,parcel.id);assert.equal(list.json().items[0].booking_id,booking);
 const paymentBody={amount_paise:booked.payment_obligation.outstanding_paise,currency:'INR',context:'paid_counter',method:'upi',collection_reference:randomUUID()},paymentKey=randomUUID();
 const pay=await request(`/api/v1/bookings/${booking}/payments`+q(),paymentBody,paymentKey);assert.equal(pay.statusCode,200,pay.body);assert.equal(pay.json().payment.outstanding_paise,0);
 assert.deepEqual((await request(`/api/v1/bookings/${booking}/payments`+q(),paymentBody,paymentKey,s.operator.token,fresh)).json(),pay.json());
 const receiptPath=`/api/v1/bookings/${booking}/receipt`,receipt=await request(receiptPath+q());assert.equal(receipt.statusCode,200,receipt.body);assert.equal(receipt.json().charges.tax.final_payable_paise,13400);
 await s.db.ownerPool().query("UPDATE shipit.franchises SET display_name='Synthetic Renamed Counter',version=version+1 WHERE id=$1",[A]);
 assert.deepEqual((await request(receiptPath+q(),undefined,undefined,undefined,fresh)).json(),receipt.json());
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.issued_receipts WHERE booking_id=$1',[booking])).rows[0]!.n,1);
 const ack=await request(`/api/v1/bookings/${booking}/payments/${pay.json().entry.id}/receipt`+q());assert.equal(ack.statusCode,200,ack.body);
 const upload=await s.request('POST','/uploads',attachmentIntent(),s.operator.token,booking);assert.equal(upload.statusCode,201,upload.body);const uploadId=upload.json().id;
 assert.equal((await s.request('PUT',`/uploads/${uploadId}/content`,photo,s.operator.token,booking)).statusCode,200);assert.equal((await s.request('POST',`/uploads/${uploadId}/finalize`,{},s.operator.token,booking)).json().state,'ready');
 // Same-tenant wrong parent cannot steal a child attachment or payment reference.
 assert.equal((await s.request('POST',`/uploads/${uploadId}/finalize`,{},s.operator.token,s.bookingId)).statusCode,404);
 assert.equal((await request(`/api/v1/bookings/${s.bookingId}/payments/${pay.json().entry.id}/receipt`+q())).statusCode,404);
 const sibling=await s.grant('operator',[B]),foreign=await s.beta();
 for(const [actor,organization,franchise] of [[sibling,org,B],[foreign,otherOrg,C]] as const) {
  for(const path of [receiptPath+q(organization,franchise),`/api/v1/receipts/${receipt.json().id}`+q(organization,franchise),`/api/v1/parcels/${parcel.id}`+q(organization,franchise),customerPath(franchise,organization)+'/'+customer.id]) {
   const denied=await request(path,undefined,undefined,actor.token,fresh);assert.equal(denied.statusCode,404,denied.body);assert.ok(!denied.body.includes(customer.name));
  }
  const search=await request(customerPath(franchise,organization)+'?search_by=phone&q='+encodeURIComponent(contact.phone),undefined,undefined,actor.token,fresh);assert.equal(search.statusCode,200,search.body);assert.equal(search.json().items.length,0);
  assert.equal((await s.request('POST',`/uploads/${uploadId}/finalize`,{},actor.token,booking,{organization_id:organization,franchise_id:franchise})).statusCode,404);
  const denied=await request('/api/v1/bookings'+q(organization,franchise),body,randomUUID(),actor.token,fresh);assert.equal(denied.statusCode,404,denied.body);
 }
 const audits=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.audit_history')).rows),logs=s.logs.join('\n');
 for(const secret of [key,paymentKey,s.operator.token,s.headers['x-csrf-token'],customer.name,contact.phone,contact.address,'21 Fictional Street',photo.toString('base64')]) {assert.ok(!logs.includes(secret));assert.ok(!audits.includes(secret));}
 for(const secret of [s.operator.token,s.headers['x-csrf-token'],key,'key_digest','encryption_key','otp','object_key','signed_url'])for(const r of [created,quote,tax,...replays,pay,receipt,ack,list])assert.ok(!r.body.includes(secret));
});
