import { finalizedManifest } from '../route-support.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError,type DatabasePool } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { createParcelService } from '../../src/modules/parcels/service.ts';
import { startTestDelivery } from '../delivery-support.ts';

type Actor={id:string;token:string};
const body=(version:number,extra:Record<string,unknown>)=>({expected_version:version,evidence_ref:randomUUID(),...extra});
function faulty(pool:DatabasePool,point:string):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    const result=await client.query<Row>(sql,params);if(sql.includes(point))throw new DatabaseError('DB_CONNECTION_FAILED');return result;
  }};}};
}

async function setup(t:Parameters<typeof bookingSetup>[0]) {
  const s=await bookingSetup(t),created=await s.book();assert.equal(created.statusCode,201,created.body);
  await s.db.prepareRoutes();
  const parcel=created.json().parcels[0] as {id:string;booking_id:string;version:number;status:string};
  const post=(path:string,payload:unknown,actor:Actor=s.operator,key=randomUUID(),organization=org,franchise=A)=>s.app.inject({method:'POST',
    url:`/api/v1/parcels/${parcel.id}/${path}?`+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
    headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),payload:JSON.stringify(payload)});
  return {...s,parcel,post};
}

await test('check-in, dispatch and transit commit exact versioned state, event, audit and replay history',{timeout:30000},async t=>{
  const s=await setup(t),key=randomUUID(),checkBody=body(1,{location_ref:randomUUID()});
  const checked=await s.post('check-in',checkBody,s.operator,key);assert.equal(checked.statusCode,200,checked.body);
  assert.deepEqual({version:checked.json().version,status:checked.json().status,custody:checked.json().custody},{version:2,status:'checked_in',custody:'franchise_office'});
  assert.deepEqual((await s.post('check-in',checkBody,s.operator,key)).json(),checked.json());
  const manifest=await finalizedManifest(s.pool,s.keys.browser,s.operator.token,[s.parcel.id]);
  const dispatched=await s.post('dispatch',body(2,{manifest_id:manifest}));assert.equal(dispatched.statusCode,200,dispatched.body);
  const dispatcher=await s.grant('dispatcher',[A]);const transit=await s.post('transit',body(3,{route_id:randomUUID()}),dispatcher);assert.equal(transit.statusCode,200,transit.body);
  assert.deepEqual({version:transit.json().version,status:transit.json().status,custody:transit.json().custody},{version:4,status:'in_transit',custody:'route_dispatch'});
  const timeline=await s.app.inject({url:`/api/v1/parcels/${s.parcel.id}/timeline?`+new URLSearchParams({organization_id:org,franchise_id:A}),cookies:s.cookies(s.operator.token)});
  assert.equal(timeline.statusCode,200,timeline.body);assert.deepEqual(timeline.json().items.map((x:{sequence:number;code:string})=>[x.sequence,x.code]),
    [[1,'parcel.booked'],[2,'parcel.checked_in'],[3,'parcel.dispatched'],[4,'parcel.in_transit']]);
  const counts=(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.parcel_commands) commands,
    (SELECT count(*)::int FROM shipit.parcel_transitions) transitions,
    (SELECT count(*)::int FROM shipit.domain_events WHERE parcel_command_id IS NOT NULL) events,
    (SELECT count(*)::int FROM shipit.audit_history WHERE resource_type='parcel') audits`)).rows[0];
  assert.deepEqual(counts,{commands:3,transitions:3,events:3,audits:3});
});

await test('same-version contenders have one winner; same key replays once and changed intent conflicts',{timeout:30000},async t=>{
  const s=await setup(t),key=randomUUID(),payload=body(1,{location_ref:randomUUID()});
  const raced=await Promise.all([s.post('check-in',payload,s.operator,key),s.post('check-in',payload,s.operator,key)]);
  assert.ok(raced.every(r=>r.statusCode===200));assert.deepEqual(raced[0]!.json(),raced[1]!.json());
  const changed=await s.post('check-in',{...payload,location_ref:randomUUID()},s.operator,key);assert.equal(changed.statusCode,409,changed.body);assert.equal(changed.json().error.code,'IDEMPOTENCY_CONFLICT');
  const manifest=await finalizedManifest(s.pool,s.keys.browser,s.operator.token,[s.parcel.id]);
  const contenders=await Promise.all([s.post('dispatch',body(2,{manifest_id:manifest})),s.post('dispatch',body(2,{manifest_id:manifest}))]);
  assert.deepEqual(contenders.map(r=>r.statusCode).sort(),[200,409]);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.parcel_transitions')).rows[0]!.n,2);
});

await test('failure is agent/attempt-bound, increments once, and two failures permit reasoned RTO',{timeout:30000},async t=>{
  const s=await setup(t),agent=await s.grant('delivery_agent',[A]),started=await startTestDelivery(s,s.parcel.id,agent),attempt1=started.state.attempt_id;
  const key=randomUUID(),failedBody=body(5,{attempt_id:attempt1,reason_code:'customer_unavailable'});
  const failed=await s.post('failed-attempt',failedBody,agent,key);assert.equal(failed.statusCode,200,failed.body);assert.equal(failed.json().failed_attempt_count,1);
  assert.deepEqual((await s.post('failed-attempt',failedBody,agent,key)).json(),failed.json());
  assert.equal((await s.post('failed-attempt',{...failedBody,reason_code:'address_issue'},agent,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  const retryKey=randomUUID(),retry=await started.service.start(started.dispatcher.token,s.parcel.id,{organization_id:org,franchise_id:A},retryKey,['idempotency-key',retryKey],
    {expected_version:6,agent_id:agent.id,handover_evidence_ref:randomUUID()},true,randomUUID()),attempt2=retry.attempt_id;
  const failed2=await s.post('failed-attempt',body(7,{attempt_id:attempt2,reason_code:'address_issue'}),agent);assert.equal(failed2.statusCode,200,failed2.body);assert.equal(failed2.json().failed_attempt_count,2);
  const rto=await s.post('rto',body(8,{approval_ref:randomUUID(),return_plan_ref:randomUUID()}),s.local);assert.equal(rto.statusCode,200,rto.body);assert.equal(rto.json().status,'rto');
  assert.equal((await s.post('check-in',body(9,{location_ref:randomUUID()}))).json().error.code,'PARCEL_STATE_CONFLICT');
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.parcel_failed_attempts')).rows[0]!.n,2);
  assert.equal((await s.db.adminQuery('SELECT mode FROM shipit.parcel_rto_approvals')).rows[0]!.mode,'attempt_limit');
});

await test('early RTO needs a closed privileged reason; controlled failures need a closed subreason',{timeout:30000},async t=>{
  const s=await setup(t),agent=await s.grant('delivery_agent',[A]),started=await startTestDelivery(s,s.parcel.id,agent),attempt=started.state.attempt_id;
  const invalid=await s.post('failed-attempt',body(5,{attempt_id:attempt,reason_code:'other_controlled'}),agent);assert.equal(invalid.statusCode,422,invalid.body);
  const failed=await s.post('failed-attempt',body(5,{attempt_id:attempt,reason_code:'other_controlled',failure_subreason_code:'weather_disruption'}),agent);assert.equal(failed.statusCode,200,failed.body);
  const regular=await s.post('rto',body(6,{approval_ref:randomUUID(),return_plan_ref:randomUUID()}),s.local);assert.equal(regular.statusCode,409,regular.body);assert.equal(regular.json().error.code,'RTO_NOT_ELIGIBLE');
  const override=await s.post('rto',body(6,{approval_ref:randomUUID(),return_plan_ref:randomUUID(),override_reason_code:'safety_risk'}),s.local);assert.equal(override.statusCode,200,override.body);
  const row=(await s.db.adminQuery('SELECT mode,override_reason_code FROM shipit.parcel_rto_approvals')).rows[0];assert.deepEqual(row,{mode:'privileged_override',override_reason_code:'safety_risk'});
});

await test('foreign parcels, wrong roles, generic status writes and stale versions fail without mutation',{timeout:30000},async t=>{
  const s=await setup(t),sibling=await s.grant('operator',[B]),foreign=await s.beta('operator'),unknown=randomUUID();
  const errors:Array<Record<string,unknown>>=[];
  for(const [actor,organization,franchise,id] of [[sibling,org,B,s.parcel.id],[sibling,org,B,unknown],[foreign,otherOrg,C,s.parcel.id],[foreign,otherOrg,C,unknown]] as const){
    const response=await s.app.inject({method:'POST',url:`/api/v1/parcels/${id}/check-in?`+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
      headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(actor.token),payload:JSON.stringify(body(1,{location_ref:randomUUID()}))});
    assert.equal(response.statusCode,404,response.body);const error=response.json().error;delete error.correlation_id;errors.push(error);
  }
  assert.ok(errors.every(e=>JSON.stringify(e)===JSON.stringify(errors[0])));
  for(const actor of [s.local,s.admin,await s.grant('read_only',[A]),await s.grant('dispatcher',[A]),await s.grant('delivery_agent',[A])])assert.equal((await s.post('check-in',body(1,{location_ref:randomUUID()}),actor)).statusCode,403);
  assert.equal((await s.post('check-in',body(2,{location_ref:randomUUID()}))).json().error.code,'VERSION_CONFLICT');
  const patch=await s.app.inject({method:'PATCH',url:`/api/v1/parcels/${s.parcel.id}?`+new URLSearchParams({organization_id:org,franchise_id:A}),
    headers:s.headers,cookies:s.cookies(s.operator.token),payload:JSON.stringify({status:'delivered'})});assert.equal(patch.statusCode,404,patch.body);
  assert.equal((await s.db.adminQuery('SELECT version FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0]!.version,1);
});

await test('fault after state/history work rolls back atomically and a fresh service safely retries',{timeout:30000},async t=>{
  const s=await setup(t),key=randomUUID(),payload=body(1,{location_ref:randomUUID()});
  const broken=createParcelService(faulty(s.pool,'INSERT INTO shipit.domain_events'),s.clock);
  await assert.rejects(broken.execute(s.operator.token,s.parcel.id,{organization_id:org,franchise_id:A},key,['idempotency-key',key],payload,'parcels.check_in',randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  const before=(await s.db.adminQuery(`SELECT p.version,p.status,(SELECT count(*)::int FROM shipit.parcel_commands) commands,
    (SELECT count(*)::int FROM shipit.parcel_transitions) transitions FROM shipit.parcels p WHERE p.id=$1`,[s.parcel.id])).rows[0];
  assert.deepEqual(before,{version:1,status:'booked',commands:0,transitions:0});
  const restarted=createParcelService(s.db.runtimePool(),s.clock);const result=await restarted.execute(s.operator.token,s.parcel.id,
    {organization_id:org,franchise_id:A},key,['idempotency-key',key],payload,'parcels.check_in',randomUUID());assert.equal(result.status,'checked_in');assert.equal(result.version,2);
});

await test('database grants and triggers deny direct aggregate and append-only history mutation',{timeout:30000},async t=>{
  const s=await setup(t),result=await s.post('check-in',body(1,{location_ref:randomUUID()}));assert.equal(result.statusCode,200,result.body);
  await assert.rejects(s.pool.query(`UPDATE shipit.parcels SET status='delivered',custody='recipient',version=version+1,
    last_command_id=NULL WHERE id=$1`,[s.parcel.id]));
  await assert.rejects(s.db.ownerPool().query(`UPDATE shipit.parcels SET status='delivered',custody='recipient',version=version+1,
    last_command_id=NULL WHERE id=$1`,[s.parcel.id]));
  for(const table of ['parcel_commands','parcel_transitions','parcel_failed_attempts','parcel_rto_approvals']){
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));
    await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
  }
  await assert.rejects(s.db.ownerPool().query('UPDATE shipit.parcel_transitions SET reason_code=reason_code'));
  const row=(await s.db.adminQuery('SELECT version,status,custody FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0];
  assert.deepEqual(row,{version:2,status:'checked_in',custody:'franchise_office'});
});
