import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentSetup,paymentFault} from '../payment-support.ts';
import {org,A,B,C,otherOrg} from '../audit-support.ts';
import {startTestDelivery,testDeliveryCode} from '../delivery-support.ts';
import {createPerformanceService} from '../../src/modules/reports/performance-service.ts';
import type {PerformancePage} from '@shippingco/shared';
async function setup(t:Parameters<typeof paymentSetup>[0]) {
  const s=await paymentSetup(t);await s.db.prepareReports();await s.db.prepareRoutes();await s.db.prepareDeliveries();
  const date=new Date(Date.parse(s.booked.charges.confirmed_at)+19800000).toISOString().slice(0,10),filter={from_day:date,to_day:date,eta:'original'};
  const q={organization_id:org,franchise_id:A};
  const report=(method:'POST'|'GET',path='',body:unknown=filter,actor:{id:string;token:string}=s.local,key=randomUUID(),query:Record<string,string>=q)=>s.app.inject({method,
    url:'/api/v1/reports/performance'+path+'?'+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(method==='POST'?{payload:JSON.stringify(body)}:{})});
  return {...s,filter,q,report};
}
await test('performance uses real delivery proof, immutable reload/replay and matching destination/route exports',{timeout:60000},async t=>{
  const s=await setup(t),key=randomUUID(),before=await s.report('POST','',s.filter,s.operator,key);assert.equal(before.statusCode,200,before.body);
  const initial=before.json<PerformancePage>();assert.equal(initial.snapshot.count,2);assert.equal(initial.snapshot.summary.open,2);
  const agent=await s.grant('delivery_agent',[A]),parcel=s.booked.parcels[0].id;
  const started=await startTestDelivery(s,parcel,agent),code=await testDeliveryCode(s,parcel),completionKey=randomUUID();
  await started.service.complete(agent.token,parcel,s.q,completionKey,['idempotency-key',completionKey],
    {expected_version:5,challenge_ref:started.state.challenge_ref,challenge_version:started.state.challenge_version,proof:code},false,randomUUID());
  const fresh=(await s.report('POST')).json<PerformancePage>();assert.equal(fresh.snapshot.count,2);
  assert.deepEqual(fresh.snapshot.summary.on_time,{numerator:0,denominator:0,excluded:1});
  assert.equal(fresh.snapshot.summary.delivered,1);assert.equal(fresh.snapshot.summary.dispatched,1);assert.equal(fresh.snapshot.summary.open,1);
  assert.equal(fresh.snapshot.summary.duration.denominator,1);
  const delivered=fresh.rows.find(r=>r.id===parcel)!;assert.ok(delivered.delivered_at);assert.ok(delivered.route_id);assert.equal(delivered.courier,'SYN-27');
  assert.equal(delivered.original_eta_at,null);assert.equal(delivered.outcome,'unknown');
  const restarted=createPerformanceService(s.db.runtimePool());assert.deepEqual(await restarted.read(s.operator.token,initial.snapshot.id,s.q,randomUUID()),initial);
  assert.deepEqual((await s.report('POST','',s.filter,s.operator,key)).json(),initial);
  assert.equal((await s.report('POST','',{...s.filter,eta:'revised'},s.operator,key)).statusCode,409);
  const routeQuery={...s.q,route_id:delivered.route_id!};
  const detail=await s.report('GET','/'+fresh.snapshot.id,undefined,s.local,randomUUID(),routeQuery);assert.equal(detail.statusCode,200,detail.body);
  assert.equal(detail.json<PerformancePage>().selection.count,1);assert.equal(detail.json<PerformancePage>().selection.summary.delivered,1);
  const exported=await s.report('GET','/'+fresh.snapshot.id+'/export',undefined,s.local,randomUUID(),routeQuery);assert.equal(exported.statusCode,200,exported.body);
  assert.deepEqual(exported.json().selection,detail.json().selection);assert.equal(exported.json().csv.split('\r\n').length,3);
  assert.equal(fresh.snapshot.destinations.reduce((n,g)=>n+g.summary.booked,0),fresh.snapshot.count);
  assert.equal(fresh.snapshot.routes.reduce((n,g)=>n+g.summary.booked,0),fresh.snapshot.count);
  const destination=fresh.rows[0]!.destination!;
  assert.equal((await s.report('GET','/'+fresh.snapshot.id,undefined,s.local,randomUUID(),{...s.q,destination})).json().selection.count,2);
  const safe=JSON.stringify({fresh,logs:s.logs,csv:exported.json().csv});
  for(const forbidden of [code,s.local.token,s.booked.customer.phone,s.booked.customer.address,'Synthetic Recipient'])assert.ok(!safe.includes(forbidden));
});
await test('R26 readers and E04 exports deny financial-only/assignment-only grants, foreign IDs and revocation',{timeout:60000},async t=>{
  const s=await setup(t),snapshot=(await s.report('POST')).json<PerformancePage>(),id=snapshot.snapshot.id;
  for(const role of ['operator','dispatcher','read_only'] as const){const actor=await s.grant(role,[A]);assert.equal((await s.report('POST','',s.filter,actor)).statusCode,200);assert.equal((await s.report('GET','/'+id+'/export',undefined,actor)).statusCode,403);}
  for(const role of ['accountant','delivery_agent'] as const){const actor=await s.grant(role,[A]);assert.equal((await s.report('POST','',s.filter,actor)).statusCode,403);}
  const orgReport=await s.report('POST','',s.filter,s.admin);assert.equal(orgReport.statusCode,200,orgReport.body);assert.equal((await s.report('GET','/'+orgReport.json().snapshot.id+'/export',undefined,s.admin)).statusCode,403);
  for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}]){
    const known=await s.report('GET','/'+id,undefined,s.local,randomUUID(),query),unknown=await s.report('GET','/'+randomUUID(),undefined,s.local,randomUUID(),query);
    assert.equal(known.statusCode,404);assert.equal(known.json().error.code,unknown.json().error.code);
  }
  assert.equal((await s.report('GET','/'+id,undefined,s.local,randomUUID(),{...s.q,route_id:randomUUID()})).statusCode,404);
  await s.db.adminQuery("UPDATE shipit.memberships SET lifecycle='revoked',version=version+1,revoked_at=clock_timestamp() WHERE user_id=$1 AND role='franchise_admin'",[s.local.id]);
  assert.notEqual((await s.report('GET','/'+id+'/export')).statusCode,200);
});
await test('performance capture bounds malformed dates, concurrent replay and before-commit failure without partial snapshots',{timeout:60000},async t=>{
  const s=await setup(t),empty={from_day:'2000-01-01',to_day:'2000-01-01'},key=randomUUID();
  const responses=await Promise.all([s.report('POST','',empty,s.local,key),s.report('POST','',empty,s.local,key)]);
  responses.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.deepEqual(responses[0]!.json(),responses[1]!.json());
  const p=responses[0]!.json<PerformancePage>();assert.equal(p.snapshot.count,0);assert.equal(p.selection.summary.on_time.denominator,0);
  const exported=await s.report('GET','/'+p.snapshot.id+'/export');assert.equal(exported.json().csv.split('\r\n').length,2);
  for(const body of [{...empty,from_day:'2026-02-30'},{...empty,franchise_id:B},{...empty,to_day:'2001-01-01'}])assert.equal((await s.report('POST','',body)).statusCode,422);
  const failing=createPerformanceService(paymentFault(s.pool,'INSERT INTO shipit.report_access_events','before')),failedKey=randomUUID();
  await assert.rejects(failing.create(s.local.token,s.q,failedKey,['Idempotency-Key',failedKey],s.filter,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,1);
});

await test('route ETA versions and actual events preserve a two-parcel cohort across Lot/direct overlap',{timeout:60000},async t=>{
  const s=await setup(t),dispatcher=await s.grant('dispatcher',[A]);
  const post=async(path:string,body:unknown,actor=s.operator)=>{
    const response=await s.app.inject({method:'POST',url:'/api/v1/'+path+'?'+new URLSearchParams(s.q),headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(actor.token),payload:JSON.stringify(body)});
    assert.ok(response.statusCode===200||response.statusCode===201,response.body);return response.json();
  };
  const ids=s.booked.parcels.map((p:{id:string})=>p.id);
  for(const id of ids)await post(`parcels/${id}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()});
  const lot=await post('lots',{name:'Performance overlap',destination_key:'SYN_DEST'});
  await post(`lots/${lot.id}/parcels`,{expected_version:1,parcel_id:ids[0]});
  let route=await post('routes',{origin:'Synthetic Origin',destination:'Synthetic Destination',mode:'road',carrier_code:'SYN-64',scheduled_departure_at:'2099-01-01T03:30:00Z'});
  route=await post(`routes/${route.id}/lots`,{expected_version:route.version,lot_id:lot.id});
  for(const parcel_id of ids)route=await post(`routes/${route.id}/parcels`,{expected_version:route.version,parcel_id});
  route=await post(`routes/${route.id}/finalize`,{expected_version:route.version});
  for(const id of ids)await post(`parcels/${id}/dispatch`,{expected_version:2,manifest_id:route.current_manifest_id,evidence_ref:randomUUID()});
  const before=(await s.report('POST')).json<PerformancePage>();
  assert.equal(before.snapshot.count,2);assert.ok(before.rows.every(r=>r.route_departed_at===null&&r.original_eta_at===null));
  const event={manifest_id:route.current_manifest_id,manifest_version:route.version,evidence_ref:randomUUID()};
  const departed=await post(`routes/${route.id}/events`,{...event,kind:'departure',expected_version:route.version,effective_at:'2099-01-01T04:00:00Z',base_eta_at:'2099-01-01T12:00:00Z'},dispatcher);
  const delayed=await post(`routes/${route.id}/events`,{...event,kind:'delay',expected_version:departed.version,effective_at:'2099-01-01T05:00:00Z',total_delay_minutes:120});
  const delayedReport=(await s.report('POST')).json<PerformancePage>();
  assert.equal(delayedReport.snapshot.count,2);assert.equal(delayedReport.snapshot.routes.length,1);
  assert.deepEqual(delayedReport.snapshot.summary.on_time,{numerator:0,denominator:0,excluded:0});
  for(const r of delayedReport.rows){
    assert.equal(r.original_eta_at,'2099-01-01T12:00:00.000Z');assert.equal(r.revised_eta_at,'2099-01-01T14:00:00.000Z');
    assert.equal(r.original_eta_version,departed.version);assert.equal(r.revised_eta_version,delayed.version);
    assert.equal(r.route_departed_at,'2099-01-01T04:00:00.000Z');assert.equal(r.route_arrived_at,null);assert.equal(r.courier,'SYN-64');
  }
  await post(`routes/${route.id}/events`,{...event,kind:'arrival',expected_version:delayed.version,effective_at:'2099-01-01T14:30:00Z'},dispatcher);
  const arrived=(await s.report('POST')).json<PerformancePage>();assert.equal(arrived.snapshot.summary.delivered,0);assert.equal(arrived.snapshot.summary.open,2);
  assert.ok(arrived.rows.every(r=>r.route_arrived_at==='2099-01-01T14:30:00.000Z'&&r.delivered_at===null&&r.revised_eta_at===null));
  assert.deepEqual((await s.report('GET','/'+delayedReport.snapshot.id)).json(),delayedReport);
});

await test('booking cohorts include Kolkata midnight exactly and exclude both adjacent days',{timeout:60000},async t=>{
  const s=await setup(t),ids:string[]=[];
  for(let n=0;n<4;n++){const response=await s.book();assert.equal(response.statusCode,201,response.body);ids.push(response.json().id);}
  const owner=s.db.ownerPool(),connection=await owner.connect();
  try{
    await connection.query('BEGIN');
    // Query-only fictional fixture: runtime cannot edit immutable booking times.
    await connection.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');
    for(const [index,instant] of ['2001-09-30T18:29:59.999Z','2001-09-30T18:30:00Z','2001-10-01T18:29:59.999Z','2001-10-01T18:30:00Z'].entries())
      await connection.query('UPDATE shipit.bookings SET confirmed_at=$2 WHERE id=$1',[ids[index],instant]);
    await connection.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');await connection.query('COMMIT');
  }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();await owner.close();}
  const response=await s.report('POST','',{from_day:'2001-10-01',to_day:'2001-10-01'});assert.equal(response.statusCode,200,response.body);
  const page=response.json<PerformancePage>();assert.equal(page.snapshot.count,2);
  assert.deepEqual(page.rows.map(r=>r.booking_id).sort(),[ids[1],ids[2]].sort());
  assert.equal(page.snapshot.summary.open,2);assert.equal(page.snapshot.summary.delivered,0);
});
