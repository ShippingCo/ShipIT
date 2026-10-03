import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { carrierSetup } from '../carrier-support.ts';
import { finalizedManifest } from '../route-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { withCarrierScope } from '../../src/modules/memberships/service.ts';
import { ingestTrackingPage } from '../../src/modules/carriers/tracking-ingestion.ts';
import { createCarrierReconciliationService } from '../../src/modules/carriers/reconciliation-service.ts';
import { paymentFault } from '../payment-support.ts';

async function setup(t:Parameters<typeof carrierSetup>[0]) {
  const s=await carrierSetup(t),iid=(await s.install()).json().id as string,ref=(await s.link(iid)).json().id as string;
  const row={parcel_id:s.parcel,reference_id:ref,external_docket:'SYN-54',source_id:'EVENT-58',status_code:'MOVE',status:'in_transit_claim',
    occurred_at:{state:'known',at:s.clock().toISOString()}};
  const page=(observations:unknown[]=[row],expected_version=0)=>({id:randomUUID(),installation_id:iid,expected_version,cursor:'NEXT-1',state:'success',channel:'poll',observations});
  const ingest=(body:unknown)=>withCarrierScope(s.pool,s.local.token,org,A,'carriers.write',randomUUID(),({access})=>ingestTrackingPage(access,body,s.clock()));
  const list=async()=>{const result=await s.request('GET',`carriers/installations/${iid}/reconciliation`);assert.equal(result.statusCode,200,result.body);return result;};
  const input={decision:'apply',reason_code:'verified_movement',expected_version:1,expected_parcel_version:3};
  const resolve=(id:string,body:unknown=input,key=randomUUID())=>s.request('POST',`carriers/reconciliation/${id}/resolve`,body,s.local.token,key);
  async function dispatch() {
    await s.db.prepareRoutes();
    const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.local.id,role:'dispatcher',franchise_ids:[A]});
    await s.memberships.acceptInvitation(s.local.token,{token:invite.acceptance_token});
    let result=await s.request('POST',`parcels/${s.parcel}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()},s.operator.token);
    assert.equal(result.statusCode,200,result.body);
    const manifest=await finalizedManifest(s.pool,s.keys.browser,s.local.token,[s.parcel]);
    result=await s.request('POST',`parcels/${s.parcel}/dispatch`,{expected_version:2,evidence_ref:randomUUID(),manifest_id:manifest});
    assert.equal(result.statusCode,200,result.body);
  }
  return {...s,iid,ref,row,page,ingest,list,resolve,input,dispatch};
}

await test('file and poll identity produces one approved transition and outbox event; reload and concurrent resolution are durable',{timeout:60000},async t=>{
  const s=await setup(t);await s.dispatch();
  const docket=(await s.db.adminQuery<{docket:string}>('SELECT docket FROM shipit.parcels WHERE id=$1',[s.parcel])).rows[0]!.docket;
  const fields=['docket','external_docket','source_id','status_code','occurred_at'];
  const preview=await s.request('POST',`carriers/installations/${s.iid}/imports`,{kind:'tracking',
    content_base64:Buffer.from(fields.join(',')+'\n'+[docket,'SYN-54','EVENT-58','MOVE',s.clock().toISOString()].join(',')).toString('base64'),
    columns:Object.fromEntries(fields.map(f=>[f,f])),status_mapping:[{source_code:'MOVE',status:'in_transit_claim'}]});
  assert.equal(preview.statusCode,201,preview.body);
  const committed=await s.request('POST',`carriers/imports/${preview.json().id}/commit`,{rows:[2]});assert.equal(committed.statusCode,200,committed.body);
  const page=s.page();assert.deepEqual(await s.ingest(page),await s.ingest(page));
  const items=(await s.list()).json().items;assert.equal(items.length,2);
  const original=items.find((x:{duplicate_of:string|null})=>!x.duplicate_of),duplicate=items.find((x:{duplicate_of:string|null})=>x.duplicate_of);
  assert.equal(original.reason,'ready');assert.equal(duplicate.duplicate_of,original.id);
  assert.equal((await s.resolve(duplicate.id)).statusCode,409);
  const key=randomUUID(),results=await Promise.all([s.resolve(original.id,s.input,key),s.resolve(original.id,s.input,key)]);
  results.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.deepEqual(results[0]!.json(),results[1]!.json());
  assert.equal((await s.resolve(original.id,{...s.input,decision:'reject',reason_code:'superseded'},key)).statusCode,409);
  assert.equal((await s.resolve(original.id)).statusCode,409);
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows,[{status:'in_transit',version:4}]);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='parcel.in_transit'")).rows[0]!.n,1);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.carrier_tracking_decisions')).rows[0]!.n,1);
  const fresh=createCarrierReconciliationService(s.db.runtimePool(),s.keys.browser,s.clock);
  const reloaded=await fresh.list(s.local.token,s.iid,s.q,randomUUID());assert.equal(reloaded.items.find(x=>x.id===original.id)!.decision,'apply');
  const outage={...s.page([],1),state:'unavailable',cursor:'MUST-NOT-ADVANCE'};await s.ingest(outage);
  const after=(await s.list()).json();assert.equal(after.freshness.state,'unavailable');assert.ok(after.freshness.last_source_at);
  assert.equal((await s.db.adminQuery('SELECT cursor_value FROM shipit.carrier_tracking_checkpoints ORDER BY version DESC LIMIT 1')).rows[0]!.cursor_value,'NEXT-1');
  assert.equal(after.items.length,2);
});

await test('unknown time/status, old/future evidence, delivery claims and docket conflicts cannot mutate parcel or money',{timeout:60000},async t=>{
  const s=await setup(t);await s.dispatch();const money=(await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows;
  const variants=[
    {...s.row,source_id:'DELIVERED',status:'delivered_claim'},
    {...s.row,source_id:'UNKNOWN',status:null},
    {...s.row,source_id:'TIME',occurred_at:{state:'unknown',reason:'unknown_timezone'}},
    {...s.row,source_id:'OLD',occurred_at:{state:'known',at:'2098-12-30T23:00:00Z'}},
    {...s.row,source_id:'FUTURE',occurred_at:{state:'known',at:'2099-01-02T23:00:00Z'}},
    {...s.row,source_id:'DOCKET',external_docket:'CONFLICT'},
    {...s.row,source_id:'COLLISION'}, {...s.row,source_id:'COLLISION',status:'held_claim'},
  ];
  await s.ingest(s.page(variants));const items=(await s.list()).json().items;
  for(const reason of ['proof_required','unsupported_status','unknown_timezone','stale','future_time','reference_conflict','source_conflict']){
    const item=items.find((x:{reason:string})=>x.reason===reason);assert.ok(item,reason);
    assert.equal((await s.resolve(item.id)).statusCode,409,reason);
  }
  const delivered=items.find((x:{reason:string})=>x.reason==='proof_required');
  const reject={...s.input,decision:'reject',reason_code:'insufficient_evidence'};
  const raced=await Promise.all([s.resolve(delivered.id,reject),s.resolve(delivered.id,reject)]);
  assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,409]);
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows,[{status:'dispatched',version:3}]);
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,money);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.delivery_proofs')).rows[0]!.n,0);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='parcel.in_transit'")).rows[0]!.n,0);
  const audit=(await s.db.adminQuery("SELECT reason_code FROM shipit.audit_history WHERE resource_type='carrier_reconciliation'")).rows;
  assert.deepEqual(audit,[{reason_code:'insufficient_evidence'}]);
  assert.doesNotMatch(JSON.stringify(items),/Synthetic Recipient|Fictional Street|202-555|LLM_API_KEY|credential|plaintext/i);
});

await test('scope, roles, nested installation, malformed input and expected versions fail safely',{timeout:60000},async t=>{
  const s=await setup(t);await s.ingest(s.page());const id=(await s.list()).json().items[0].id;
  const path=`carriers/reconciliation/${id}/resolve`,body={...s.input,decision:'reject',reason_code:'superseded',expected_parcel_version:1};
  for(const role of ['operator','dispatcher','read_only','accountant','delivery_agent']){
    const actor=await s.grant(role,[A]);assert.equal((await s.request('POST',path,body,actor.token)).statusCode,403);
  }
  const sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta('franchise_admin');
  for(const [actor,q] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
    const read=await s.request('GET',`carriers/installations/${s.iid}/reconciliation`,undefined,actor.token,randomUUID(),q);assert.equal(read.statusCode,404);
    assert.equal((await s.request('POST',path,body,actor.token,randomUUID(),q)).statusCode,404);assert.doesNotMatch(read.body,/items|counts/);
    await assert.rejects(withCarrierScope(s.pool,actor.token,q.organization_id,q.franchise_id,'carriers.write',randomUUID(),({access})=>ingestTrackingPage(access,s.page())),{code:'RESOURCE_NOT_FOUND'});
  }
  const other=(await s.install()).json().id;
  await assert.rejects(s.ingest({...s.page(),installation_id:other}),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(s.ingest({...s.page(),expected_version:1,observations:[{...s.row,extra:'secret'}]}),{code:'VALIDATION_FAILED'});
  await assert.rejects(s.ingest({...s.page(),expected_version:1,observations:[{...s.row,occurred_at:{state:'known',at:'2099-01-01T00:00:00'}}]}),{code:'VALIDATION_FAILED'});
  assert.equal((await s.resolve(id,{...body,expected_version:2})).statusCode,409);
  assert.equal((await s.resolve(id,{...body,expected_parcel_version:2})).statusCode,409);
  assert.equal((await s.resolve(id,{...body,paid:true})).statusCode,422);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.carrier_tracking_decisions')).rows[0]!.n,0);
  assert.doesNotMatch(s.logs.join('\n'),/Synthetic Recipient|Fictional Street|EVENT-58|SYN-54|LLM_API_KEY/);
});

await test('out-of-order observations, equal-time conflict, reference correction and competing checkpoints require fresh review',{timeout:60000},async t=>{
  const s=await setup(t);await s.dispatch();
  const before=s.clock().getTime();s.setNow(new Date(before+120_000).toISOString());
  const old={...s.row,source_id:'OLDER',occurred_at:{state:'known',at:new Date(before+60_000).toISOString()}};
  const recent={...s.row,source_id:'NEWER',occurred_at:{state:'known',at:s.clock().toISOString()}};
  await s.ingest(s.page([recent,old]));
  let items=(await s.list()).json().items;
  const older=items.find((x:{source_id:string})=>x.source_id==='external:OLDER');
  assert.equal(older.reason,'stale');assert.equal((await s.resolve(older.id)).statusCode,409);
  const conflict={...recent,source_id:'DISAGREE',status:'held_claim'};
  await s.ingest(s.page([conflict],1));items=(await s.list()).json().items;
  const newer=items.find((x:{source_id:string})=>x.source_id==='external:NEWER');assert.equal(newer.reason,'source_conflict');
  assert.equal((await s.resolve(newer.id)).statusCode,409);
  const outcomes=await Promise.allSettled([s.ingest(s.page([],2)),s.ingest(s.page([],2))]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const corrected=await s.request('POST',`parcels/${s.parcel}/carriers/references`,{installation_id:s.iid,external_docket:'CORRECTED',service_code:'STD',
    origin_code:'ORIGIN',destination_code:'UNKNOWN',expected_version:1,reason_code:'reference_correction'});assert.equal(corrected.statusCode,201,corrected.body);
  assert.equal((await s.resolve(newer.id)).statusCode,409);
  assert.equal((await s.list()).json().items.find((x:{id:string})=>x.id===newer.id).reason,'reference_conflict');
  const paged=await s.request('GET',`carriers/installations/${s.iid}/reconciliation`,undefined,s.local.token,randomUUID(),{...s.q,limit:'1'});
  assert.equal(paged.json().items.length,1);assert.ok(paged.json().page.next_cursor);
  const other=(await s.install()).json().id;
  const wrongCursor=await s.request('GET',`carriers/installations/${other}/reconciliation`,undefined,s.local.token,randomUUID(),{...s.q,limit:'1',cursor:paged.json().page.next_cursor});
  assert.equal(wrongCursor.statusCode,422);assert.equal(wrongCursor.json().error.code,'CURSOR_INVALID');
});

await test('admin-only approval cannot inherit dispatcher authority and revoked membership denies replay',{timeout:60000},async t=>{
  const s=await setup(t);await s.dispatch();await s.ingest(s.page());const id=(await s.list()).json().items[0].id;
  const admin=await s.grant('franchise_admin',[A]);
  assert.equal((await s.request('POST',`carriers/reconciliation/${id}/resolve`,s.input,admin.token)).statusCode,403);
  const key=randomUUID();assert.equal((await s.resolve(id,s.input,key)).statusCode,200);
  // Existing membership revocation is also checked on replay, before the saved decision is returned.
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});
  assert.equal((await s.resolve(id,s.input,key)).statusCode,403);
});

await test('different carrier installations keep separate identities but conflicting same-parcel claims require review',{timeout:60000},async t=>{
  const s=await setup(t);await s.dispatch();await s.ingest(s.page());
  const iid=(await s.install()).json().id as string,reference=(await s.link(iid)).json().id as string;
  await s.ingest({...s.page([{...s.row,reference_id:reference,status_code:'HOLD',status:'held_claim'}]),installation_id:iid});
  const original=(await s.list()).json().items[0];assert.equal(original.reason,'source_conflict');
  assert.equal((await s.resolve(original.id)).statusCode,409);
  const second=(await s.request('GET',`carriers/installations/${iid}/reconciliation`)).json().items[0];
  assert.equal(second.duplicate_of,null);
  const rejection=await s.resolve(second.id,{...s.input,decision:'reject',reason_code:'incorrect_report'});assert.equal(rejection.statusCode,200,rejection.body);
  assert.equal((await s.list()).json().items[0].reason,'ready');
  assert.equal((await s.resolve(original.id)).statusCode,200);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='parcel.in_transit'")).rows[0]!.n,1);
});

await test('failed transaction rolls back decision and outbox; lost commit replays; page checkpoint is atomic',{timeout:60000},async t=>{
  const s=await setup(t);await s.dispatch();const page=s.page();
  const badPage=paymentFault(s.pool,'INSERT INTO shipit.carrier_tracking_checkpoints','before');
  await assert.rejects(withCarrierScope(badPage,s.local.token,org,A,'carriers.write',randomUUID(),({access})=>ingestTrackingPage(access,page,s.clock())),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.carrier_tracking_records')).rows[0]!.n,0);
  await s.ingest(page);const id=(await s.list()).json().items[0].id,key=randomUUID();
  const broken=createCarrierReconciliationService(paymentFault(s.pool,'INSERT INTO shipit.carrier_tracking_decisions','before'),s.keys.browser,s.clock);
  await assert.rejects(broken.resolve(s.local.token,id,key,s.input,s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.db.adminQuery('SELECT version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows[0]!.version,3);
  const uncertain=createCarrierReconciliationService(paymentFault(s.pool,'COMMIT','after'),s.keys.browser,s.clock);
  await assert.rejects(uncertain.resolve(s.local.token,id,key,s.input,s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.resolve(id,s.input,key)).statusCode,200);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='parcel.in_transit'")).rows[0]!.n,1);
  const owner=s.db.ownerPool();
  for(const table of ['carrier_tracking_records','carrier_tracking_decisions','carrier_tracking_checkpoints'])await assert.rejects(owner.query(`DELETE FROM shipit.${table}`));
});
