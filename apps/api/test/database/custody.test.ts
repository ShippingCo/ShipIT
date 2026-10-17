import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createParcelCustodyService} from '../../src/modules/custody/service.ts';
import {attachmentSetup,intent as attachmentIntent,photo} from '../attachment-support.ts';
import {paymentFault} from '../payment-support.ts';
import {bookingSetup} from '../booking-support.ts';
import {startTestDelivery,testDeliveryCode} from '../delivery-support.ts';
import {provisionDatabase} from '../../../../packages/db/test/support.ts';
import {auditSetup,org,A,B,otherOrg,C} from '../audit-support.ts';
import {withCustodyScope} from '../../src/modules/memberships/service.ts';
import {assertTenantAccess} from '../../src/modules/security/scope.ts';

// Service scenarios install migration 50 once. Repeated prerequisite grant helpers
// cannot change this schema; restore the real migrator after custody grants, before
// custody commands. Dedicated fresh/populated migration tests retain real installs.
async function custodyDatabase(t:import('node:test').TestContext) {
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate(),{applied:52});
 const migrate=db.migrate,prepare=db.prepareCustody,prepareBookings=db.prepareBookings,prepareMemberships=db.prepareMemberships;
 let bookings:Promise<void>|undefined,memberships:Promise<void>|undefined;
 db.prepareBookings=()=>bookings??=prepareBookings();
 db.prepareMemberships=()=>memberships??=prepareMemberships();
 db.migrate=async options=>{if(options)throw new Error('CUSTODY_SERVICE_FIXTURE_MIGRATION_OPTIONS');return {applied:0};};
 db.prepareCustody=async()=>{try{await prepare();}finally{db.migrate=migrate;db.prepareCustody=prepare;}};
 t.after(()=>{db.migrate=migrate;db.prepareCustody=prepare;db.prepareBookings=prepareBookings;db.prepareMemberships=prepareMemberships;});
 return db;
}
await test('physical receipt services preserve one custodian across competing acknowledgements, exact replay, missing reports and actual returns',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]);
 const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;
 await startTestDelivery(s,parcel,agent);await s.db.prepareCustody();
 const service=createParcelCustodyService(s.pool,true),disabled=createParcelCustodyService(s.pool),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const input={agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},key=randomUUID();
 const before=(await s.db.adminQuery('SELECT status,custody,version,failed_attempt_count,attempts_started FROM shipit.parcels WHERE id=$1',[parcel])).rows[0];
 const m=await service.prepare(admin.token,q,key,headers(key),input,randomUUID());
 assert.deepEqual(await disabled.prepare(admin.token,q,key,headers(key),input,randomUUID()),m);
 await assert.rejects(service.prepare(admin.token,q,key,headers(key),{...input,items:[{...input.items[0],expected_parcel_version:6}]},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 const otherKey=randomUUID(),other=await service.prepare(admin.token,q,otherKey,headers(otherKey),input,randomUUID());
 const keys=[randomUUID(),randomUUID()],race=await Promise.allSettled([m,other].map((manifest,n)=>service.acknowledge(agent.token,manifest.resource_id,q,keys[n],headers(keys[n]!),{expected_version:1},randomUUID())));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
 const winner=race[0]!.status==='fulfilled'?0:1,accepted=(race[winner] as PromiseFulfilledResult<Awaited<ReturnType<typeof service.acknowledge>>>).value;
 assert.deepEqual(await disabled.acknowledge(agent.token,[m,other][winner]!.resource_id,q,keys[winner],headers(keys[winner]!),{expected_version:1},randomUUID()),accepted);
 const source=accepted.receipt_ids[0]!,body={parcel_id:parcel,expected_parcel_version:5,source_receipt_id:source,discrepancy:'missing'},missingKey=randomUUID();
 const missing=await service.receiveReturn(admin.token,q,missingKey,headers(missingKey),body,randomUUID());
 assert.equal(missing.receipt_ids.length,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_receipts WHERE parcel_id=$1',[parcel])).rows[0]!.count,1);
 const returnKey=randomUUID(),returned=await service.receiveReturn(admin.token,q,returnKey,headers(returnKey),{...body,discrepancy:'damaged'},randomUUID());
 assert.deepEqual(await disabled.receiveReturn(admin.token,q,returnKey,headers(returnKey),{...body,discrepancy:'damaged'},randomUUID()),returned);
 const rows=(await s.db.adminQuery('SELECT sequence,kind,previous_receipt_id,proof_id FROM shipit.custody_receipts WHERE parcel_id=$1 ORDER BY sequence',[parcel])).rows;
 assert.deepEqual(rows.map(r=>[r.sequence,r.kind]),[[1,'agent_received'],[2,'office_received']]);assert.equal(rows[1]!.previous_receipt_id,source);assert.equal(rows[1]!.proof_id,null);
 assert.deepEqual((await s.db.adminQuery('SELECT status,custody,version,failed_attempt_count,attempts_started FROM shipit.parcels WHERE id=$1',[parcel])).rows[0],before);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int count FROM shipit.custody_commands WHERE operation='acknowledge'")).rows[0]!.count,1);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_events')).rows[0]!.count,5);
 const detail=await service.read(agent.token,[m,other][winner]!.resource_id,q,randomUUID());assert.equal(detail.state,'acknowledged');assert.equal(detail.items[0]!.receipt_id,source);
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query("UPDATE shipit.custody_receipts SET discrepancy='none' WHERE id=$1",[source]));
 await assert.rejects(owner.query('DELETE FROM shipit.custody_receipts WHERE id=$1',[source]));
 await assert.rejects(owner.query('INSERT INTO shipit.custody_manifest_items SELECT $1,organization_id,franchise_id,manifest_id,booking_id,parcel_id,attempt_id,assignment_id,agent_id,expected_parcel_version,previous_receipt_id,instruction_id,grant_id FROM shipit.custody_manifest_items WHERE manifest_id=$2',[randomUUID(),m.resource_id]));
 await assert.rejects(owner.query("INSERT INTO shipit.custody_commands(id,organization_id,franchise_id,actor_id,operation,correlation_id,key_digest,fingerprint,input,result) VALUES($1,$2,$3,$4,'return',$5,$6,$6,'{}','{}')",[randomUUID(),org,A,admin.id,randomUUID(),'a'.repeat(64)]));
 await s.memberships.revokeMembership(s.admin.token,agent.member.id,{expected_version:1});
 await assert.rejects(service.read(agent.token,m.resource_id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await service.read(admin.token,[m,other][winner]!.resource_id,q,randomUUID())).state,'acknowledged');
});

await test('populated migration46 upgrades preserve actual assignment and challenge counters with no custody backfill',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:46}),{applied:46});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});
 const s=await bookingSetup(t,db),agent=await s.grant('delivery_agent',[A]);
 const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;
 await startTestDelivery(s,parcel,agent);
 const snapshot=async()=>({
  parcel:(await db.adminQuery('SELECT id,status,custody,version,assigned_agent_id,active_attempt_id,attempts_started,failed_attempt_count FROM shipit.parcels WHERE id=$1',[parcel])).rows,
  attempt:(await db.adminQuery('SELECT id,assignment_id,agent_id,recipient_ref,recipient_contact_version,state,version,failed_verifications,resend_count,locked_at FROM shipit.delivery_attempts WHERE parcel_id=$1',[parcel])).rows,
  challenge:(await db.adminQuery('SELECT id,challenge_version,consumed_at,superseded_at FROM shipit.delivery_challenges WHERE parcel_id=$1',[parcel])).rows
 });
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:6});
 assert.deepEqual(await snapshot(),before);assert.deepEqual(await db.migrate(),{applied:0});
 for(const table of ['custody_access_events','custody_commands','custody_assignment_instructions','custody_discrepancies','custody_events','custody_grant_revocations','custody_manifest_cancellations','custody_manifest_items','custody_manifests','custody_receipts','custody_releases','custody_transfer_grants']){
  const count=(await db.adminQuery('SELECT count(*)::int count FROM shipit.'+table)).rows[0]!.count;assert.equal(count,0);
 }
});


await test('custody current-membership ceilings deny foreign selectors, agent exports and revoked replay before issuing access',{timeout:30000},async t=>{
 const s=await auditSetup(t,undefined,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),dispatcher=await s.grant('dispatcher',[A]),admin=await s.grant('franchise_admin',[A]),accountant=await s.grant('accountant',[A]);
 let workCalls=0;
 const call=(token:string,action:import('../../src/modules/custody/types.ts').CustodyAction,organization=org,franchise=A)=>
  withCustodyScope(s.pool,token,organization,franchise,action,randomUUID(),async access=>{
   workCalls++;const c=assertTenantAccess(access.access,[action]);return {agentOnly:access.agentOnly,actor:c.actor.id,franchiseIds:c.permittedFranchiseIds};
  });
 assert.deepEqual(await call(agent.token,'custody.read'),{agentOnly:true,actor:agent.id,franchiseIds:[A]});
 assert.equal((await call(dispatcher.token,'custody.authorize')).agentOnly,false);
 assert.equal((await call(admin.token,'custody.export')).agentOnly,false);
 const before=workCalls;
 for(const [actor,action] of [[agent,'custody.export'],[agent,'custody.authorize'],[dispatcher,'custody.prepare'],[s.admin,'custody.grant'],[accountant,'custody.read']] as const)
  await assert.rejects(call(actor.token,action),{code:'ACTION_FORBIDDEN'});
 for(const [organization,franchise] of [[org,B],[otherOrg,C]])
  await assert.rejects(call(agent.token,'custody.read',organization,franchise),{code:'RESOURCE_NOT_FOUND'});
 assert.equal(workCalls,before);
 await s.memberships.revokeMembership(s.admin.token,agent.member.id,{expected_version:1});
 await assert.rejects(call(agent.token,'custody.read'),{code:'RESOURCE_NOT_FOUND'});
 assert.equal(workCalls,before);
});


await test('specific custody grants and source release preserve current assignment; revocation denies agent replay and recipient acknowledgement',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),sourceAgent=await s.grant('delivery_agent',[A]),targetAgent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]),foreignAgent=await s.grant('delivery_agent',[B]);
 const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;
 const start=await startTestDelivery(s,parcel,sourceAgent);await s.db.prepareCustody();
 const service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const prepareKey=randomUUID(),manifest=await service.prepare(admin.token,q,prepareKey,headers(prepareKey),{agent_id:sourceAgent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const ackKey=randomUUID(),ack=await service.acknowledge(sourceAgent.token,manifest.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID()),receipt=ack.receipt_ids[0]!;
 const snapshot=async()=>(await s.db.adminQuery('SELECT p.version,p.assigned_agent_id,a.assignment_id,a.agent_id,a.attempt_number,a.resend_count,a.failed_verifications,a.state FROM shipit.parcels p JOIN shipit.delivery_attempts a ON a.id=p.active_attempt_id WHERE p.id=$1',[parcel])).rows;
 const before=await snapshot(),grantBody={parcel_id:parcel,source_receipt_id:receipt,destination_kind:'agent',destination_agent_id:targetAgent.id},grantKey=randomUUID();
 const grant=await service.grant(admin.token,q,grantKey,headers(grantKey),grantBody,randomUUID());
 const options=await service.transfers(sourceAgent.token,q,null,randomUUID());
 assert.equal(options.items.length,1);assert.deepEqual(options.items[0],{id:grant.resource_id,parcel_id:parcel,source_receipt_id:receipt,agent_id:sourceAgent.id,destination_kind:'agent',destination_agent_id:targetAgent.id,parcel_version:5,assigned_agent_id:sourceAgent.id,can_prepare:false,instruction_id:null,office_release_id:null});
 assert.equal((await service.transfers(targetAgent.token,q,null,randomUUID())).items.length,0);
 await assert.rejects(service.outgoingManifests(targetAgent.token,grant.resource_id,q,null,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.transfers(sourceAgent.token,{...q,franchise_id:B},null,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.transfers(sourceAgent.token,q,'invalid',randomUUID()));
 const denied=randomUUID();await assert.rejects(service.grant(admin.token,q,denied,headers(denied),{...grantBody,destination_agent_id:foreignAgent.id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const instructionKey=randomUUID(),instruction=await service.authorize(start.dispatcher.token,q,instructionKey,headers(instructionKey),{parcel_id:parcel,agent_id:targetAgent.id,expected_parcel_version:5},randomUUID());
 const ready=(await service.transfers(sourceAgent.token,q,null,randomUUID())).items[0]!;assert.equal(ready.can_prepare,true);assert.equal(ready.instruction_id,instruction.resource_id);
 const handoverBody={agent_id:targetAgent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:receipt,instruction_id:instruction.resource_id,grant_id:grant.resource_id}]},handoverKey=randomUUID();
 const handover=await service.prepare(sourceAgent.token,q,handoverKey,headers(handoverKey),handoverBody,randomUUID());
 assert.deepEqual((await service.outgoingManifests(sourceAgent.token,grant.resource_id,q,null,randomUUID())).items,[{id:handover.resource_id,agent_id:targetAgent.id,released:false}]);
 const releaseBody={parcel_id:parcel,source_receipt_id:receipt,grant_id:grant.resource_id,manifest_id:handover.resource_id},releaseKey=randomUUID();
 const release=await service.release(sourceAgent.token,q,releaseKey,headers(releaseKey),releaseBody,randomUUID());
 assert.equal((await service.outgoingManifests(sourceAgent.token,grant.resource_id,q,null,randomUUID())).items[0]!.released,true);
 assert.deepEqual(await service.release(sourceAgent.token,q,releaseKey,headers(releaseKey),releaseBody,randomUUID()),release);
 assert.deepEqual(await snapshot(),before);assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_receipts')).rows[0]!.count,1);
 const revokeKey=randomUUID();await service.revokeGrant(admin.token,grant.resource_id,q,revokeKey,headers(revokeKey),{expected_version:1},randomUUID());
 assert.equal((await service.transfers(sourceAgent.token,q,null,randomUUID())).items.length,0);
 await assert.rejects(service.outgoingManifests(sourceAgent.token,grant.resource_id,q,null,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.release(sourceAgent.token,q,releaseKey,headers(releaseKey),releaseBody,randomUUID()),{code:'CUSTODY_CONFLICT'});
 await assert.rejects(service.prepare(sourceAgent.token,q,handoverKey,headers(handoverKey),handoverBody,randomUUID()),{code:'CUSTODY_CONFLICT'});
 const targetKey=randomUUID();await assert.rejects(service.acknowledge(targetAgent.token,handover.resource_id,q,targetKey,headers(targetKey),{expected_version:1},randomUUID()),{code:'CUSTODY_CONFLICT'});
 const cancelKey=randomUUID();await service.cancel(admin.token,handover.resource_id,q,cancelKey,headers(cancelKey),{expected_version:1},randomUUID());
 assert.equal((await service.read(admin.token,handover.resource_id,q,randomUUID())).state,'cancelled');
 assert.deepEqual(await snapshot(),before);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_releases')).rows[0]!.count,1);
 // Cancellation never moved the parcel: a fresh exact grant/manifest can release again
 // without inventing a physical trip back to the shop.
 const nextGrantKey=randomUUID(),nextGrant=await service.grant(admin.token,q,nextGrantKey,headers(nextGrantKey),grantBody,randomUUID());
 const nextBody={...handoverBody,items:[{...handoverBody.items[0],grant_id:nextGrant.resource_id}]},nextPrepareKey=randomUUID();
 const nextManifest=await service.prepare(sourceAgent.token,q,nextPrepareKey,headers(nextPrepareKey),nextBody,randomUUID());
 const nextReleaseKey=randomUUID();
 await service.release(sourceAgent.token,q,nextReleaseKey,headers(nextReleaseKey),{...releaseBody,grant_id:nextGrant.resource_id,manifest_id:nextManifest.resource_id},randomUUID());
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_releases')).rows[0]!.count,2);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_receipts')).rows[0]!.count,1);
 assert.deepEqual(await snapshot(),before);
 const dispatcherMembership=(await s.memberships.listMemberships(s.admin.token,org)).items.find(m=>m.user_id===start.dispatcher.id&&m.role==='dispatcher');assert.ok(dispatcherMembership);
 await s.memberships.revokeMembership(s.admin.token,dispatcherMembership.id,{expected_version:dispatcherMembership.version});
 const stale=(await service.transfers(sourceAgent.token,q,null,randomUUID())).items[0]!;assert.equal(stale.id,nextGrant.resource_id);assert.equal(stale.can_prepare,false);assert.equal(stale.instruction_id,null);
 await s.memberships.revokeMembership(s.admin.token,targetAgent.member.id,{expected_version:1});
 assert.equal((await service.transfers(sourceAgent.token,q,null,randomUUID())).items.length,0);
 assert.equal((await service.transfers(admin.token,q,null,randomUUID())).items.length,0);

});

await test('custody rollback and lost commit reply preserve one receipt/event and exact uncertain command identity',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]),booked=await s.book();
 assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;await startTestDelivery(s,parcel,agent);await s.db.prepareCustody();
 const service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key],prepareKey=randomUUID();
 const manifest=await service.prepare(admin.token,q,prepareKey,headers(prepareKey),{agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const count=async()=>(await s.db.adminQuery("SELECT (SELECT count(*)::int FROM shipit.custody_receipts) receipts,(SELECT count(*)::int FROM shipit.custody_commands WHERE operation='acknowledge') commands,(SELECT count(*)::int FROM shipit.custody_events) events")).rows[0];
 for(const mode of ['before','omit'] as const){
  const key=randomUUID(),fault=createParcelCustodyService(paymentFault(s.pool,'INSERT INTO shipit.custody_events',mode),true);
  await assert.rejects(fault.acknowledge(agent.token,manifest.resource_id,q,key,headers(key),{expected_version:1},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await count(),{receipts:0,commands:0,events:1});
 }
 const key=randomUUID(),lost=createParcelCustodyService(paymentFault(s.pool,'COMMIT','after'),true);
 await assert.rejects(lost.acknowledge(agent.token,manifest.resource_id,q,key,headers(key),{expected_version:1},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.deepEqual(await count(),{receipts:1,commands:1,events:2});
 const result=await service.acknowledge(agent.token,manifest.resource_id,q,key,headers(key),{expected_version:1},randomUUID());
 assert.equal(result.receipt_ids.length,1);assert.deepEqual(await count(),{receipts:1,commands:1,events:2});
 assert.deepEqual(await service.acknowledge(agent.token,manifest.resource_id,q,key,headers(key),{expected_version:1},randomUUID()),result);
});


await test('tracked office custody blocks genuine proof until acknowledged handback; actual42 proof atomically releases recipient custody and replays once',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]),booked=await s.book();
 assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;
 // Pricing retains its existing synthetic clock; delivery uses the live server clock.
 const live={...s,clock:()=>new Date()},start=await startTestDelivery(live,parcel,agent),code=await testDeliveryCode(live,parcel);
 await s.db.prepareCustody();const custody=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 async function handover(previous:string|null){
  const key=randomUUID(),m=await custody.prepare(admin.token,q,key,headers(key),{agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:previous,instruction_id:null,grant_id:null}]},randomUUID());
  const ackKey=randomUUID();return custody.acknowledge(agent.token,m.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID());
 }
 const first=await handover(null),returnKey=randomUUID(),returned=await custody.receiveReturn(admin.token,q,returnKey,headers(returnKey),{parcel_id:parcel,expected_parcel_version:5,source_receipt_id:first.receipt_ids[0],discrepancy:'none'},randomUUID());
 const key=randomUUID(),body={expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:code};
 await assert.rejects(start.service.complete(agent.token,parcel,q,key,headers(key),body,false,randomUUID()),{code:'CUSTODY_CONFLICT'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.delivery_proofs WHERE parcel_id=$1',[parcel])).rows[0]!.count,0);
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.delivery_attempts WHERE parcel_id=$1',[parcel])).rows[0]!.state,'active');
 const handback=await handover(returned.receipt_ids[0]!);
 const before=(await s.db.adminQuery('SELECT outstanding_paise FROM shipit.booking_obligations WHERE booking_id=$1',[booked.json().id])).rows[0]!;
 const result=await start.service.complete(agent.token,parcel,q,key,headers(key),body,false,randomUUID());
 assert.ok('proof_method' in result);assert.equal(result.proof_method,'otp_verified');assert.equal(result.status,'consumed');
 assert.deepEqual(await start.service.complete(agent.token,parcel,q,key,headers(key),body,false,randomUUID()),result);
 const rows=(await s.db.adminQuery('SELECT kind,previous_receipt_id,proof_id,actor_id FROM shipit.custody_receipts WHERE parcel_id=$1 ORDER BY sequence',[parcel])).rows;
 assert.deepEqual(rows.map(r=>r.kind),['agent_received','office_received','agent_received','recipient_received']);
 assert.equal(rows[3]!.previous_receipt_id,handback.receipt_ids[0]);assert.equal(rows[3]!.actor_id,agent.id);
 const proof=(await s.db.adminQuery('SELECT id,completed_by FROM shipit.delivery_proofs WHERE parcel_id=$1',[parcel])).rows;
 assert.equal(proof.length,1);assert.equal(rows[3]!.proof_id,proof[0]!.id);assert.equal(proof[0]!.completed_by,agent.id);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int count FROM shipit.custody_commands WHERE operation='delivery'")).rows[0]!.count,1);
 assert.deepEqual((await s.db.adminQuery('SELECT outstanding_paise FROM shipit.booking_obligations WHERE booking_id=$1',[booked.json().id])).rows[0],before);
});


await test('genuine proof custody hook rolls back with owning delivery failure and retries one original proof intent',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]),booked=await s.book();
 assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id,live={...s,clock:()=>new Date()},start=await startTestDelivery(live,parcel,agent);
 const code=await testDeliveryCode(live,parcel);await s.db.prepareCustody();
 const custody=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key],prepareKey=randomUUID();
 const manifest=await custody.prepare(admin.token,q,prepareKey,headers(prepareKey),{agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const ackKey=randomUUID();await custody.acknowledge(agent.token,manifest.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID());
 const {createDeliveryService}=await import('../../src/modules/deliveries/service.ts');
 const {deliveryProofConfiguration}=await import('../delivery-support.ts');
 const fault=createDeliveryService(paymentFault(s.pool,'UPDATE shipit.parcels p SET status=','after'),deliveryProofConfiguration,undefined,()=>new Date()),key=randomUUID();
 const body={expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:code};
 await assert.rejects(fault.complete(agent.token,parcel,q,key,headers(key),body,false,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const counts=async()=>(await s.db.adminQuery("SELECT (SELECT count(*)::int FROM shipit.delivery_proofs) proofs,(SELECT count(*)::int FROM shipit.custody_receipts) receipts,(SELECT count(*)::int FROM shipit.custody_commands WHERE operation='delivery') commands,(SELECT count(*)::int FROM shipit.custody_events) events")).rows[0];
 assert.deepEqual(await counts(),{proofs:0,receipts:1,commands:0,events:2});
 assert.equal((await s.db.adminQuery('SELECT status FROM shipit.parcels WHERE id=$1',[parcel])).rows[0]!.status,'out_for_delivery');
 const result=await start.service.complete(agent.token,parcel,q,key,headers(key),body,false,randomUUID());
 assert.ok('proof_method' in result);assert.equal(result.proof_method,'otp_verified');assert.deepEqual(await counts(),{proofs:1,receipts:2,commands:1,events:3});
 assert.deepEqual(await start.service.complete(agent.token,parcel,q,key,headers(key),body,false,randomUUID()),result);
 assert.deepEqual(await counts(),{proofs:1,receipts:2,commands:1,events:3});
});

await test('each acknowledged custody generation needs independent exceptional review without resetting the attempt',{timeout:30000},async t=>{
 const s=await attachmentSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]);
 const started=await startTestDelivery({...s,clock:()=>new Date()},s.parcelId,agent);await s.db.prepareCustody();
 const custody=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const prepare=async(previous:string|null)=>{const key=randomUUID();return custody.prepare(admin.token,q,key,headers(key),
  {agent_id:agent.id,items:[{parcel_id:s.parcelId,expected_parcel_version:5,previous_receipt_id:previous,instruction_id:null,grant_id:null}]},randomUUID());};
 const ack=async(manifest:string)=>{const key=randomUUID();return custody.acknowledge(agent.token,manifest,q,key,headers(key),{expected_version:1},randomUUID());};
 const first=await ack((await prepare(null)).resource_id);
 const uploaded=await s.request('POST','/uploads',{...attachmentIntent(),purpose:'parcel_proof',parcel_id:s.parcelId},agent.token);
 assert.equal(uploaded.statusCode,201,uploaded.body);const evidence=uploaded.json().id as string;
 assert.equal((await s.request('PUT','/uploads/'+evidence+'/content',photo,agent.token)).statusCode,200);
 assert.equal((await s.request('POST','/uploads/'+evidence+'/finalize',{},agent.token)).statusCode,200);
 const request=async()=>{const key=randomUUID();return started.service.requestException(agent.token,s.parcelId,q,key,headers(key),
  {expected_version:5,reason_code:'provider_unavailable',evidence_id:evidence,recipient_present:true},randomUUID());};
 const approve=async(requestId:string)=>{const key=randomUUID();return started.service.approveException(admin.token,s.parcelId,q,key,headers(key),
  {expected_version:5,request_id:requestId},randomUUID());};
 const requested=await request(),approved=await approve(requested.exception!.request_id);
 await assert.rejects(request(),{code:'DELIVERY_EXCEPTION_INVALID'});
 const snapshot=async()=>(await s.db.adminQuery('SELECT id,assignment_id,agent_id,version,failed_verifications,resend_count,locked_at FROM shipit.delivery_attempts WHERE id=$1',[started.state.attempt_id])).rows;
 const before=await snapshot(),returnKey=randomUUID(),returned=await custody.receiveReturn(admin.token,q,returnKey,headers(returnKey),
  {parcel_id:s.parcelId,expected_parcel_version:5,source_receipt_id:first.receipt_ids[0],discrepancy:'none'},randomUUID());
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.delivery_exception_requests WHERE id=$1',[requested.exception!.request_id])).rows[0]!.state,'invalidated');
 await assert.rejects(request(),{code:'CUSTODY_CONFLICT'});
 const second=await ack((await prepare(returned.receipt_ids[0]!)).resource_id);
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query('UPDATE shipit.delivery_exception_requests SET assignment_receipt_id=$1 WHERE id=$2',[second.receipt_ids[0],requested.exception!.request_id]));
 await assert.rejects(owner.query('UPDATE shipit.delivery_exception_requests SET requester_id=$1 WHERE id=$2',[admin.id,requested.exception!.request_id]));
 await assert.rejects(owner.query('DELETE FROM shipit.delivery_exception_requests WHERE id=$1',[requested.exception!.request_id]));

 const staleKey=randomUUID();await assert.rejects(started.service.complete(agent.token,s.parcelId,q,staleKey,headers(staleKey),
  {expected_version:5,approval_ref:approved.exception!.approval_ref},true,randomUUID()),{code:'DELIVERY_EXCEPTION_INVALID'});
 const fresh=await request();assert.notEqual(fresh.exception!.request_id,requested.exception!.request_id);
 const selfKey=randomUUID();await assert.rejects(started.service.approveException(agent.token,s.parcelId,q,selfKey,headers(selfKey),
  {expected_version:5,request_id:fresh.exception!.request_id},randomUUID()),{code:'ACTION_FORBIDDEN'});
 const newApproval=await approve(fresh.exception!.request_id);
 assert.deepEqual(await snapshot(),before);
 const history=(await s.db.adminQuery('SELECT state,assignment_receipt_id FROM shipit.delivery_exception_requests ORDER BY requested_at,id')).rows;
 assert.deepEqual(history.map(r=>[r.state,r.assignment_receipt_id]),[['invalidated',first.receipt_ids[0]],['approved',second.receipt_ids[0]]]);
 const key=randomUUID(),result=await started.service.complete(agent.token,s.parcelId,q,key,headers(key),
  {expected_version:5,approval_ref:newApproval.exception!.approval_ref},true,randomUUID());assert.ok('proof_method' in result);assert.equal(result.proof_method,'exceptional');
 assert.deepEqual(await started.service.complete(agent.token,s.parcelId,q,key,headers(key),
  {expected_version:5,approval_ref:newApproval.exception!.approval_ref},true,randomUUID()),result);
 const proof=(await s.db.adminQuery('SELECT approval_id,proof_method FROM shipit.delivery_proofs WHERE parcel_id=$1',[s.parcelId])).rows;
 assert.deepEqual(proof,[{approval_id:newApproval.exception!.approval_ref,proof_method:'exceptional'}]);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int count FROM shipit.custody_receipts WHERE parcel_id=$1 AND kind='recipient_received'",[s.parcelId])).rows[0]!.count,1);
});

await test('acknowledged reassignment preserves the challenge, removes former completion authority and requires a fresh independent review',{timeout:30000},async t=>{
 const s=await attachmentSetup(t,await custodyDatabase(t)),first=await s.grant('delivery_agent',[A]),next=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]);
 const started=await startTestDelivery({...s,clock:()=>new Date()},s.parcelId,first);await s.db.prepareCustody();
 const code=await testDeliveryCode(s,s.parcelId),service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const initialKey=randomUUID(),manifest=await service.prepare(admin.token,q,initialKey,headers(initialKey),{agent_id:first.id,
  items:[{parcel_id:s.parcelId,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const firstKey=randomUUID(),received=await service.acknowledge(first.token,manifest.resource_id,q,firstKey,headers(firstKey),{expected_version:1},randomUUID()),source=received.receipt_ids[0]!;
 const uploaded=await s.request('POST','/uploads',{...attachmentIntent(),purpose:'parcel_proof',parcel_id:s.parcelId},first.token);
 assert.equal(uploaded.statusCode,201,uploaded.body);const evidence=uploaded.json().id as string;
 assert.equal((await s.request('PUT','/uploads/'+evidence+'/content',photo,first.token)).statusCode,200);
 assert.equal((await s.request('POST','/uploads/'+evidence+'/finalize',{},first.token)).statusCode,200);
 const request=async(agent:{token:string},version:number)=>{const key=randomUUID();return started.service.requestException(agent.token,s.parcelId,q,key,headers(key),
  {expected_version:version,reason_code:'provider_unavailable',evidence_id:evidence,recipient_present:true},randomUUID());};
 const oldRequest=await request(first,5),oldApprovalKey=randomUUID(),oldApproval=await started.service.approveException(admin.token,s.parcelId,q,oldApprovalKey,headers(oldApprovalKey),
  {expected_version:5,request_id:oldRequest.exception!.request_id},randomUUID());
 const unchanged=async()=>(await s.db.adminQuery('SELECT id,assignment_id,attempt_number,recipient_ref,recipient_contact_version,version,failed_verifications,resend_count,locked_at,state FROM shipit.delivery_attempts WHERE id=$1',[started.state.attempt_id])).rows;
 const before=await unchanged(),challenge=await testDeliveryCode(s,s.parcelId),instructionKey=randomUUID(),instruction=await service.authorize(started.dispatcher.token,q,instructionKey,headers(instructionKey),
  {parcel_id:s.parcelId,agent_id:next.id,expected_parcel_version:5},randomUUID());
 const grantKey=randomUUID(),grant=await service.grant(admin.token,q,grantKey,headers(grantKey),
  {parcel_id:s.parcelId,source_receipt_id:source,destination_kind:'agent',destination_agent_id:next.id},randomUUID());
 const prepareKey=randomUUID(),handover=await service.prepare(admin.token,q,prepareKey,headers(prepareKey),
  {agent_id:next.id,items:[{parcel_id:s.parcelId,expected_parcel_version:5,previous_receipt_id:source,instruction_id:instruction.resource_id,grant_id:grant.resource_id}]},randomUUID());
 const releaseKey=randomUUID();await service.release(first.token,q,releaseKey,headers(releaseKey),
  {parcel_id:s.parcelId,source_receipt_id:source,grant_id:grant.resource_id,manifest_id:handover.resource_id},randomUUID());
 assert.deepEqual(await unchanged(),before);assert.equal((await s.db.adminQuery('SELECT assigned_agent_id FROM shipit.parcels WHERE id=$1',[s.parcelId])).rows[0]!.assigned_agent_id,first.id);
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query('UPDATE shipit.delivery_attempts SET agent_id=$1 WHERE id=$2',[next.id,started.state.attempt_id]));
 const ackKey=randomUUID(),fault=createParcelCustodyService(paymentFault(s.pool,'UPDATE shipit.parcels p SET assigned_agent_id=','after'),true);
 await assert.rejects(fault.acknowledge(next.token,handover.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const omitted=createParcelCustodyService(paymentFault(s.pool,'INSERT INTO shipit.domain_events','omit'),true);
 await assert.rejects(omitted.acknowledge(next.token,handover.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.deepEqual(await unchanged(),before);
 assert.deepEqual((await s.db.adminQuery('SELECT agent_id FROM shipit.delivery_attempts WHERE id=$1',[started.state.attempt_id])).rows,[{agent_id:first.id}]);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int count FROM shipit.parcel_commands WHERE operation_id='api.v1.deliveries.reassign'")).rows[0]!.count,0);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int count FROM shipit.domain_events WHERE event_type='delivery.assignment_changed'")).rows[0]!.count,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int count FROM shipit.custody_receipts WHERE parcel_id=$1',[s.parcelId])).rows[0]!.count,1);
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.delivery_exception_requests WHERE id=$1',[oldRequest.exception!.request_id])).rows[0]!.state,'approved');
 const ack=await service.acknowledge(next.token,handover.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID());
 assert.deepEqual(await service.acknowledge(next.token,handover.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID()),ack);
 assert.deepEqual(await unchanged(),before);assert.equal(await testDeliveryCode(s,s.parcelId),challenge);
 assert.deepEqual((await s.db.adminQuery('SELECT agent_id FROM shipit.delivery_attempts WHERE id=$1',[started.state.attempt_id])).rows,[{agent_id:next.id}]);
 assert.deepEqual((await s.db.adminQuery('SELECT assigned_agent_id,version,attempts_started,failed_attempt_count FROM shipit.parcels WHERE id=$1',[s.parcelId])).rows,[{assigned_agent_id:next.id,version:6,attempts_started:1,failed_attempt_count:0}]);
 const oldKey=randomUUID();await assert.rejects(started.service.complete(first.token,s.parcelId,q,oldKey,headers(oldKey),
  {expected_version:6,challenge_ref:started.state.challenge_ref,challenge_version:started.state.challenge_version,proof:code},false,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const staleKey=randomUUID();await assert.rejects(started.service.complete(next.token,s.parcelId,q,staleKey,headers(staleKey),
  {expected_version:6,approval_ref:oldApproval.exception!.approval_ref},true,randomUUID()),{code:'DELIVERY_EXCEPTION_INVALID'});
 const fresh=await request(next,6),approveKey=randomUUID(),approved=await started.service.approveException(admin.token,s.parcelId,q,approveKey,headers(approveKey),
  {expected_version:6,request_id:fresh.exception!.request_id},randomUUID());
 const proofKey=randomUUID(),result=await started.service.complete(next.token,s.parcelId,q,proofKey,headers(proofKey),
  {expected_version:6,approval_ref:approved.exception!.approval_ref},true,randomUUID());assert.ok('proof_method' in result);assert.equal(result.proof_method,'exceptional');
 const events=(await s.db.adminQuery("SELECT envelope->'payload' payload FROM shipit.domain_events WHERE event_type='delivery.assignment_changed' AND parcel_id=$1",[s.parcelId])).rows;
 assert.deepEqual(events,[{payload:{attempt_id:started.state.attempt_id,assignment_id:started.state.assignment_id,from_agent_id:first.id,agent_id:next.id,instruction_id:instruction.resource_id,acknowledgement_command_id:ack.command_id}}]);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int count FROM shipit.parcel_transitions WHERE operation_id='deliveries.reassign' AND parcel_id=$1",[s.parcelId])).rows[0]!.count,1);
});

await test('ten-parcel custody report traces six genuine deliveries two physical returns and two held parcels at one cutoff',{timeout:60000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),other=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]);
 const booked=await s.book({...s.body,parcels:Array.from({length:10},(_,n)=>({...s.body.parcels[0],weight_grams:n===9?99:100}))});
 assert.equal(booked.statusCode,201,booked.body);const parcels=booked.json().parcels.map((p:{id:string})=>p.id) as string[];
 // Grant the same fixture runtime once; repeated parcel journeys reuse those actual completed preparations.
 const routes=s.db.prepareRoutes();await routes;const proofs=s.db.prepareDeliveries();await proofs;
 const startContext={...s,db:{...s.db,prepareRoutes:()=>routes,prepareDeliveries:()=>proofs},clock:()=>new Date()},dispatcher=await s.grant('dispatcher',[A]);
 const deliveries:Awaited<ReturnType<typeof startTestDelivery>>[]=[];for(const parcel of parcels)deliveries.push(await startTestDelivery(startContext,parcel,agent,dispatcher));
 await s.db.prepareCustody();const service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const legacy=await service.worklist(agent.token,q,null,randomUUID());assert.equal(legacy.items.length,10);
 assert.ok(legacy.items.every(i=>i.physical_custody==='unknown'&&i.receipt_id===null));
 const prepareKey=randomUUID(),m=await service.prepare(admin.token,q,prepareKey,headers(prepareKey),{agent_id:agent.id,
  items:parcels.map(parcel=>({parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}))},randomUUID());
 assert.deepEqual((await service.report(admin.token,m.resource_id,q,randomUUID())).totals,{total:10,delivered:0,returned:0,held:0,reassigned:0,pending:10,failed:0});
 const ackKey=randomUUID();await service.acknowledge(agent.token,m.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID());
 const held=await service.report(agent.token,m.resource_id,q,randomUUID());assert.equal(held.totals.held,10);
 for(let n=0;n<6;n++){
  const start=deliveries[n]!,parcel=parcels[n]!,code=await testDeliveryCode(s,parcel),key=randomUUID();
  const result=await start.service.complete(agent.token,parcel,q,key,headers(key),
   {expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:code},false,randomUUID());
  assert.ok('proof_method' in result);assert.equal(result.proof_method,'otp_verified');
 }
 for(const parcel of parcels.slice(6,8)){
  const key=randomUUID(),source=held.items.find(i=>i.parcel_id===parcel)!.current_receipt_id!;
  await service.receiveReturn(admin.token,q,key,headers(key),{parcel_id:parcel,expected_parcel_version:5,source_receipt_id:source,discrepancy:'none'},randomUUID());
 }
 const report=await service.report(admin.token,m.resource_id,q,randomUUID());
 assert.deepEqual(report.totals,{total:10,delivered:6,returned:2,held:2,reassigned:0,pending:0,failed:0});assert.equal(report.failure_count,0);
 const proofRows=(await s.db.adminQuery('SELECT id,parcel_id FROM shipit.delivery_proofs')).rows;
 assert.equal(proofRows.length,6);
 for(const item of report.items){
  assert.ok(item.origin_receipt_id);assert.ok(item.current_receipt_id);
  if(item.outcome==='delivered')assert.ok(proofRows.some(p=>p.id===item.proof_id&&p.parcel_id===item.parcel_id));
  else assert.equal(item.proof_id,null);
 }
 const {createCustodyExportService}=await import('../../src/modules/custody/exports.ts'),exports=createCustodyExportService(s.pool),captureKey=randomUUID();
 const captured=await exports.capture(admin.token,m.resource_id,q,captureKey,headers(captureKey),randomUUID());
 assert.deepEqual(captured.report.totals,report.totals);assert.deepEqual(captured.items,report.items);
 assert.deepEqual(await exports.capture(admin.token,m.resource_id,q,captureKey,headers(captureKey),randomUUID()),captured);
 const downloaded=await exports.read(admin.token,captured.id,q,randomUUID(),true);assert.ok('csv' in downloaded);
 assert.equal(downloaded.csv.split('\r\n').filter(Boolean).length,11);
 for(const item of captured.items)assert.ok(downloaded.csv.includes(item.parcel_id));
 for(const proof of proofRows)assert.ok(downloaded.csv.includes(proof.id));
 const accessCount=async()=>(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.custody_access_events')).rows[0]!.n;
 const permittedCount=await accessCount();
 await assert.rejects(exports.read(agent.token,captured.id,q,randomUUID(),true),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(exports.read(s.local.token,captured.id,q,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(exports.read(admin.token,captured.id,{organization_id:org,franchise_id:B},randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 assert.equal(await accessCount(),permittedCount);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.report_snapshots WHERE metadata->>'definition'='custody_manifest_v1'")).rows[0]!.n,1);
 const {manifest,manifestReport}=await import('../../src/modules/custody/repository.ts');
 const historical=await withCustodyScope(s.pool,admin.token,org,A,'custody.read',randomUUID(),async scope=>
  manifestReport(scope.access,await manifest(scope.access,m.resource_id,false),new Date(held.as_of)));
 assert.deepEqual(historical,held);
 await assert.rejects(service.report(other.token,m.resource_id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.report(agent.token,m.resource_id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const {createParcelService}=await import('../../src/modules/parcels/service.ts'),failureKey=randomUUID();
 await createParcelService(s.pool,()=>new Date()).execute(agent.token,parcels[8],q,failureKey,headers(failureKey),
  {expected_version:5,evidence_ref:randomUUID(),attempt_id:deliveries[8]!.state.attempt_id,reason_code:'customer_unavailable'},'parcels.fail_delivery',randomUUID());
 const failureReport=await service.report(admin.token,m.resource_id,q,randomUUID());
 assert.deepEqual(await exports.read(admin.token,captured.id,q,randomUUID()),captured);
 assert.deepEqual(await exports.capture(admin.token,m.resource_id,q,captureKey,headers(captureKey),randomUUID()),captured);
 assert.deepEqual(await exports.read(admin.token,captured.id,q,randomUUID(),true),downloaded);

 assert.deepEqual(failureReport.totals,{...report.totals,failed:1});assert.equal(failureReport.failure_count,1);
 assert.equal(failureReport.items.find(i=>i.parcel_id===parcels[8])!.outcome,'held');
 assert.equal(failureReport.items.find(i=>i.parcel_id===parcels[8])!.failure_ids.length,1);
 const ownWork=await service.worklist(agent.token,q,null,randomUUID());assert.equal(ownWork.items.length,4);
 assert.equal(ownWork.items.filter(i=>i.physical_custody==='agent').length,2);assert.equal(ownWork.items.filter(i=>i.physical_custody==='office').length,2);
 assert.equal((await service.worklist(other.token,q,null,randomUUID())).items.length,0);
 assert.equal((await service.worklist(admin.token,q,null,randomUUID())).items.length,10);
 await assert.rejects(service.worklist(agent.token,q,'malformed',randomUUID()));

 await s.memberships.revokeMembership(s.admin.token,agent.member.id,{expected_version:1});
 await assert.rejects(service.report(agent.token,m.resource_id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.worklist(agent.token,q,null,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.deepEqual((await service.report(admin.token,m.resource_id,q,randomUUID())).items,failureReport.items);
 const accesses=(await s.db.adminQuery('SELECT action,actor_id,manifest_id,snapshot_id,correlation_id FROM shipit.custody_access_events')).rows;
 assert.ok(accesses.some(a=>a.action==='custody.worklist'&&a.actor_id===agent.id));
 assert.ok(accesses.some(a=>a.action==='custody.read'&&a.manifest_id===m.resource_id));
 assert.ok(accesses.some(a=>a.action==='custody.export.download'&&a.snapshot_id===captured.id&&a.actor_id===admin.id));
 assert.ok(accesses.every(a=>typeof a.correlation_id==='string'));
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query('DELETE FROM shipit.custody_access_events WHERE snapshot_id=$1',[captured.id]));
 await assert.rejects(owner.query("UPDATE shipit.custody_access_events SET action='custody.export.read' WHERE snapshot_id=$1",[captured.id]));
 await s.memberships.revokeMembership(s.admin.token,admin.member.id,{expected_version:1});
 await assert.rejects(exports.read(admin.token,captured.id,q,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(exports.capture(admin.token,m.resource_id,q,captureKey,headers(captureKey),randomUUID()),{code:'RESOURCE_NOT_FOUND'});

});

await test('production custody HTTP gates writes, authenticates and protects CSV while paging the complete scoped worklist',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),other=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]),viewer=await s.grant('read_only',[A]);
 const booked=await s.book({...s.body,parcels:Array.from({length:50},(_,n)=>({...s.body.parcels[0],weight_grams:n===49?19:20}))});
 assert.equal(booked.statusCode,201,booked.body);const parcels=booked.json().parcels.map((p:{id:string})=>p.id) as string[],parcel=parcels[0]!;
 const prepared=await s.prepared(),calculated=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:prepared.intent.id},randomUUID());
 const extra=await s.book({...s.body,tax_calculation_id:calculated.id,tax_intent:prepared.body});assert.equal(extra.statusCode,201,extra.body);
 await startTestDelivery({...s,clock:()=>new Date()},parcel,agent);await s.db.prepareCustody();
 const {buildServer}=await import('../../src/server.ts'),{parseEnvironment}=await import('../../src/env.ts');
 const makeApp=(enabled:boolean)=>buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',CUSTODY_ENABLED:enabled?'true':'false'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});
 const app=makeApp(true),disabled=makeApp(false);t.after(async()=>{await app.close();await disabled.close();});
 const q={organization_id:org,franchise_id:A};
 const call=(method:'GET'|'POST',path:string,body:unknown={},actor=admin.token,key=randomUUID(),server=app,query:Record<string,string>=q)=>server.inject({
  method,url:'/api/v1/custody/'+path+'?'+new URLSearchParams(query),cookies:s.cookies(actor),headers:{...s.headers,'idempotency-key':key},
  ...(method==='POST'?{payload:JSON.stringify(body)}:{})});
 const temporary=await s.user();
 const accessCall=(path:string,body:unknown,actor=admin.token)=>app.inject({method:'POST',url:'/api/v1/'+path,cookies:s.cookies(actor),headers:s.headers,payload:JSON.stringify(body)});
 const invitationBody={organization_id:org,invitee_user_id:temporary.id,role:'delivery_agent',franchise_ids:[A]};
 assert.equal((await accessCall('membership-invitations',invitationBody,viewer.token)).statusCode,403);
 assert.equal((await accessCall('membership-invitations',{...invitationBody,franchise_ids:[B]})).statusCode,404);
 const invite=await accessCall('membership-invitations',invitationBody);assert.equal(invite.statusCode,201,invite.body);
 const invitation=invite.json();assert.equal(invitation.role,'delivery_agent');assert.deepEqual(invitation.franchise_ids,[A]);
 const invitationLifetime=Date.parse(invitation.expires_at)-Date.parse(invitation.created_at);
 // Separate clock_timestamp defaults are evaluated within the same INSERT.
 assert.ok(Math.abs(invitationLifetime-7*86400000)<1000);
 assert.equal((await accessCall('membership-invitations/accept',{token:invitation.acceptance_token},other.token)).statusCode,403);
 assert.equal((await call('GET','worklist',{},temporary.token)).statusCode,404);
 const activated=await accessCall('membership-invitations/accept',{token:invitation.acceptance_token},temporary.token);assert.equal(activated.statusCode,201,activated.body);
 assert.equal((await call('GET','worklist',{},temporary.token)).statusCode,200);
 const agentContext=await app.inject({url:'/api/v1/operator-context',cookies:s.cookies(temporary.token)});assert.equal(agentContext.statusCode,200,agentContext.body);assert.equal(agentContext.json().state,'ready');assert.deepEqual(agentContext.json().franchises.map((f:{id:string})=>f.id),[A]);assert.deepEqual(agentContext.json().franchises[0].roles,['delivery_agent']);
 assert.equal((await app.inject({url:'/api/v1/operator-context/franchises/'+B,cookies:s.cookies(temporary.token)})).statusCode,404);
 assert.ok((await call('GET','eligible-agents')).json().agents.some((a:{id:string})=>a.id===temporary.id));
 const member=activated.json();
 assert.equal((await accessCall('memberships/'+member.id+'/revoke',{expected_version:member.version+1})).statusCode,409);
 const revoked=await accessCall('memberships/'+member.id+'/revoke',{expected_version:member.version});assert.equal(revoked.statusCode,200,revoked.body);
 assert.equal((await call('GET','worklist',{},temporary.token)).statusCode,404);
 assert.ok(!(await call('GET','eligible-agents')).json().agents.some((a:{id:string})=>a.id===temporary.id));
 assert.equal((await app.inject({url:'/api/v1/operator-context',cookies:s.cookies(temporary.token)})).json().state,'scope_unavailable');
 const replaced=await accessCall('membership-invitations',invitationBody);assert.equal(replaced.statusCode,201,replaced.body);
 const reactivated=await accessCall('membership-invitations/accept',{token:replaced.json().acceptance_token},temporary.token);assert.equal(reactivated.statusCode,201,reactivated.body);
 assert.notEqual(reactivated.json().id,member.id);assert.equal((await call('GET','worklist',{},temporary.token)).statusCode,200);
 const roster=await app.inject({url:'/api/v1/organizations/'+org+'/memberships',cookies:s.cookies(admin.token)});assert.equal(roster.statusCode,200,roster.body);
 assert.deepEqual(roster.json().items.filter((m:{user_id:string})=>m.user_id===temporary.id).map((m:{lifecycle:string})=>m.lifecycle).sort(),['active','revoked']);
 const invitations=await app.inject({url:'/api/v1/organizations/'+org+'/invitations',cookies:s.cookies(admin.token)});assert.equal(invitations.statusCode,200,invitations.body);
 assert.ok(invitations.json().items.every((i:Record<string,unknown>)=>!('acceptance_token' in i)));
 const first=await call('GET','worklist');assert.equal(first.statusCode,200,first.body);assert.match(first.headers['cache-control'] as string,/no-store/);
 assert.equal(first.json().items.length,50);assert.ok(first.json().next_cursor);
 const second=await call('GET','worklist',{},admin.token,randomUUID(),app,{...q,cursor:first.json().next_cursor});
 assert.equal(second.statusCode,200,second.body);assert.equal(second.json().items.length,1);assert.equal(second.json().next_cursor,null);
 assert.equal(new Set([...first.json().items,...second.json().items].map((p:{parcel_id:string})=>p.parcel_id)).size,51);
 assert.equal((await call('GET','worklist',{},viewer.token)).json().items.length,50);
 assert.equal((await call('GET','worklist',{},agent.token)).json().items.length,1);
 assert.equal((await call('GET','worklist',{},other.token)).json().items.length,0);
 assert.equal((await call('GET','worklist',{},admin.token,randomUUID(),app,{...q,cursor:'malformed'})).statusCode,422);
 assert.equal((await app.inject('/api/v1/custody/worklist?'+new URLSearchParams(q))).statusCode,401);
 const body={agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},key=randomUUID();
 assert.equal((await app.inject({method:'POST',url:'/api/v1/custody/manifests?'+new URLSearchParams(q),cookies:s.cookies(admin.token),headers:{'content-type':'application/json','idempotency-key':key},payload:JSON.stringify(body)})).statusCode,403);
 assert.equal((await call('POST','manifests',body,admin.token,key,disabled)).statusCode,409);
 assert.equal((await call('POST','manifests',body,viewer.token)).statusCode,403);
 assert.equal((await call('POST','manifests',{...body,organization_id:otherOrg},admin.token)).statusCode,422);
 const created=await call('POST','manifests',body,admin.token,key);assert.equal(created.statusCode,200,created.body);const manifest=created.json().resource_id as string;
 assert.deepEqual((await call('POST','manifests',body,admin.token,key,disabled)).json(),created.json());
 assert.equal((await call('GET','manifests',{},agent.token)).json().items[0].id,manifest);
 assert.equal((await call('GET','manifests',{},other.token)).json().items.length,0);
 assert.deepEqual((await call('GET','eligible-agents',{},agent.token)).json(),{agents:[{id:agent.id}],next_cursor:null});
 assert.equal((await call('GET','manifests/'+manifest,{},other.token)).statusCode,404);
 const ackKey=randomUUID(),ack=await call('POST','manifests/'+manifest+'/acknowledge',{expected_version:1},agent.token,ackKey);
 assert.equal(ack.statusCode,200,ack.body);assert.deepEqual((await call('POST','manifests/'+manifest+'/acknowledge',{expected_version:1},agent.token,ackKey,disabled)).json(),ack.json());
 const granted=await call('POST','grants',{parcel_id:parcel,source_receipt_id:ack.json().receipt_ids[0],destination_kind:'office',destination_agent_id:null});
 assert.equal(granted.statusCode,200,granted.body);const transfer=granted.json().resource_id as string;
 const options=await call('GET','transfer-grants',{},agent.token);assert.equal(options.statusCode,200,options.body);
 assert.deepEqual(options.json(),{items:[{id:transfer,parcel_id:parcel,source_receipt_id:ack.json().receipt_ids[0],agent_id:agent.id,destination_kind:'office',destination_agent_id:null,parcel_version:5,assigned_agent_id:agent.id,can_prepare:false,instruction_id:null,office_release_id:null}],next_cursor:null});
 assert.equal((await call('GET','transfer-grants',{},other.token)).json().items.length,0);
 assert.equal((await call('GET','transfer-grants',{},agent.token,randomUUID(),app,{...q,cursor:'bad'})).statusCode,422);
 assert.deepEqual((await call('GET','transfer-grants/'+transfer+'/manifests',{},agent.token)).json(),{grant_id:transfer,items:[],next_cursor:null});
 assert.equal((await call('GET','transfer-grants/'+transfer+'/manifests',{},other.token)).statusCode,404);
 const released=await call('POST','releases',{parcel_id:parcel,source_receipt_id:ack.json().receipt_ids[0],grant_id:transfer,manifest_id:null},agent.token);
 assert.equal(released.statusCode,200,released.body);assert.equal((await call('GET','transfer-grants',{},agent.token)).json().items[0].office_release_id,released.json().resource_id);
 const report=await call('GET','manifests/'+manifest+'/report');assert.equal(report.json().totals.held,1);
 const captured=await call('POST','manifests/'+manifest+'/exports');assert.equal(captured.statusCode,200,captured.body);const snapshot=captured.json().id as string;
 const download=await call('GET','exports/'+snapshot+'/download');assert.equal(download.statusCode,200,download.body);
 assert.match(download.headers['content-type'] as string,/^text\/csv/);assert.match(download.headers['content-disposition'] as string,/^attachment; filename="custody-/);
 const structured=await call('GET','exports/'+snapshot+'/export');assert.equal(structured.statusCode,200,structured.body);
 assert.equal(structured.json().snapshot.id,snapshot);assert.equal(structured.json().csv,download.body);
 assert.equal(download.headers['x-content-type-options'],'nosniff');assert.match(download.headers['cache-control'] as string,/no-store/);assert.ok(download.body.includes(parcel));
 assert.equal((await call('GET','exports/'+snapshot+'/download',{},agent.token)).statusCode,403);
 assert.equal((await call('GET','exports/'+snapshot+'/download',{},admin.token,randomUUID(),app,{organization_id:org,franchise_id:B})).statusCode,404);
 const returned=await call('POST','returns',{parcel_id:parcel,expected_parcel_version:5,source_receipt_id:ack.json().receipt_ids[0],discrepancy:'damaged'});
 assert.equal(returned.statusCode,200,returned.body);assert.equal((await call('GET','manifests/'+manifest+'/report')).json().totals.returned,1);
 assert.equal((await call('GET','transfer-grants',{},agent.token)).json().items.length,0);
 assert.equal((await call('GET','transfer-grants/'+transfer+'/manifests',{},agent.token)).statusCode,404);
 assert.equal((await call('GET','exports/'+snapshot+'/download')).body,download.body);
 await s.memberships.revokeMembership(s.admin.token,agent.member.id,{expected_version:1});
 assert.equal((await call('GET','worklist',{},agent.token)).statusCode,404);
 assert.equal((await call('GET','manifests/'+manifest+'/report')).statusCode,200);
});

await test('custody candidate pages retain all active agents without siblings, duplicate rows or revoked access',{timeout:60000},async t=>{
 const s=await auditSetup(t,undefined,await custodyDatabase(t)),admin=await s.grant('franchise_admin',[A]);await s.db.prepareCustody();
 const expected:string[]=[];
 for(let n=0;n<101;n++){const agent=await s.grant('delivery_agent',[A]);expected.push(agent.id);}
 const sibling=await s.grant('delivery_agent',[B]),revoked=await s.grant('delivery_agent',[A]);
 await s.memberships.revokeMembership(s.admin.token,revoked.member.id,{expected_version:1});
 const service=createParcelCustodyService(s.pool),q={organization_id:org,franchise_id:A};
 const first=await service.agents(admin.token,q,randomUUID());assert.equal(first.agents.length,100);assert.equal(first.next_cursor,first.agents.at(-1)!.id);
 const second=await service.agents(admin.token,q,randomUUID(),first.next_cursor);assert.equal(second.agents.length,1);assert.equal(second.next_cursor,null);
 const actual=[...first.agents,...second.agents].map(a=>a.id);assert.deepEqual(actual,expected.sort());assert.equal(new Set(actual).size,101);
 assert.ok(!actual.includes(sibling.id));assert.ok(!actual.includes(revoked.id));
 await assert.rejects(service.agents(admin.token,q,randomUUID(),'malformed'));
 await s.memberships.revokeMembership(s.admin.token,admin.member.id,{expected_version:1});
 await assert.rejects(service.agents(admin.token,q,randomUUID(),first.next_cursor),{code:'RESOURCE_NOT_FOUND'});
});

await test('different receiving agents competing for one released source produce one current custodian and one reassignment',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),giver=await s.grant('delivery_agent',[A]),targets=[await s.grant('delivery_agent',[A]),await s.grant('delivery_agent',[A])],admin=await s.grant('franchise_admin',[A]);
 const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id,start=await startTestDelivery(s,parcel,giver);await s.db.prepareCustody();
 const service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const initialKey=randomUUID(),initial=await service.prepare(admin.token,q,initialKey,headers(initialKey),{agent_id:giver.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const receiveKey=randomUUID(),received=await service.acknowledge(giver.token,initial.resource_id,q,receiveKey,headers(receiveKey),{expected_version:1},randomUUID()),source=received.receipt_ids[0]!;
 const manifests:string[]=[];
 for(const target of targets){
  const instructionKey=randomUUID(),instruction=await service.authorize(start.dispatcher.token,q,instructionKey,headers(instructionKey),{parcel_id:parcel,agent_id:target.id,expected_parcel_version:5},randomUUID());
  const grantKey=randomUUID(),grant=await service.grant(admin.token,q,grantKey,headers(grantKey),{parcel_id:parcel,source_receipt_id:source,destination_kind:'agent',destination_agent_id:target.id},randomUUID());
  const prepareKey=randomUUID(),m=await service.prepare(giver.token,q,prepareKey,headers(prepareKey),{agent_id:target.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:source,instruction_id:instruction.resource_id,grant_id:grant.resource_id}]},randomUUID());manifests.push(m.resource_id);
  const releaseKey=randomUUID();await service.release(giver.token,q,releaseKey,headers(releaseKey),{parcel_id:parcel,source_receipt_id:source,grant_id:grant.resource_id,manifest_id:m.resource_id},randomUUID());
 }
 const keys=[randomUUID(),randomUUID()],results=await Promise.allSettled(targets.map((target,n)=>service.acknowledge(target.token,manifests[n],q,keys[n],headers(keys[n]!),{expected_version:1},randomUUID())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const winner=results.findIndex(r=>r.status==='fulfilled'),loser=1-winner;assert.equal((results[loser] as PromiseRejectedResult).reason.code,'VERSION_CONFLICT');
 const result=(results[winner] as PromiseFulfilledResult<Awaited<ReturnType<typeof service.acknowledge>>>).value;
 assert.deepEqual(await service.acknowledge(targets[winner]!.token,manifests[winner],q,keys[winner],headers(keys[winner]!),{expected_version:1},randomUUID()),result);
 await assert.rejects(service.acknowledge(targets[loser]!.token,manifests[loser],q,keys[loser],headers(keys[loser]!),{expected_version:1},randomUUID()),{code:'VERSION_CONFLICT'});
 const physical=(await s.db.adminQuery('SELECT agent_id,previous_receipt_id FROM shipit.custody_receipts WHERE parcel_id=$1 ORDER BY sequence',[parcel])).rows;
 assert.deepEqual(physical,[{agent_id:giver.id,previous_receipt_id:null},{agent_id:targets[winner]!.id,previous_receipt_id:source}]);
 assert.deepEqual((await s.db.adminQuery('SELECT p.version,p.assigned_agent_id,a.agent_id FROM shipit.parcels p JOIN shipit.delivery_attempts a ON a.id=p.active_attempt_id WHERE p.id=$1',[parcel])).rows,[{version:6,assigned_agent_id:targets[winner]!.id,agent_id:targets[winner]!.id}]);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.parcel_commands WHERE parcel_id=$1 AND operation_id='api.v1.deliveries.reassign'",[parcel])).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='delivery.assignment_changed'")).rows[0]!.n,1);
 assert.equal((await service.worklist(giver.token,q,null,randomUUID())).items.length,0);
 assert.equal((await service.worklist(targets[loser]!.token,q,null,randomUUID())).items.length,0);
 assert.equal((await service.worklist(targets[winner]!.token,q,null,randomUUID())).items[0]!.receipt_id,result.receipt_ids[0]);
 const history=await service.report(admin.token,initial.resource_id,q,randomUUID());assert.equal(history.totals.reassigned,1);assert.equal(history.totals.delivered,0);assert.equal(history.items[0]!.origin_receipt_id,source);
});

await test('custody export lost commit reply, rollback, expiry and quota preserve immutable private capture identity',{timeout:30000},async t=>{
 const s=await bookingSetup(t,await custodyDatabase(t)),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]);
 const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;await startTestDelivery(s,parcel,agent);await s.db.prepareCustody();
 const service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key],prepareKey=randomUUID();
 const manifest=await service.prepare(admin.token,q,prepareKey,headers(prepareKey),{agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const {createCustodyExportService}=await import('../../src/modules/custody/exports.ts'),{keyDigest,digest}=await import('../../src/modules/pricing/idempotency.ts');
 const exports=createCustodyExportService(s.pool),failedKey=randomUUID(),fault=createCustodyExportService(paymentFault(s.pool,'INSERT INTO shipit.custody_access_events','before'));
 await assert.rejects(fault.capture(admin.token,manifest.resource_id,q,failedKey,headers(failedKey),randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,0);
 const key=randomUUID(),lost=createCustodyExportService(paymentFault(s.pool,'COMMIT','after'));
 await assert.rejects(lost.capture(admin.token,manifest.resource_id,q,key,headers(key),randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const saved=await exports.capture(admin.token,manifest.resource_id,q,key,headers(key),randomUUID());
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,1);
 assert.deepEqual(await exports.capture(admin.token,manifest.resource_id,q,key,headers(key),randomUUID()),saved);
 assert.deepEqual(await exports.read(admin.token,saved.id,q,randomUUID()),saved);
 await assert.rejects(exports.capture(admin.token,manifest.resource_id,{...q,franchise_id:B},key,headers(key),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const otherKey=randomUUID(),otherManifest=await service.prepare(admin.token,q,otherKey,headers(otherKey),{agent_id:agent.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 await assert.rejects(exports.capture(admin.token,otherManifest.resource_id,q,key,headers(key),randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 // Seed an already-expired retained snapshot in the disposable database; do not alter an immutable live capture or production clock.
 const expiredId=randomUUID(),expiredKey=randomUUID(),asOf=new Date(Date.now()-2*86400000).toISOString(),expiresAt=new Date(Date.parse(asOf)+86400000).toISOString();
 const metadata={...saved,id:expiredId,as_of:asOf,expires_at:expiresAt,report:{...saved.report,as_of:asOf}};delete (metadata as Partial<typeof saved>).items;
 await s.db.adminQuery('INSERT INTO shipit.report_snapshots(id,organization_id,franchise_id,actor_id,key_digest,fingerprint,metadata,rows,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[expiredId,org,A,admin.id,keyDigest('custody.export:'+expiredKey),digest({definition:'custody_manifest_v1',manifest_id:manifest.resource_id}),metadata,JSON.stringify(saved.items),asOf,expiresAt]);
 await assert.rejects(exports.read(admin.token,expiredId,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(exports.capture(admin.token,manifest.resource_id,q,expiredKey,headers(expiredKey),randomUUID()),{code:'REPORT_EXPIRED'});
 const retried=await exports.capture(admin.token,manifest.resource_id,q,failedKey,headers(failedKey),randomUUID());assert.notEqual(retried.id,saved.id);
 assert.deepEqual((await s.db.adminQuery('SELECT metadata,rows FROM shipit.report_snapshots WHERE id=$1',[expiredId])).rows,[{metadata:null,rows:null}]);
 // Exactly twenty active actor/franchise snapshots; expiry cleanup does not delete replay identity.
 for(let n=2;n<20;n++){const captureKey=randomUUID();await exports.capture(admin.token,manifest.resource_id,q,captureKey,headers(captureKey),randomUUID());}
 const quotaKey=randomUUID();await assert.rejects(exports.capture(admin.token,manifest.resource_id,q,quotaKey,headers(quotaKey),randomUUID()),{code:'REPORT_QUOTA_EXCEEDED'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots WHERE expires_at>clock_timestamp()')).rows[0]!.n,20);
 assert.deepEqual(await exports.capture(admin.token,manifest.resource_id,q,key,headers(key),randomUUID()),saved);
 await assert.rejects(exports.capture(agent.token,manifest.resource_id,q,key,headers(key),randomUUID()),{code:'ACTION_FORBIDDEN'});
});

await test('custody transfer and outgoing manifest pages retain fifty-one current records and deny revoked continuation',{timeout:30000},async t=>{
 const started=performance.now(),stage=(label:string)=>console.log('Pagination setup '+label+': '+Math.round(performance.now()-started)+'ms');
 // Pagination does not qualify migrations. Apply the complete schema once, then avoid
 // spawning the migration CLI repeatedly for unchanged prerequisite grant helpers.
 const database=await provisionDatabase(t);assert.deepEqual(await database.migrate(),{applied:52});
 const migrate=database.migrate;database.migrate=async options=>{if(options)throw new Error('PAGINATION_FIXTURE_MIGRATION_OPTIONS');return {applied:0};};
 const s=await bookingSetup(t,database),giver=await s.grant('delivery_agent',[A]),receiver=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]);
 stage('memberships');const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id,start=await startTestDelivery(s,parcel,giver);await s.db.prepareCustody();
 database.migrate=migrate;stage('delivery/schema');const service=createParcelCustodyService(s.pool,true),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 const initialKey=randomUUID(),initial=await service.prepare(admin.token,q,initialKey,headers(initialKey),{agent_id:giver.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null}]},randomUUID());
 const ackKey=randomUUID(),received=await service.acknowledge(giver.token,initial.resource_id,q,ackKey,headers(ackKey),{expected_version:1},randomUUID()),receipt=received.receipt_ids[0]!;
 const instructionKey=randomUUID(),instruction=await service.authorize(start.dispatcher.token,q,instructionKey,headers(instructionKey),{parcel_id:parcel,agent_id:receiver.id,expected_parcel_version:5},randomUUID());
 stage('source/instruction');const ids:string[]=[];for(let n=0;n<51;n++){const key=randomUUID(),g=await service.grant(admin.token,q,key,headers(key),{parcel_id:parcel,source_receipt_id:receipt,destination_kind:'agent',destination_agent_id:receiver.id},randomUUID());ids.push(g.resource_id);}
 stage('51grants');const first=await service.transfers(giver.token,q,null,randomUUID());assert.equal(first.items.length,50);assert.ok(first.next_cursor);
 const second=await service.transfers(giver.token,q,first.next_cursor,randomUUID());assert.equal(second.items.length,1);assert.equal(second.next_cursor,null);
 assert.deepEqual([...first.items,...second.items].map(g=>g.id).sort(),ids.sort());assert.equal(new Set([...first.items,...second.items].map(g=>g.id)).size,51);
 assert.equal((await service.transfers(receiver.token,q,first.next_cursor,randomUUID())).items.length,0);
 const grantId=ids[0]!,manifests:string[]=[];for(let n=0;n<51;n++){const key=randomUUID(),m=await service.prepare(giver.token,q,key,headers(key),{agent_id:receiver.id,items:[{parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:receipt,instruction_id:instruction.resource_id,grant_id:grantId}]},randomUUID());manifests.push(m.resource_id);}
 stage('51manifests');const outgoing=await service.outgoingManifests(giver.token,grantId,q,null,randomUUID());assert.equal(outgoing.items.length,50);assert.ok(outgoing.next_cursor);
 const last=await service.outgoingManifests(giver.token,grantId,q,outgoing.next_cursor,randomUUID());assert.equal(last.items.length,1);assert.equal(last.next_cursor,null);
 assert.deepEqual([...outgoing.items,...last.items].map(m=>m.id).sort(),manifests.sort());assert.equal(new Set([...outgoing.items,...last.items].map(m=>m.id)).size,51);
 assert.ok([...outgoing.items,...last.items].every(m=>m.agent_id===receiver.id&&!m.released));
 await assert.rejects(service.outgoingManifests(receiver.token,grantId,q,outgoing.next_cursor,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.outgoingManifests(giver.token,grantId,{...q,franchise_id:B},outgoing.next_cursor,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const revokeKey=randomUUID();await service.revokeGrant(admin.token,grantId,q,revokeKey,headers(revokeKey),{expected_version:1},randomUUID());
 await assert.rejects(service.outgoingManifests(giver.token,grantId,q,outgoing.next_cursor,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await service.transfers(giver.token,q,null,randomUUID())).items.length,50);assert.equal((await service.transfers(giver.token,q,null,randomUUID())).next_cursor,null);
 await s.memberships.revokeMembership(s.admin.token,giver.member.id,{expected_version:1});await assert.rejects(service.transfers(giver.token,q,first.next_cursor,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.custody_receipts WHERE parcel_id=$1',[parcel])).rows[0]!.n,1);
});
