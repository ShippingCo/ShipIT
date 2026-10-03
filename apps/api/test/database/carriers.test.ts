import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { carrierSetup,referenceInput,observationInput } from '../carrier-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createCarrierService } from '../../src/modules/carriers/service.ts';
import { paymentFault } from '../payment-support.ts';

await test('manual booking, normalized references, immutable corrections and reviewed claims survive restart', {timeout:60000},async t=>{
  const s=await carrierSetup(t),installation=await s.install();assert.equal(installation.statusCode,201,installation.body);
  const iid=installation.json().id;
  const manifest=(await s.request('GET','carriers/installations')).json().items[0];
  assert.equal(manifest.mode,'manual');assert.equal(manifest.capabilities.booking_api.enabled,false);
  const mapped=await s.request('POST',`carriers/installations/${iid}/mappings`,{kind:'service',source_code:'STD',normalized_id:null,expected_version:0,reason_code:'initial_mapping'});
  assert.equal(mapped.statusCode,201,mapped.body);
  const linked=await s.link(iid);assert.equal(linked.statusCode,201,linked.body);
  const path=`parcels/${s.parcel}/carriers/`;
  const first=(await s.request('GET',path+'references')).json().items[0];
  assert.equal(first.dimensions.service.state,'mapped');assert.equal(first.dimensions.service.mappingVersionId,mapped.json().id);
  assert.deepEqual(first.dimensions.destination,{state:'unmapped',sourceCode:'UNKNOWN'});
  const baseline=(await s.db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows;
  const money=(await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows;
  const events=(await s.counts())!.events;
  const key=randomUUID(),body={...observationInput(first.id),status:'delivered_claim'};
  const observed=await s.observe(first.id,body,key);assert.equal(observed.statusCode,201,observed.body);
  assert.deepEqual((await s.observe(first.id,body,key)).json(),observed.json());
  assert.equal((await s.observe(first.id,{...body,status:'returned_claim'},key)).statusCode,409);
  const row=(await s.request('GET',path+'observations')).json().items[0];
  assert.equal(row.review_state,'pending_review');assert.equal(row.status_code,'MOVING');
  assert.equal(row.evidence.provenance.actorId,s.local.id);assert.equal(row.evidence.provenance.mode,'manual');
  assert.deepEqual(row.evidence.occurredAt,{state:'unknown',reason:'unknown_timezone'});
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows,baseline);
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,money);assert.equal((await s.counts())!.events,events);
  const corrected=await s.link(iid,{...referenceInput(iid),external_docket:'SYN-CORRECTED',expected_version:1,reason_code:'reference_correction'});
  assert.equal(corrected.statusCode,201,corrected.body);
  assert.equal((await s.observe(first.id)).json().error.code,'VERSION_CONFLICT');
  assert.equal((await s.link(iid,{...referenceInput(iid),expected_version:1,reason_code:'reference_correction'})).statusCode,409);
  const fresh=createCarrierService(s.db.runtimePool(),s.keys.browser,s.clock);
  const history=await fresh.list('references',s.local.token,s.parcel,s.q,randomUUID());assert.equal(history.items.length,2);
  assert.deepEqual(await fresh.mutate('observation',s.local.token,s.parcel,key,body,s.q,randomUUID()),observed.json());
  assert.equal((await fresh.list('observations',s.local.token,s.parcel,s.q,randomUUID())).items.length,1);
  const audits=await s.list(s.local.token,{resource_type:'carrier',franchise_id:A});assert.equal(audits.statusCode,200,audits.body);
  assert.equal(audits.json().items.length,5);
  const page=(await s.list(s.local.token,{resource_type:'carrier',franchise_id:A,limit:'1'})).json();
  const next=await s.list(s.local.token,{resource_type:'carrier',franchise_id:A,limit:'1',cursor:page.page.next_cursor});
  assert.equal(next.statusCode,200,next.body);assert.notEqual(next.json().items[0].id,page.items[0].id);
  for(const forbidden of ['Synthetic Recipient','Fictional Street','202-555','SYN-CORRECTED','MOVING'])assert.ok(!audits.body.includes(forbidden));
  for(const forbidden of ['Fictional Street','SYN-CORRECTED','MOVING'])assert.ok(!s.logs.join('').includes(forbidden));
});

await test('installation docket namespace, duplicate races and correction races remain atomic', {timeout:60000},async t=>{
  const s=await carrierSetup(t),one=(await s.install()).json().id;
  const courier=(await s.request('GET','carriers/installations')).json().items[0].courier_id;
  const secondInstall=await s.request('POST','carriers/installations',{label:'SYN-SECOND',courier_id:courier});
  assert.equal(secondInstall.statusCode,201,secondInstall.body);const two=secondInstall.json().id;
  const key=randomUUID(),input=referenceInput(one);
  const duplicate=await Promise.all([s.link(one,input,key),s.link(one,input,key)]);
  duplicate.forEach(r=>assert.equal(r.statusCode,201,r.body));assert.deepEqual(duplicate[0]!.json(),duplicate[1]!.json());
  assert.equal((await s.link(two)).statusCode,201);
  const second=await s.book();assert.equal(second.statusCode,201,second.body);
  const parcel=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.parcels WHERE booking_id=$1',[second.json().id])).rows[0]!.id;
  assert.equal((await s.link(one,input,randomUUID(),parcel)).statusCode,409);
  const changes=await Promise.all(['NEW-1','NEW-2'].map(external_docket=>s.link(one,{...input,external_docket,expected_version:1,reason_code:'reference_correction'})));
  assert.deepEqual(changes.map(r=>r.statusCode).sort(),[201,409]);
  const observeKey=randomUUID(),ref=changes.find(r=>r.statusCode===201)!.json().id;
  const observations=await Promise.all([s.observe(ref,observationInput(ref),observeKey),s.observe(ref,observationInput(ref),observeKey)]);
  observations.forEach(r=>assert.equal(r.statusCode,201,r.body));assert.deepEqual(observations[0]!.json(),observations[1]!.json());
  assert.deepEqual(await s.carrierCounts(),{commands:6,refs:3,observations:1,audits:6});
});

await test('R19/W26 roles, foreign nested resources and bounded reads cannot disclose or mutate other tenants', {timeout:60000},async t=>{
  const s=await carrierSetup(t),iid=(await s.install()).json().id,ref=(await s.link(iid)).json().id;
  const path=`parcels/${s.parcel}/carriers/observations`;
  for(const role of ['franchise_admin','operator','dispatcher','accountant','delivery_agent','read_only']){
    const actor=await s.grant(role,[A]);
    const read=await s.request('GET',path,undefined,actor.token);
    assert.equal(read.statusCode,role==='accountant'?403:role==='delivery_agent'?404:200,role+read.body);
    const write=await s.request('POST',path,observationInput(ref),actor.token);
    assert.equal(write.statusCode,role==='franchise_admin'?201:403,role+write.body);
  }
  assert.equal((await s.request('POST',path,observationInput(ref),s.admin.token)).statusCode,403);
  assert.equal((await s.request('GET',path,undefined,s.admin.token)).statusCode,200);
  const sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta('franchise_admin');
  const before=await s.carrierCounts();
  for(const [actor,q] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
    for(const route of [path,`parcels/${s.parcel}/carriers/references`,`carriers/installations/${iid}/mappings`]){
      const response=await s.request('GET',route,undefined,actor.token,randomUUID(),q);assert.equal(response.statusCode,404,response.body);
    }
    const result=await s.request('POST',path,observationInput(ref),actor.token,randomUUID(),q);assert.equal(result.statusCode,404,result.body);
    assert.deepEqual((await s.request('GET','carriers/installations',undefined,actor.token,randomUUID(),q)).json().items,[]);
    // Valid A installation nested in a mapping write under B/C fails just like an unknown installation.
    const body={kind:'service',source_code:'STD',normalized_id:null,expected_version:0,reason_code:'initial_mapping'};
    assert.equal((await s.request('POST',`carriers/installations/${iid}/mappings`,body,actor.token,randomUUID(),q)).statusCode,404);
  }
  assert.deepEqual(await s.carrierCounts(),before);
  assert.equal((await s.request('POST',path,{...observationInput(ref),paid:true})).statusCode,422);
  assert.equal((await s.request('POST',path,{...observationInput(ref),reference_id:randomUUID()})).statusCode,404);
  assert.equal((await s.request('POST',path,{...observationInput(ref),expected_parcel_version:2})).statusCode,409);
});

await test('rollback, lost commit acknowledgement, immutable evidence and revoked replay are safe', {timeout:60000},async t=>{
  const s=await carrierSetup(t),iid=(await s.install()).json().id,ref=(await s.link(iid)).json().id;
  const body=observationInput(ref),key=randomUUID(),before=await s.carrierCounts();
  const broken=createCarrierService(paymentFault(s.pool,'INSERT INTO shipit.carrier_commands','before'),s.keys.browser,s.clock);
  await assert.rejects(broken.mutate('observation',s.local.token,s.parcel,key,body,s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await s.carrierCounts(),before);
  const uncertain=createCarrierService(paymentFault(s.pool,'COMMIT'),s.keys.browser,s.clock);
  await assert.rejects(uncertain.mutate('observation',s.local.token,s.parcel,key,body,s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.observe(ref,body,key)).statusCode,201);
  assert.equal((await s.carrierCounts())!.observations,1);
  for(const table of ['carrier_installations','carrier_mappings','carrier_dockets','carrier_references','carrier_observations','carrier_commands']){
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));
  }
  await assert.rejects(s.db.ownerPool().query('DELETE FROM shipit.carrier_observations'));
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});
  assert.equal((await s.observe(ref,body,key)).statusCode,404);
});

await test('mapping review pins history, refuses foreign targets and binds pagination to scope', {timeout:60000},async t=>{
  const s=await carrierSetup(t),iid=(await s.install()).json().id;
  const mapping=(source:string,version=0,target:string|null=null)=>({kind:'service',source_code:source,normalized_id:target,expected_version:version,
    reason_code:version===0?'initial_mapping':'mapping_correction'});
  const path=`carriers/installations/${iid}/mappings`;
  const first=await s.request('POST',path,mapping('STD'));assert.equal(first.statusCode,201,first.body);
  const target=(await s.request('GET',path)).json().items[0].normalized_id;
  const linked=await s.link(iid);assert.equal(linked.statusCode,201,linked.body);
  assert.equal((await s.request('POST',path,mapping('FAST',0,target))).statusCode,201);
  assert.equal((await s.request('POST',path,mapping('STD',1))).statusCode,201);
  const saved=(await s.request('GET',`parcels/${s.parcel}/carriers/references`)).json().items[0];
  assert.equal(saved.dimensions.service.id,target);assert.equal(saved.dimensions.service.mappingVersionId,first.json().id);
  const page=(await s.request('GET',path,undefined,s.local.token,randomUUID(),{...s.q,limit:'1'})).json();
  assert.equal(page.items.length,1);assert.equal(page.page.has_more,true);
  const next=(await s.request('GET',path,undefined,s.local.token,randomUUID(),{...s.q,limit:'1',cursor:page.page.next_cursor})).json();
  assert.notEqual(next.items[0].id,page.items[0].id);
  const second=(await s.install()).json().id;
  const foreignTarget=await s.request('POST',`carriers/installations/${second}/mappings`,mapping('STD',0,target));assert.equal(foreignTarget.statusCode,404);
  assert.equal((await s.request('GET',`carriers/installations/${second}/mappings`,undefined,s.local.token,randomUUID(),{...s.q,limit:'1',cursor:page.page.next_cursor})).statusCode,422);
  // Mapping a real A parcel using a valid B installation must fail before replay/write.
  const actor=await s.grant('franchise_admin',[B]),q={organization_id:org,franchise_id:B};
  const bi=await s.request('POST','carriers/installations',{label:'SYN-B'},actor.token,randomUUID(),q);assert.equal(bi.statusCode,201,bi.body);
  const before=await s.carrierCounts();
  assert.equal((await s.link(bi.json().id)).statusCode,404);
  assert.equal((await s.request('POST',`parcels/${s.parcel}/carriers/references`,referenceInput(bi.json().id),actor.token,randomUUID(),q)).statusCode,404);
  assert.deepEqual(await s.carrierCounts(),before);
  const owner=s.db.ownerPool();
  await assert.rejects(owner.query(`INSERT INTO shipit.carrier_references SELECT (jsonb_populate_record(NULL::shipit.carrier_references,
    to_jsonb(r)||$1::jsonb)).* FROM shipit.carrier_references r`,[JSON.stringify({id:randomUUID(),franchise_id:B})]));
  const malformed=await s.app.inject({method:'POST',url:'/api/v1/carriers/installations?'+new URLSearchParams(s.q),
    headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:'{"label":"A","label":"B"}'});
  assert.equal(malformed.statusCode,400);
  const unavailable=await s.request('POST','carriers/installations',{label:'SYN',courier_id:randomUUID()});assert.equal(unavailable.statusCode,404);
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[A]);
  const disabled=await s.install();assert.equal(disabled.json().error.code,'FRANCHISE_DISABLED');
});
