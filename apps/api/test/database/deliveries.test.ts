import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError,type DatabasePool } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { createDeliveryService } from '../../src/modules/deliveries/service.ts';
import { deliveryProofConfiguration,startTestDelivery,testDeliveryCode } from '../delivery-support.ts';
import type { DeliveryStateDto } from '../../src/modules/deliveries/types.ts';
import { attachmentSetup,intent as attachmentIntent,photo } from '../attachment-support.ts';
import { createDeliveryChallengeCleanup } from '../../src/modules/deliveries/cleanup.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { webhookConfig } from '../webhook-fixture.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';

const selector={organization_id:org,franchise_id:A};
const headers=(key:string)=>['idempotency-key',key];
async function setup(t:Parameters<typeof bookingSetup>[0]){
 const s=await bookingSetup(t),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);const parcel=booked.json().parcels[0],agent=await s.grant('delivery_agent',[A]);
 const started=await startTestDelivery(s,parcel.id,agent),code=await testDeliveryCode(s,parcel.id);
 return {...s,booked,parcel,agent,...started,code};
}
async function complete(s:Awaited<ReturnType<typeof setup>>,key=randomUUID(),proof=s.code,service=s.service){return service.complete(s.agent.token,s.parcel.id,selector,key,headers(key),
 {expected_version:5,challenge_ref:s.state.challenge_ref,challenge_version:s.state.challenge_version,proof},false,randomUUID());}

await test('valid proof atomically delivers, consumes secret, replays, and leaves To-Pay outstanding without prohibited data',{timeout:30000},async t=>{
 const s=await setup(t),verifier=(await s.db.adminQuery('SELECT verifier FROM shipit.delivery_challenges WHERE id=$1',[s.state.challenge_ref])).rows[0]!.verifier as string,key=randomUUID(),result=await complete(s,key) as DeliveryStateDto;assert.equal(result.status,'consumed');assert.equal(result.proof_method,'otp_verified');
 const replay=await complete(s,key);assert.deepEqual(replay,result);
 const rows=(await s.db.adminQuery(`SELECT p.status,p.custody,p.active_attempt_id,p.assigned_agent_id,c.consumed_at,c.verifier,c.encrypted_secret,
  (SELECT count(*)::int FROM shipit.delivery_proofs) proofs,(SELECT count(*)::int FROM shipit.domain_events WHERE event_type='delivery.completed') completions,
  (SELECT outstanding_paise FROM shipit.booking_obligations WHERE booking_id=p.booking_id) outstanding,
  (SELECT r.phone_normalized FROM shipit.delivery_recipients r WHERE r.parcel_id=p.id) delivery_phone,
  p.recipient_snapshot->>'phone_normalized' recipient_phone,p.sender_snapshot->>'phone_normalized' sender_phone
  FROM shipit.parcels p JOIN shipit.delivery_challenges c ON c.parcel_id=p.id WHERE p.id=$1`,[s.parcel.id])).rows[0]!;
 assert.equal(rows.status,'delivered');assert.equal(rows.custody,'recipient');assert.equal(rows.active_attempt_id,null);assert.equal(rows.assigned_agent_id,null);assert.ok(rows.consumed_at);assert.equal(rows.verifier,null);assert.equal(rows.encrypted_secret,null);assert.equal(rows.proofs,1);assert.equal(rows.completions,1);assert.ok(rows.outstanding>0);
 assert.equal(rows.delivery_phone,rows.recipient_phone);assert.notEqual(rows.delivery_phone,rows.sender_phone);
 const publicHistory=JSON.stringify((await s.db.adminQuery(`SELECT 'command' kind,to_jsonb(x)-ARRAY['key_digest','fingerprint'] value FROM shipit.delivery_commands x WHERE parcel_id=$1
  UNION ALL SELECT 'audit',to_jsonb(x) FROM shipit.delivery_audit_events x WHERE parcel_id=$1
  UNION ALL SELECT 'timeline',to_jsonb(x) FROM shipit.parcel_transitions x WHERE parcel_id=$1
  UNION ALL SELECT 'event',envelope FROM shipit.domain_events WHERE parcel_id=$1
  UNION ALL SELECT 'proof',to_jsonb(x) FROM shipit.delivery_proofs x WHERE parcel_id=$1
  UNION ALL SELECT 'send',to_jsonb(x) FROM shipit.delivery_challenge_sends x WHERE parcel_id=$1
  UNION ALL SELECT 'outbound',to_jsonb(x)-ARRAY['sealed_payload','contact_key'] FROM shipit.whatsapp_outbound x WHERE affected_entity_id=$1`,[s.parcel.id])).rows);
 for(const prohibited of [s.code,verifier,deliveryProofConfiguration.keys.encryption.toString('hex'),rows.recipient_phone,'synthetic-provider-credential','raw-exception-evidence'])assert.equal(publicHistory.includes(prohibited),false,prohibited);
});

await test('delivery challenge dispatch uses the Parcel recipient, never the booking sender/customer',{timeout:30000},async t=>{
 const s=await bookingSetup(t),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);const parcel=booked.json().parcels[0],agent=await s.grant('delivery_agent',[A]),dispatcher=await s.grant('dispatcher',[A]),admin=await s.grant('franchise_admin',[A]);
 await s.db.prepareDeliveries();const binding={key:'delivery',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:delivery/v1'};
 let sentTo:string|null=null;const dependencies={configuration:{graph_version:'v24.0',bindings:[binding],webhook:webhookConfig},clock:s.clock,provider:{
  validate:async()=>{},template:async()=>({provider_id:'100004',name:'shipit_delivery_code',language:'en',status:'APPROVED',category:'AUTHENTICATION',shape_hash:'a'.repeat(64),variables:[{type:'text' as const}],supported:true}),
  send:async(_binding:unknown,_template:unknown,recipient:string)=>{sentTo=recipient;return {kind:'accepted' as const,provider_message_id:'wamid.delivery_recipient'};},
 }};
 const registry=createWhatsappService(s.pool,dependencies),installed=await registry.execute(admin.token,null,'connect',selector,randomUUID(),{binding_key:'delivery',expected_version:0},randomUUID());
 await registry.execute(admin.token,installed.id as string,'sync',selector,randomUUID(),{expected_version:1,name:'shipit_delivery_code',language:'en'},randomUUID());
 await startTestDelivery(s,parcel.id,agent,dispatcher,dependencies);assert.equal(await createOutboundWorker(s.pool,dependencies).tick(),'accepted');
 const identity=(await s.db.adminQuery(`SELECT p.recipient_snapshot->>'phone_normalized' recipient,p.sender_snapshot->>'phone_normalized' sender,
  m.customer_id,m.delivery_recipient_ref,r.phone_normalized FROM shipit.parcels p JOIN shipit.delivery_recipients r ON r.parcel_id=p.id
  JOIN shipit.whatsapp_outbound m ON m.delivery_recipient_ref=r.id WHERE p.id=$1`,[parcel.id])).rows[0]!;
 assert.equal(sentTo,identity.recipient);assert.equal(identity.phone_normalized,identity.recipient);assert.notEqual(sentTo,identity.sender);
 assert.equal(identity.customer_id,null);assert.ok(identity.delivery_recipient_ref);
});

await test('delivery HTTP boundary enforces CSRF, strict input, assignment hiding and idempotent proof completion',{timeout:30000},async t=>{
 const s=await setup(t),other=await s.grant('delivery_agent',[A]),reader=await s.grant('read_only',[A]);
 const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
 const logs:string[]=[],app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},deliveryProof:deliveryProofConfiguration,logSink:{write:value=>logs.push(value)}});t.after(()=>app.close());
 const url=`/api/v1/deliveries/${s.parcel.id}?`+new URLSearchParams(selector),body={expected_version:5,challenge_ref:s.state.challenge_ref,challenge_version:1,proof:s.code},key=randomUUID();
 assert.equal((await app.inject({method:'GET',url,cookies:s.cookies(other.token)})).statusCode,404);assert.equal((await app.inject({method:'GET',url,cookies:s.cookies(reader.token)})).statusCode,404);
 assert.equal((await app.inject({method:'POST',url:url.replace('?','/complete?'),cookies:s.cookies(s.agent.token),headers:{'content-type':'application/json','idempotency-key':key},payload:JSON.stringify(body)})).statusCode,403);
 let response=await app.inject({method:'POST',url:url.replace('?','/complete?'),cookies:s.cookies(s.agent.token),headers:{...s.headers,'idempotency-key':key},payload:JSON.stringify({...body,verified:true})});assert.equal(response.statusCode,422,response.body);
 response=await app.inject({method:'POST',url:url.replace('?','/complete?'),cookies:s.cookies(s.agent.token),headers:{...s.headers,'idempotency-key':key},payload:JSON.stringify(body)});assert.equal(response.statusCode,200,response.body);
 const committed=response.json();assert.equal(committed.proof_method,'otp_verified');for(const prohibited of [s.code,'verifier','encrypted_secret','phone_normalized'])assert.equal(response.body.includes(prohibited),false);
 assert.deepEqual((await app.inject({method:'POST',url:url.replace('?','/complete?'),cookies:s.cookies(s.agent.token),headers:{...s.headers,'idempotency-key':key},payload:JSON.stringify(body)})).json(),committed);
 assert.equal((await app.inject({method:'POST',url:url.replace('?','/complete?'),cookies:s.cookies(s.agent.token),headers:{...s.headers,'idempotency-key':key},payload:JSON.stringify({...body,proof:'000000'})})).statusCode,409);
 for(const prohibited of [s.code,deliveryProofConfiguration.keys.verifier.toString('hex'),deliveryProofConfiguration.keys.encryption.toString('hex'),'raw-exception-evidence'])assert.equal(JSON.stringify(logs).includes(prohibited),false);
});

await test('wrong proofs serialize at five, lock permanently, and resend/replacement cannot reset lineage budgets',{timeout:30000},async t=>{
 const s=await setup(t);for(let attempt=1;attempt<=5;attempt++){const key=randomUUID(),result=await s.service.complete(s.agent.token,s.parcel.id,selector,key,headers(key),
  {expected_version:5,challenge_ref:s.state.challenge_ref,challenge_version:1,proof:'999999'},false,randomUUID()) as {outcome:string;remaining_attempts:number};assert.equal(result.outcome,'proof_invalid');assert.equal(result.remaining_attempts,5-attempt);}
 await assert.rejects(complete(s,randomUUID()),{code:'DELIVERY_CHALLENGE_LOCKED'});
 const locked=(await s.db.adminQuery('SELECT failed_verifications,locked_at FROM shipit.delivery_attempts WHERE id=$1',[s.state.attempt_id])).rows[0]!;assert.equal(locked.failed_verifications,5);assert.ok(locked.locked_at);
 const key=randomUUID();await assert.rejects(s.service.resend(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:s.state.challenge_ref},false,randomUUID()),{code:'DELIVERY_CHALLENGE_LOCKED'});
});

await test('cooldown, same-code resend, expiry replacement, supersession and resend budget use persisted server time',{timeout:30000},async t=>{
 const s=await setup(t),first=s.state.challenge_ref,expires=s.state.expires_at;
 const wrongKey=randomUUID();const wrong=await s.service.complete(s.agent.token,s.parcel.id,selector,wrongKey,headers(wrongKey),
  {expected_version:5,challenge_ref:first,challenge_version:1,proof:'999999'},false,randomUUID()) as {remaining_attempts:number};assert.equal(wrong.remaining_attempts,4);
 let key=randomUUID();await assert.rejects(s.service.resend(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:first},false,randomUUID()),{code:'DELIVERY_RESEND_COOLDOWN'});
 s.setNow(new Date(Date.parse(s.state.resend_available_at)+1).toISOString());key=randomUUID();const resent=await s.service.resend(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:first},false,randomUUID());assert.equal(resent.challenge_ref,first);assert.equal(resent.expires_at,expires);assert.equal(await testDeliveryCode(s,s.parcel.id),s.code);
 s.setNow(new Date(Date.parse(expires)+1).toISOString());key=randomUUID();const replaced=await s.service.resend(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:first,reason_code:'expired'},true,randomUUID());assert.notEqual(replaced.challenge_ref,first);assert.equal(replaced.challenge_version,2);assert.equal(replaced.resends_remaining,1);
 const lineage=(await s.db.adminQuery('SELECT failed_verifications,resend_count FROM shipit.delivery_attempts WHERE id=$1',[s.state.attempt_id])).rows[0]!;assert.deepEqual(lineage,{failed_verifications:1,resend_count:2});
 const old=(await s.db.adminQuery('SELECT superseded_at,verifier,encrypted_secret FROM shipit.delivery_challenges WHERE id=$1',[first])).rows[0]!;assert.ok(old.superseded_at);assert.equal(old.verifier,null);assert.equal(old.encrypted_secret,null);
 key=randomUUID();await assert.rejects(s.service.complete(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:first,challenge_version:1,proof:s.code},false,randomUUID()));
 s.setNow(new Date(Date.parse(replaced.resend_available_at)+1).toISOString());key=randomUUID();const third=await s.service.resend(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:replaced.challenge_ref},false,randomUUID());assert.equal(third.resends_remaining,0);
 s.setNow(new Date(Date.parse(third.resend_available_at)+1).toISOString());key=randomUUID();await assert.rejects(s.service.resend(s.agent.token,s.parcel.id,selector,key,headers(key),{expected_version:5,challenge_ref:replaced.challenge_ref},false,randomUUID()),{code:'DELIVERY_RESEND_LIMIT'});
});

await test('expired secret material is destroyed by the durable tenant-derived cleanup scheduler',{timeout:30000},async t=>{
 const s=await setup(t);s.setNow(new Date(Date.parse(s.state.expires_at)+1).toISOString());const cleanup=createDeliveryChallengeCleanup(s.pool,s.clock);assert.deepEqual(await cleanup.tick(),{destroyed:1});assert.deepEqual(await cleanup.tick(),{destroyed:0});
 const row=(await s.db.adminQuery('SELECT verifier,encrypted_secret FROM shipit.delivery_challenges WHERE id=$1',[s.state.challenge_ref])).rows[0]!;assert.equal(row.verifier,null);assert.equal(row.encrypted_secret,null);await assert.rejects(complete(s),{code:'DELIVERY_CHALLENGE_EXPIRED'});
});

await test('independent connections allow exactly one logical correct-proof completion and restart uses durable state',{timeout:30000},async t=>{
 const s=await setup(t),first=s.db.runtimePool(),second=s.db.runtimePool();t.after(()=>first.close());t.after(()=>second.close());
 const a=createDeliveryService(first,deliveryProofConfiguration,undefined,s.clock),b=createDeliveryService(second,deliveryProofConfiguration,undefined,s.clock),firstKey=randomUUID(),secondKey=randomUUID();
 const raced=await Promise.allSettled([complete(s,firstKey,s.code,a),complete(s,secondKey,s.code,b)]);assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);assert.equal(raced.filter(x=>x.status==='rejected').length,1);
 const winner=raced[0].status==='fulfilled'?{key:firstKey,value:raced[0].value}:{key:secondKey,value:(raced[1] as PromiseFulfilledResult<unknown>).value},restarted=s.db.runtimePool();t.after(()=>restarted.close());
 assert.deepEqual(await complete(s,winner.key,s.code,createDeliveryService(restarted,deliveryProofConfiguration,undefined,s.clock)),winner.value);
 const counts=(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.delivery_proofs) proofs,(SELECT count(*)::int FROM shipit.domain_events WHERE event_type='delivery.completed') events,(SELECT count(*)::int FROM shipit.parcel_transitions WHERE to_status='delivered') transitions`)).rows[0];assert.deepEqual(counts,{proofs:1,events:1,transitions:1});
});

function failAt(pool:DatabasePool,needle:string):DatabasePool{return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){if(sql.includes(needle))throw new DatabaseError('DB_CONNECTION_FAILED');return client.query<Row>(sql,params);}};}};}
await test('failure after proof insertion rolls back consumption, delivery, event, audit and receipt; retry then succeeds',{timeout:30000},async t=>{
 const s=await setup(t),broken=createDeliveryService(failAt(s.pool,"UPDATE shipit.parcels p SET status='delivered'"),deliveryProofConfiguration,undefined,s.clock),key=randomUUID();
 await assert.rejects(complete(s,key,s.code,broken),{code:'TEMPORARILY_UNAVAILABLE'});
 const before=(await s.db.adminQuery(`SELECT p.status,c.consumed_at,c.verifier,(SELECT count(*)::int FROM shipit.delivery_proofs) proofs,
  (SELECT count(*)::int FROM shipit.delivery_audit_events WHERE action='deliveries.complete') audits FROM shipit.parcels p JOIN shipit.delivery_challenges c ON c.parcel_id=p.id WHERE p.id=$1`,[s.parcel.id])).rows[0]!;
 assert.equal(before.status,'out_for_delivery');assert.equal(before.consumed_at,null);assert.ok(before.verifier);assert.equal(before.proofs,0);assert.equal(before.audits,0);
 assert.equal(((await complete(s,key)) as DeliveryStateDto).proof_method,'otp_verified');
});

await test('sibling, foreign, other-agent and unknown delivery identifiers are indistinguishable and mutation-free',{timeout:30000},async t=>{
 const s=await setup(t),other=await s.grant('delivery_agent',[A]),sibling=await s.grant('delivery_agent',[B]),foreign=await s.beta('delivery_agent'),unknown=randomUUID(),baseline=await s.db.adminQuery('SELECT failed_verifications,resend_count FROM shipit.delivery_attempts WHERE id=$1',[s.state.attempt_id]);
 const errors=[];for(const [actor,scope,id] of [[other,selector,s.parcel.id],[sibling,{organization_id:org,franchise_id:B},s.parcel.id],[foreign,{organization_id:otherOrg,franchise_id:C},s.parcel.id],[s.agent,selector,unknown]] as const){try{await s.service.read(actor.token,id,scope,randomUUID());assert.fail('expected inaccessible');}catch(error){errors.push((error as {code:string}).code);}}
 assert.deepEqual(errors,['RESOURCE_NOT_FOUND','RESOURCE_NOT_FOUND','RESOURCE_NOT_FOUND','RESOURCE_NOT_FOUND']);assert.deepEqual((await s.db.adminQuery('SELECT failed_verifications,resend_count FROM shipit.delivery_attempts WHERE id=$1',[s.state.attempt_id])).rows,baseline.rows);
});

async function exceptionalSetup(t:Parameters<typeof attachmentSetup>[0]){
 const s=await attachmentSetup(t),agent=await s.grant('delivery_agent',[A]),started=await startTestDelivery(s,s.parcelId,agent),code=await testDeliveryCode(s,s.parcelId);
 const body={...attachmentIntent(),purpose:'parcel_proof',parcel_id:s.parcelId},created=await s.request('POST','/uploads',body,agent.token);assert.equal(created.statusCode,201,created.body);const evidence=created.json().id as string;
 assert.equal((await s.request('PUT',`/uploads/${evidence}/content`,photo,agent.token)).statusCode,200);assert.equal((await s.request('POST',`/uploads/${evidence}/finalize`,{},agent.token)).statusCode,200);
 let key=randomUUID();const requested=await started.service.requestException(agent.token,s.parcelId,selector,key,headers(key),{expected_version:5,reason_code:'provider_unavailable',evidence_id:evidence,recipient_present:true},randomUUID());
 key=randomUUID();const approved=await started.service.approveException(s.local.token,s.parcelId,selector,key,headers(key),{expected_version:5,request_id:requested.exception!.request_id},randomUUID());
 return {...s,agent,...started,code,evidence,approved};
}

await test('exceptional completion requires protected evidence and an independent local admin and remains labelled exceptional',{timeout:30000},async t=>{
 const s=await exceptionalSetup(t);const key=randomUUID(),result=await s.service.complete(s.agent.token,s.parcelId,selector,key,headers(key),{expected_version:5,approval_ref:s.approved.exception!.approval_ref},true,randomUUID()) as DeliveryStateDto;
 assert.equal(result.proof_method,'exceptional');const proof=(await s.db.adminQuery('SELECT proof_method,reason_code,evidence_id,requester_id,approver_id FROM shipit.delivery_proofs')).rows[0]!;
 assert.equal(proof.proof_method,'exceptional');assert.equal(proof.reason_code,'provider_unavailable');assert.equal(proof.evidence_id,s.evidence);assert.equal(proof.requester_id,s.agent.id);assert.notEqual(proof.approver_id,s.agent.id);
});

await test('OTP and approved exceptional proof race to one permanent proof and one delivery completion',{timeout:30000},async t=>{
 const s=await exceptionalSetup(t),one=s.db.runtimePool(),two=s.db.runtimePool();t.after(()=>one.close());t.after(()=>two.close());const otp=createDeliveryService(one,deliveryProofConfiguration,undefined,s.clock),exceptional=createDeliveryService(two,deliveryProofConfiguration,undefined,s.clock);
 const otpKey=randomUUID(),exceptionKey=randomUUID(),results=await Promise.allSettled([
  otp.complete(s.agent.token,s.parcelId,selector,otpKey,headers(otpKey),{expected_version:5,challenge_ref:s.approved.challenge_ref,challenge_version:s.approved.challenge_version,proof:s.code},false,randomUUID()),
  exceptional.complete(s.agent.token,s.parcelId,selector,exceptionKey,headers(exceptionKey),{expected_version:5,approval_ref:s.approved.exception!.approval_ref},true,randomUUID()),
 ]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const counts=(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.delivery_proofs) proofs,(SELECT count(*)::int FROM shipit.domain_events WHERE event_type='delivery.completed') events,
  (SELECT count(*)::int FROM shipit.parcel_transitions WHERE to_status='delivered') transitions`)).rows[0];assert.deepEqual(counts,{proofs:1,events:1,transitions:1});
});

await test('correct OTP and physical failed-attempt race serialize to one safe lifecycle outcome',{timeout:30000},async t=>{
 const s=await setup(t),pool=s.db.runtimePool();t.after(()=>pool.close());const service=createDeliveryService(pool,deliveryProofConfiguration,undefined,s.clock),completeKey=randomUUID(),failureKey=randomUUID();
 const completion=service.complete(s.agent.token,s.parcel.id,selector,completeKey,headers(completeKey),{expected_version:5,challenge_ref:s.state.challenge_ref,challenge_version:1,proof:s.code},false,randomUUID());
 const failure=s.app.inject({method:'POST',url:`/api/v1/parcels/${s.parcel.id}/failed-attempt?`+new URLSearchParams(selector),headers:{...s.headers,'idempotency-key':failureKey},cookies:s.cookies(s.agent.token),payload:JSON.stringify({expected_version:5,evidence_ref:randomUUID(),attempt_id:s.state.attempt_id,reason_code:'customer_unavailable'})});
 await Promise.allSettled([completion,failure]);const outcome=(await s.db.adminQuery(`SELECT p.status,c.consumed_at,c.closed_at,c.verifier,c.encrypted_secret,(SELECT count(*)::int FROM shipit.delivery_proofs) proofs
  FROM shipit.parcels p JOIN shipit.delivery_challenges c ON c.parcel_id=p.id WHERE p.id=$1`,[s.parcel.id])).rows[0]!;
 assert.ok(['delivered','failed_attempt'].includes(outcome.status));assert.equal(outcome.verifier,null);assert.equal(outcome.encrypted_secret,null);assert.equal(outcome.proofs,outcome.status==='delivered'?1:0);assert.ok(outcome.status==='delivered'?outcome.consumed_at:outcome.closed_at);
});
