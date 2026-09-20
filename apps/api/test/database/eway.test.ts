import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ewaySetup, ewayInput } from '../eway-support.ts';
import { org, A, B, C, otherOrg } from '../audit-support.ts';
import { createEwayService } from '../../src/modules/eway/service.ts';
import { paymentFault } from '../payment-support.ts';
import { start } from '../pricing-support.ts';
import { DatabaseError } from '@shippingco/db';

await test('e-way record reload separates official validity and preserves correction history', { timeout: 30000 }, async t => {
  const s = await ewaySetup(t);
  await s.policy();
  const createKey = randomUUID();
  const created = await s.ewayCreate(ewayInput, createKey);
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json(), { booking_id: s.bookingId, record_id: created.json().record_id, version: 1 });
  const replay = await s.ewayCreate(ewayInput, createKey);
  assert.equal(replay.statusCode, 201, replay.body);
  assert.deepEqual(replay.json(), created.json());
  const replayConflict = await s.ewayCreate({ ...ewayInput, distance_km: 54 }, createKey);
  assert.equal(replayConflict.statusCode, 409, replayConflict.body);
  assert.equal(replayConflict.json().error.code, 'IDEMPOTENCY_CONFLICT');

  const first = (await s.request('GET')).json();
  assert.equal(first.record.version, 1);
  assert.equal(first.record.external.official_valid_until, '2099-01-02T00:00:00Z');
  assert.equal(first.record.external.verification_state, 'unverified_external');
  assert.equal(first.state.official_validity_state, 'source_supported');

  const corrected = await s.correct({ expected_version: 1, reason_code: 'metadata_correction', reason_ref: 'SYN_DISTANCE', distance_km: 71 });
  assert.equal(corrected.statusCode, 200, corrected.body);
  const after = (await s.request('GET')).json();
  assert.equal(after.record.version, 2);
  assert.equal(after.record.external.official_valid_until, '2099-01-02T00:00:00Z');
  assert.equal(after.record.distance_km, 71);
  assert.equal(after.record.estimate, null);
  const history = await s.request('GET', '/history');
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().items.length, 2);
  assert.equal(history.json().items[0].distance_km, 53);
  assert.equal(history.json().items[1].distance_km, 71);
  const auditFilter={resource_type:'eway',resource_id:created.json().record_id,franchise_id:A,limit:'1'};
  const auditFirst=await s.list(s.local.token,auditFilter);assert.equal(auditFirst.statusCode,200,auditFirst.body);assert.equal(auditFirst.json().page.has_more,true);
  const auditNext=await s.list(s.local.token,{...auditFilter,cursor:auditFirst.json().page.next_cursor});assert.equal(auditNext.statusCode,200,auditNext.body);assert.equal(auditNext.json().items.length,1);assert.equal(auditNext.json().page.has_more,false);

  const stale = await s.correct({ expected_version: 1, reason_code: 'metadata_correction', reason_ref: 'SYN_STALE', distance_km: 72 });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
});

await test('e-way explicit estimates preserve source validity, saved inputs, actors and exact expiry boundaries', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t); await s.policy(); await s.ewayCreate();
  const body={expected_version:1,reason_ref:'SYN_ESTIMATE',starts_at:start},key=randomUUID();
  const calculated=await s.request('POST','/estimate',body,s.operator.token,s.bookingId,s.q,key);
  assert.equal(calculated.statusCode,200,calculated.body);
  assert.deepEqual((await s.request('POST','/estimate',body,s.operator.token,s.bookingId,s.q,key)).json(),calculated.json());
  const before=(await s.request('GET')).json().record;
  assert.equal(before.estimate.estimated_valid_until,'2099-01-01T00:10:00Z');
  assert.equal(before.estimate.provenance,'shippingco_estimate');
  assert.equal(before.estimate.label,'ShippingCo estimate — verify on the government portal');
  const changed=await s.correct({expected_version:2,reason_code:'metadata_correction',reason_ref:'SYN_DISTANCE',distance_km:71,vehicle_number:'SYN-NEW'});
  assert.equal(changed.statusCode,200,changed.body);
  const after=(await s.request('GET')).json().record;
  assert.deepEqual(after.external,before.external); assert.deepEqual(after.estimate,before.estimate);
  assert.equal(after.captured_by,s.operator.id); assert.equal(after.reason_ref,'SYN_DISTANCE');
  const history=(await s.request('GET','/history')).json().items;
  assert.deepEqual(history.map((r:{version:number})=>r.version),[1,2,3]);
  assert.equal(history[1].distance_km,53); assert.equal(history[2].distance_km,71);
  const again=await s.request('POST','/estimate',{expected_version:3,reason_ref:'SYN_RECALCULATE',starts_at:start});
  assert.equal(again.statusCode,200,again.body);
  const latest=(await s.request('GET')).json().record;
  assert.equal(latest.estimate.estimated_valid_until,'2099-01-01T00:13:20Z'); assert.deepEqual(latest.external,before.external);
  for(const [now,official,estimate] of [
    ['2099-01-01T00:13:19.999Z','source_supported','estimated'],
    ['2099-01-01T00:13:20Z','source_supported','expired'],
    ['2099-01-01T23:59:59.999Z','source_supported','expired'],
    ['2099-01-02T00:00:00Z','expired','expired'],
    ['2099-01-02T00:00:00.001Z','expired','expired'],
  ]) {
    s.setNow(now!);const state=(await s.request('GET')).json().state;
    assert.equal(state.official_validity_state,official);assert.equal(state.estimate_state,estimate);
    assert.equal(state.verification_state,'unverified_external');assert.equal(state.verified_at,null);
  }
});

await test('e-way policy versions affect existing declarations only at effective time without rewriting evidence', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t);await s.ewayCreate();
  const missing=(await s.request('GET')).json();assert.equal(missing.state.policy.state,'no_approved_policy');assert.equal(missing.record.estimate,null);
  const unavailable=await s.request('POST','/estimate',{expected_version:1,reason_ref:'SYN_NO_POLICY',starts_at:start});
  assert.equal(unavailable.json().error.code,'EWAY_ESTIMATE_UNAVAILABLE');
  const v1=await s.policy(),v2=await s.policy(2,'2099-01-01T00:01:00Z',100000);
  const before=await s.db.adminQuery('SELECT * FROM shipit.eway_record_revisions ORDER BY version');
  for(const [now,policy,value] of [[start,v1,'below_threshold'],['2099-01-01T00:00:59.999Z',v1,'below_threshold'],['2099-01-01T00:01:00Z',v2,'threshold_met']]) {
    s.setNow(now!);const result=(await s.request('GET','reminders')).json();assert.equal(result.items.length,1);
    assert.equal(result.items[0].state.value_check_state,value);assert.equal(result.items[0].state.policy.id,policy);
    assert.equal(result.items[0].state.reminder_reasons.includes('value_threshold_met'),value==='threshold_met');
  }
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.eway_record_revisions ORDER BY version')).rows,before.rows);
  assert.equal((await s.request('GET')).json().record.external.official_valid_until,'2099-01-02T00:00:00Z');
  await s.policy(3,'2099-01-01T00:02:00Z',0,false);s.setNow('2099-01-01T00:02:00Z');
  assert.equal((await s.request('GET')).json().state.policy.state,'no_approved_policy');
  assert.equal((await s.request('GET')).json().state.value_check_state,'unknown');
  assert.deepEqual(await s.ewayCounts(),{records:1,revisions:1,commands:1,audits:1});
});

await test('every R15/W23 role is enforced independently with accountant minimum current/history/reminder DTOs', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t);await s.ewayCreate();
  let version=1;
  const actors=[{role:'org_admin',actor:s.admin}];
  for(const role of ['franchise_admin','operator','dispatcher','accountant','delivery_agent','read_only'])actors.push({role,actor:await s.grant(role,[A])});
  for(const {role,actor} of actors){
    const read=!['delivery_agent','read_only'].includes(role),write=['franchise_admin','operator'].includes(role);
    for(const suffix of ['','/history','reminders']){
      const response=await s.request('GET',suffix,undefined,actor.token);
      assert.equal(response.statusCode,read?200:403,role+suffix+response.body);
      if(role==='accountant')for(const key of ['vehicle_number','distance_km','captured_by','reason_code','reason_ref','customer_snapshot','recipient_snapshot','sender_snapshot'])assert.ok(!response.body.includes('"'+key+'"'),key);
    }
    const result=await s.request('PATCH','',{expected_version:version,reason_code:'metadata_correction',reason_ref:'SYN_ROLE',vehicle_number:'SYN-ROLE'},actor.token);
    assert.equal(result.statusCode,write?200:403,role+result.body);if(write)version++;
    const booked=write?await s.book():null;
    if(booked)assert.equal(booked.statusCode,201,booked.body);
    const creation=await s.request('POST','',ewayInput,actor.token,booked?.json().id??s.bookingId);
    assert.equal(creation.statusCode,write?201:403,role+creation.body);
    const estimate=await s.request('POST','/estimate',{expected_version:version,reason_ref:'SYN_ROLE',starts_at:start},actor.token);
    assert.equal(estimate.statusCode,write?409:403,role+estimate.body);
  }
  assert.equal((await s.request('GET')).json().record.version,3);
});

await test('e-way concurrent normalized replay and competing corrections commit exactly once and survive a fresh pool', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t),key=randomUUID();
  const results=await Promise.all([s.ewayCreate(ewayInput,key),s.ewayCreate({...ewayInput,vehicle_number:' syn-123 ',external:{...ewayInput.external,reference:' SYN-REF-1\t'}},key)]);
  results.forEach(r=>assert.equal(r.statusCode,201,r.body));assert.deepEqual(results[0]!.json(),results[1]!.json());
  const correction={expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN_CONCURRENT',distance_km:99};
  const edits=await Promise.all([s.correct(correction),s.correct({...correction,distance_km:100})]);
  assert.deepEqual(edits.map(r=>r.statusCode).sort(),[200,409]);assert.equal(edits.find(r=>r.statusCode===409)!.json().error.code,'VERSION_CONFLICT');
  assert.deepEqual(await s.ewayCounts(),{records:1,revisions:2,commands:2,audits:2});
  const pool=s.db.runtimePool(),restarted=createEwayService(pool,s.keys.browser,s.clock);
  assert.deepEqual(await restarted.mutate('create',s.operator.token,s.bookingId,key,ewayInput,s.q,randomUUID()),results[0]!.json());
  assert.deepEqual(await restarted.read(s.operator.token,s.bookingId,s.q,randomUUID()),(await s.request('GET')).json());
  assert.equal((await restarted.list('history',s.operator.token,s.bookingId,s.q,randomUUID())).items.length,2);
});

await test('e-way rollback and lost COMMIT acknowledgment retain one correction and safe exact retry', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t);await s.ewayCreate();
  const body={expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN_FAULT',distance_km:80},key=randomUUID(),before=await s.ewayCounts();
  const failure=createEwayService(paymentFault(s.pool,'INSERT INTO shipit.eway_commands','before'),s.keys.browser,s.clock);
  await assert.rejects(failure.mutate('correct',s.operator.token,s.bookingId,key,body,s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await s.ewayCounts(),before);assert.equal((await s.request('GET')).json().record.distance_km,53);
  const uncertain=createEwayService(paymentFault(s.pool,'COMMIT'),s.keys.browser,s.clock);
  await assert.rejects(uncertain.mutate('correct',s.operator.token,s.bookingId,key,body,s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await s.ewayCounts(),{records:1,revisions:2,commands:2,audits:2});
  const restarted=createEwayService(s.db.runtimePool(),s.keys.browser,s.clock);
  assert.equal((await restarted.mutate('correct',s.operator.token,s.bookingId,key,body,s.q,randomUUID())).version,2);
  assert.deepEqual(await s.ewayCounts(),{records:1,revisions:2,commands:2,audits:2});
});

await test('e-way replay rechecks revoked membership and disabled organization before disclosure', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t),actor=await s.grant('operator',[A]),key=randomUUID();
  const created=await s.request('POST','',ewayInput,actor.token,s.bookingId,s.q,key);assert.equal(created.statusCode,201,created.body);
  const before=await s.ewayCounts();await s.memberships.revokeMembership(s.admin.token,actor.member.id,{expected_version:1});
  for(const method of ['GET','POST'] as const){const r=await s.request(method,'',method==='POST'?ewayInput:undefined,actor.token,s.bookingId,s.q,key);assert.equal(r.statusCode,404,r.body);assert.ok(!r.body.includes(created.json().record_id));}
  const ownKey=randomUUID(),edit={expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN_DISABLE',distance_km:70};
  assert.equal((await s.correct(edit,ownKey)).statusCode,200);
  await s.db.adminQuery("UPDATE shipit.organizations SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[org]);
  const denied=await s.correct(edit,ownKey);assert.equal(denied.statusCode,409,denied.body);assert.equal(denied.json().error.code,'ORGANIZATION_DISABLED');
  assert.deepEqual(await s.ewayCounts(),{...before,revisions:2,commands:2,audits:2});
});

await test('unknown validity and missing policy remain explicit, and foreign selectors do not disclose records', { timeout: 30000 }, async t => {
  const s = await ewaySetup(t);
  const unknown = await s.ewayCreate({ declaration: { value_paise: 1, source_ref: 'SYN_DECL' }, external: { issuer: 'SYN', reference: 'SYN-UNKNOWN' } });
  assert.equal(unknown.statusCode, 201, unknown.body);
  const state = (await s.request('GET')).json().state;
  assert.equal(state.official_validity_state, 'unknown');
  assert.equal(state.applicability_state, 'unknown');
  assert.equal(state.value_check_state, 'unknown');
  assert.ok(state.reminder_reasons.includes('policy_verification_required'));
  await s.policy();assert.equal((await s.correct({expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN_DISTANCE',distance_km:10})).statusCode,200);
  assert.equal((await s.request('POST','/estimate',{expected_version:2,reason_ref:'SYN_ESTIMATE',starts_at:start})).statusCode,200);
  const estimated=(await s.request('GET')).json();assert.equal(estimated.record.external.official_valid_until,null);
  assert.equal(estimated.state.official_validity_state,'unknown');assert.equal(estimated.state.estimate_state,'estimated');
  assert.equal(estimated.record.external.verification_state,'unverified_external');

  for (const [organization, franchise] of [[org, B], [otherOrg, C], [org, randomUUID()]] as const) {
    const response = await s.request('GET', '', undefined, s.operator.token, s.bookingId, { organization_id: organization, franchise_id: franchise });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error.code, 'RESOURCE_NOT_FOUND');
  }
});

await test('database protects e-way ownership, history, command receipts, and runtime privileges', { timeout: 30000 }, async t => {
  const s = await ewaySetup(t); await s.policy(); await s.ewayCreate();
  const owner = s.db.ownerPool();
  for (const sql of [
    'DELETE FROM shipit.eway_record_revisions', 'TRUNCATE shipit.eway_record_revisions',
    'DELETE FROM shipit.eway_commands', 'TRUNCATE shipit.eway_commands',
    'DELETE FROM shipit.eway_policies', 'TRUNCATE shipit.eway_policies',
    'ALTER TABLE shipit.eway_records DISABLE TRIGGER ALL', 'CREATE TABLE shipit.eway_bypass(id uuid)',
  ]) await assert.rejects(s.pool.query(sql));
  await assert.rejects(owner.query('DELETE FROM shipit.eway_record_revisions'));
  await assert.rejects(owner.query('UPDATE shipit.eway_records SET organization_id=$1', [otherOrg]));
  const audit = (await s.db.adminQuery("SELECT action,resource_type,resource_id,committed_version FROM shipit.audit_history WHERE resource_type='eway' ORDER BY occurred_at")).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.action, 'eway.created');
  assert.equal(audit[0]!.resource_id, (await s.request('GET')).json().record.record_id);
  assert.equal(audit[0]!.committed_version, 1);
  assert.deepEqual((await s.db.adminQuery('SELECT organization_id,franchise_id,booking_id FROM shipit.eway_records')).rows, [{ organization_id: org, franchise_id: A, booking_id: s.bookingId }]);
});

await test('real A1/A2/B1 e-way Booking chains conceal foreign records, history, replay and reminder counts', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t),{draft,input}=await import('../pricing-support.ts'),{taxPolicy,taxFacts}=await import('../tax-support.ts'),{contact}=await import('../customer-support.ts');
  await s.ewayCreate();const orgOnly=await s.grant('org_admin',[]);await s.memberships.bootstrapAdministrator(s.admin.id,otherOrg);
  const errors:unknown[]=[],foreign:string[]=[];
  for(const [organization,franchise] of [[org,B],[otherOrg,C]] as const){
    const admin=await s.grant('franchise_admin',[franchise],organization),operator=await s.grant('operator',[franchise],organization);
    s.setNow('2098-12-31T23:00:00Z');
    const price=await s.pricing.create(admin.token,organization,franchise,randomUUID(),draft,randomUUID());await s.pricing.publish(admin.token,organization,franchise,price.id,randomUUID(),{expected_version:1},randomUUID());
    const policy=await s.tax.create(admin.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());await s.tax.publish(admin.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
    const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID()),quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),input,randomUUID());
    const intent={quote_id:quote.id,pricing_input:input,facts:taxFacts},prepared=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),intent,randomUUID());
    const tax=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:prepared.id},randomUUID());
    const booked=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:tax.id,tax_intent:intent},randomUUID(),operator.token,franchise,organization);assert.equal(booked.statusCode,201,booked.body);
    const booking=booked.json().id as string,q={organization_id:organization,franchise_id:franchise},key=randomUUID();foreign.push(booking);
    const own=await s.request('POST','',{...ewayInput,external:{...ewayInput.external,reference:'SYN_FOREIGN_'+franchise}},operator.token,booking,q,key);assert.equal(own.statusCode,201,own.body);
    const before=await s.ewayCounts();
    for(const target of [booking,randomUUID()])for(const [method,suffix,body] of [
      ['GET','',undefined],['GET','/history',undefined],['POST','',ewayInput],
      ['PATCH','',{expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN_FOREIGN',distance_km:1}],
      ['POST','/estimate',{expected_version:1,reason_ref:'SYN_FOREIGN',starts_at:start}],
    ] as const){
      const r=await s.request(method,suffix,body,s.operator.token,target,s.q,key);assert.equal(r.statusCode,404,r.body);
      const error=r.json().error;delete error.correlation_id;errors.push(error);assert.ok(!r.body.includes(own.json().record_id));
    }
    assert.deepEqual(await s.ewayCounts(),before);
    const selected=await s.request('GET','reminders',undefined,s.operator.token,s.bookingId,q);assert.equal(selected.statusCode,404,selected.body);
    const nested=await s.ewayCreate({...ewayInput,parcel_id:booked.json().parcels[0].id});assert.equal(nested.statusCode,422);
    const owner=s.db.ownerPool();await assert.rejects(owner.query('UPDATE shipit.eway_records SET booking_id=$1,version=version+1 WHERE booking_id=$2',[s.bookingId,booking]));
    const orgRead=await s.request('GET','',undefined,s.admin.token,booking,q);assert.equal(orgRead.statusCode,200,orgRead.body);
    const restricted=await s.request('GET','',undefined,orgOnly.token,booking,q);assert.equal(restricted.statusCode,organization===org?200:404,restricted.body);
    const audit=await s.list(s.local.token,{resource_type:'eway',resource_id:own.json().record_id,franchise_id:A});assert.equal(audit.statusCode,404,audit.body);
  }
  assert.ok(errors.every(e=>JSON.stringify(e)===JSON.stringify(errors[0])));
  const local=(await s.request('GET','reminders',undefined,s.operator.token,s.bookingId,{...s.q,limit:'1'})).json();
  assert.equal(local.items.length,1);assert.equal(local.items[0].booking_id,s.bookingId);assert.deepEqual(local.page,{has_more:false,next_cursor:null});
  for(const id of foreign)assert.ok(!JSON.stringify(local).includes(id));
  assert.deepEqual(await s.ewayCounts(),{records:3,revisions:3,commands:3,audits:3});
});

await test('e-way pagination includes unknown historical values and rejects cursor scope/policy/projection changes', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t);await s.ewayCreate();const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  const missing=(await s.request('GET','',undefined,s.operator.token,booked.json().id)).json();assert.equal(missing.record,null);
  assert.equal(missing.state.reference_state,'missing');assert.ok(missing.state.reminder_reasons.includes('declared_value_unknown'));
  await s.correct();
  const q={...s.q,limit:'1'},first=(await s.request('GET','reminders',undefined,s.operator.token,s.bookingId,q)).json();assert.equal(first.page.has_more,true);
  const page={...q,cursor:first.page.next_cursor},second=(await s.request('GET','reminders',undefined,s.operator.token,s.bookingId,page)).json();
  assert.equal(second.page.has_more,false);assert.notEqual(second.items[0].booking_id,first.items[0].booking_id);
  const accountant=await s.grant('accountant',[A]);assert.equal((await s.request('GET','reminders',undefined,accountant.token,s.bookingId,page)).json().error.code,'CURSOR_INVALID');
  const history=(await s.request('GET','/history',undefined,s.operator.token,s.bookingId,q)).json();
  const next=(await s.request('GET','/history',undefined,s.operator.token,s.bookingId,{...q,cursor:history.page.next_cursor})).json();assert.equal(next.items[0].version,2);assert.equal(next.page.has_more,false);
  assert.equal((await s.request('GET','/history',undefined,s.operator.token,booked.json().id,{...q,cursor:history.page.next_cursor})).json().error.code,'CURSOR_INVALID');
  await s.policy();assert.equal((await s.request('GET','reminders',undefined,s.operator.token,s.bookingId,page)).json().error.code,'CURSOR_INVALID');
});

await test('e-way malformed API input and errors expose no submitted values, secrets or customer PII', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t),marker='SYN_PRIVATE_CREDENTIAL_OTP_123456',key=randomUUID();
  const errors=[];
  for(const body of [{...ewayInput,organization_id:org},{...ewayInput,captured_by:s.operator.id},{...ewayInput,external:{issuer:'SYN',reference:marker+'?secret'}},{...ewayInput,estimate:{official_valid_until:marker}},{...ewayInput,distance_km:1.5}]){
    const r=await s.ewayCreate(body);assert.equal(r.statusCode,422,r.body);assert.ok(!r.body.includes(marker));errors.push(r.json());
  }
  const url='/api/v1/bookings/'+s.bookingId+'/eway?'+new URLSearchParams(s.q);
  const missingKey=await s.app.inject({method:'POST',url,headers:s.headers,cookies:s.cookies(s.operator.token),payload:JSON.stringify(ewayInput)});assert.equal(missingKey.statusCode,422,missingKey.body);
  const duplicateKey=await s.app.inject({method:'POST',url,headers:{...s.headers,'idempotency-key':['same','same']},cookies:s.cookies(s.operator.token),payload:JSON.stringify(ewayInput)});assert.equal(duplicateKey.statusCode,422,duplicateKey.body);
  for(const [payload,status] of [['{"distance_km":9007199254740993}',422],['{"distance_km":1,"distance_km":2}',400]] as const){
    const r=await s.app.inject({method:'POST',url,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload});assert.equal(r.statusCode,status,r.body);
  }
  const created=await s.ewayCreate(ewayInput,key);assert.equal(created.statusCode,201,created.body);
  const responses=await Promise.all(['','/history','reminders'].map(path=>s.request('GET',path)));
  const audit=(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='eway'")).rows,receipts=(await s.db.adminQuery('SELECT * FROM shipit.eway_commands')).rows;
  const evidence=JSON.stringify([responses.map(r=>r.json()),created.json(),errors,audit,receipts,s.logs]);
  for(const value of [marker,s.operator.token,s.headers['x-csrf-token'],key,'21 Fictional Street','+1 202-555-0101','Synthetic Recipient','postgresql://'])assert.ok(!evidence.includes(value),value);
  const safe=JSON.stringify([audit,receipts,s.logs]);for(const value of [ewayInput.external.reference,ewayInput.vehicle_number,ewayInput.external.validity_evidence_ref])assert.ok(!safe.includes(value));
  assert.deepEqual(await s.ewayCounts(),{records:1,revisions:1,commands:1,audits:1});
});

await test('e-way unresolved lock uses controlled in-progress and disabled franchise denies stored replay', { timeout: 30000 }, async t => {
  const s=await ewaySetup(t),key=randomUUID();await s.ewayCreate(ewayInput,key);
  const timeout={...s.pool,async connect(){const connection=await s.pool.connect();return {release:connection.release,async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){if(sql.includes('FOR UPDATE'))throw new DatabaseError('DB_TIMEOUT');return connection.query<Row>(sql,params);}};}};
  const service=createEwayService(timeout,s.keys.browser,s.clock);
  await assert.rejects(service.mutate('create',s.operator.token,s.bookingId,key,ewayInput,s.q,randomUUID()),{code:'IDEMPOTENCY_IN_PROGRESS'});
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[A]);
  const replay=await s.ewayCreate(ewayInput,key);assert.equal(replay.statusCode,409,replay.body);
  assert.deepEqual(await s.ewayCounts(),{records:1,revisions:1,commands:1,audits:1});
});
