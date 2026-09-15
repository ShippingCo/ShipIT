import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError,type DatabasePool } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { routeMetadata,legacyDispatch } from '../route-support.ts';
import { createRouteEventService } from '../../src/modules/routes/event-service.ts';
import type { RouteEventResult } from '../../src/modules/routes/event-types.ts';
type Actor={id:string;token:string};
function fault(pool:DatabasePool,point:string,omit=false):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    if(omit&&sql.includes(point))return {rows:[],rowCount:0,command:'SELECT',oid:0,fields:[]};
    const result=await client.query<Row>(sql,params);if(sql.includes(point))throw new DatabaseError('DB_CONNECTION_FAILED');return result;
  }};}};
}
async function setup(t:Parameters<typeof bookingSetup>[0],overlap=false) {
  const s=await bookingSetup(t);await s.db.prepareRoutes();
  const dispatcher=await s.grant('dispatcher',[A]);
  const request=(method:'POST'|'GET',path:string,body?:unknown,actor:Actor=s.operator,key=randomUUID(),organization=org,franchise=A)=>s.app.inject({method,
    url:'/api/v1/'+path+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),headers:{...s.headers,'idempotency-key':key},
    cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
  const ids:string[]=[];
  for(let i=0;i<2;i++){
    const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);const id=booked.json().parcels[0].id as string;ids.push(id);
    const check=await request('POST',`parcels/${id}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()});assert.equal(check.statusCode,200,check.body);
  }
  const created=await request('POST','routes',routeMetadata);assert.equal(created.statusCode,201,created.body);let route=created.json();
  const mutate=async(path:string,b:Record<string,unknown>)=>{const r=await request('POST',`routes/${route.id}/${path}`,{expected_version:route.version,...b});assert.equal(r.statusCode,200,r.body);route=r.json();};
  if(overlap){
    const l=await request('POST','lots',{name:'Synthetic route event lot',destination_key:'SYN_DEST'});assert.equal(l.statusCode,201,l.body);
    const member=await request('POST',`lots/${l.json().id}/parcels`,{expected_version:1,parcel_id:ids[0]});assert.equal(member.statusCode,200,member.body);
    await mutate('lots',{lot_id:l.json().id});
  }
  for(const id of ids)await mutate('parcels',{parcel_id:id});await mutate('finalize',{});
  for(const id of ids){const r=await request('POST',`parcels/${id}/dispatch`,{expected_version:2,manifest_id:route.current_manifest_id,evidence_ref:randomUUID()});assert.equal(r.statusCode,200,r.body);}
  const input={kind:'departure',expected_version:route.version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T04:00:00Z',evidence_ref:randomUUID(),base_eta_at:'2099-01-01T12:00:00Z'};
  const post=(body:unknown=input,actor:Actor=dispatcher,key=randomUUID())=>request('POST',`routes/${route.id}/events`,body,actor,key);
  const delay=(version:number,minutes=120)=>({kind:'delay',expected_version:version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T05:00:00Z',evidence_ref:randomUUID(),total_delay_minutes:minutes});
  const counts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.route_commands) commands,
    (SELECT count(*)::int FROM shipit.route_parcel_effects) effects,(SELECT count(*)::int FROM shipit.domain_events) events,
    (SELECT count(*)::int FROM shipit.parcel_transitions) transitions,(SELECT count(*)::int FROM shipit.route_audit_events) audits`)).rows[0];
  return {...s,request,route,ids,input,post,delay,counts,dispatcher};
}
await test('route departure and duplicate absolute delay atomically deduplicate Lot/direct overlap and survive restart',{timeout:30000},async t=>{
  const s=await setup(t,true),key=randomUUID();
  const departed=await s.post(s.input,s.dispatcher,key);assert.equal(departed.statusCode,200,departed.body);
  const result=departed.json<RouteEventResult>();assert.equal(result.updated_count,2);assert.equal(result.skipped_count,0);
  assert.equal(result.eta.revised_at,'2099-01-01T12:00:00Z');
  const statuses=(await s.db.adminQuery('SELECT status,version FROM shipit.parcels')).rows;assert.ok(statuses.every(p=>p.status==='in_transit'&&p.version===4));
  const before=await s.counts();assert.deepEqual((await s.post(s.input,s.dispatcher,key)).json(),result);assert.deepEqual(await s.counts(),before);
  const d=s.delay(result.version),dk=randomUUID();const delayed=await s.post(d,s.operator,dk);assert.equal(delayed.statusCode,200,delayed.body);
  assert.equal(delayed.json().eta.revised_at,'2099-01-01T14:00:00Z');const after=await s.counts();
  const fresh=createRouteEventService(s.db.runtimePool());assert.deepEqual(await fresh.execute(s.operator.token,s.route.id,{organization_id:org,franchise_id:A},dk,['idempotency-key',dk],d,randomUUID()),delayed.json());
  assert.deepEqual(await s.counts(),after);
  assert.equal((await s.post({...d,total_delay_minutes:121},s.operator,dk)).json().error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await s.post(d)).json().error.code,'VERSION_CONFLICT');
  const repeated=await s.post({...d,expected_version:delayed.json().version,effective_at:'2099-01-01T06:00:00Z'});assert.equal(repeated.statusCode,200,repeated.body);
  assert.equal(repeated.json().eta.revised_at,'2099-01-01T14:00:00Z');
  const rows=(await s.db.adminQuery('SELECT event_id,count(*)::int n FROM shipit.route_parcel_effects GROUP BY event_id')).rows;assert.ok(rows.every(r=>r.n===2));
  const read=await s.request('GET',`routes/${s.route.id}/events`);assert.deepEqual(read.json().latest,repeated.json());
  const detail=await s.request('GET',`routes/${s.route.id}/events/${result.event_id}`);assert.equal(detail.statusCode,200,detail.body);
  assert.equal(detail.json().items.length,2);assert.ok(detail.json().items.every((p:{parcel_event_id:string})=>p.parcel_event_id));
  assert.ok(!/Synthetic Recipient|Fictional Street|phone|key_digest|fingerprint/.test(detail.body));
  await s.memberships.updateMembership(s.admin.token,s.dispatcher.member.id,{expected_version:1,role:'operator',franchise_ids:[A]});
  const beforeRevokedReplay=await s.counts();assert.equal((await s.post(s.input,s.dispatcher,key)).json().error.code,'ACTION_FORBIDDEN');
  assert.deepEqual(await s.counts(),beforeRevokedReplay);
});
await test('delivered and RTO members receive skipped evidence without status or active ETA mutation',{timeout:30000},async t=>{
  const s=await setup(t);const departure=await s.post();assert.equal(departure.statusCode,200,departure.body);
  // Synthetic downstream terminal states only; production delivery proof remains #42.
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='delivered',custody='recipient' WHERE id=$1",[s.ids[0]]);
  await s.db.adminQuery("UPDATE shipit.parcels SET status='rto' WHERE id=$1",[s.ids[1]]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const before=(await s.db.adminQuery('SELECT id,status,version,updated_at FROM shipit.parcels ORDER BY id')).rows;
  const delayed=await s.post(s.delay(departure.json().version));assert.equal(delayed.statusCode,200,delayed.body);
  assert.equal(delayed.json().updated_count,0);assert.equal(delayed.json().skipped_count,2);
  assert.deepEqual((await s.db.adminQuery('SELECT id,status,version,updated_at FROM shipit.parcels ORDER BY id')).rows,before);
  const detail=await s.request('GET',`routes/${s.route.id}/events/${delayed.json().event_id}`);
  assert.ok(detail.json().items.every((p:{outcome:string;skip_reason:string;revised_eta_at:null})=>p.outcome==='skipped'&&p.skip_reason==='terminal'&&p.revised_eta_at===null));
  await assert.rejects(s.pool.query('UPDATE shipit.route_parcel_effects SET outcome=$1',['updated']));
  await assert.rejects(s.db.adminQuery('DELETE FROM shipit.route_parcel_effects'));
});
await test('W18 cannot bypass dispatcher T04, and foreign manifests/scopes and read-only fail without effects',{timeout:30000},async t=>{
  const s=await setup(t),before=await s.counts();
  for(const actor of [s.operator,s.local,await s.grant('read_only',[A]),await s.grant('accountant',[A])])assert.equal((await s.post(s.input,actor)).json().error.code,'ACTION_FORBIDDEN');
  for(const [o,f] of [[org,B],[otherOrg,C]]){
    const r=await s.request('POST',`routes/${s.route.id}/events`,s.input,s.dispatcher,randomUUID(),o,f);assert.equal(r.statusCode,404,r.body);
  }
  const foreign=await s.post({...s.input,manifest_id:randomUUID(),expected_version:1});assert.equal(foreign.json().error.code,'RESOURCE_NOT_FOUND');
  assert.deepEqual(await s.counts(),before);
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='checked_in',custody='franchise_office' WHERE id=$1",[s.ids[0]]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  assert.equal((await s.post()).json().error.code,'PARCEL_STATE_CONFLICT');
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='dispatched',custody='route_dispatch' WHERE id=$1",[s.ids[0]]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  await s.memberships.bootstrapAdministrator(s.admin.id,otherOrg);
  for(const [o,f] of [[org,B],[otherOrg,C]]){
    const actor=await s.grant('operator',[f!],o!);
    const r=await s.request('POST','routes',routeMetadata,actor,randomUUID(),o,f);assert.equal(r.statusCode,201,r.body);
    const baseline=await s.counts();
    assert.equal((await s.post({...s.input,manifest_id:r.json().current_manifest_id,expected_version:1})).json().error.code,'RESOURCE_NOT_FOUND');
    assert.equal((await s.request('POST',`routes/${r.json().id}/events`,s.input,s.dispatcher)).json().error.code,'RESOURCE_NOT_FOUND');
    assert.equal((await s.request('GET',`routes/${r.json().id}/events`)).json().error.code,'RESOURCE_NOT_FOUND');
    assert.deepEqual(await s.counts(),baseline);
  }
});
await test('stale effective events cannot regress Route or ETA; arrival never claims delivery',{timeout:30000},async t=>{
  const s=await setup(t);const first=await s.post();assert.equal(first.statusCode,200,first.body);
  const d=s.delay(first.json().version);const delayed=await s.post(d);assert.equal(delayed.statusCode,200,delayed.body);
  const before=await s.counts();
  for(const body of [{...d,expected_version:delayed.json().version,effective_at:'2099-01-01T03:00:00Z'},
    {...d,expected_version:delayed.json().version,effective_at:'2099-01-01T06:00:00Z',total_delay_minutes:60}])assert.equal((await s.post(body)).json().error.code,'VERSION_CONFLICT');
  assert.deepEqual(await s.counts(),before);
  const {total_delay_minutes:minutes,...arrival}=d;assert.equal(minutes,120);
  const r=await s.post({...arrival,kind:'arrival',expected_version:delayed.json().version,effective_at:'2099-01-01T14:00:00Z'});assert.equal(r.statusCode,200,r.body);
  assert.equal(r.json().eta.state,'arrived');assert.equal(r.json().eta.revised_at,null);
  assert.ok((await s.db.adminQuery('SELECT status FROM shipit.parcels')).rows.every(p=>p.status==='in_transit'));
  assert.equal((await s.post({...d,expected_version:r.json().version,effective_at:'2099-01-01T15:00:00Z'})).json().error.code,'ROUTE_STATE_CONFLICT');
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='checked_in',custody='franchise_office' WHERE id=$1",[s.ids[0]]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const late={expected_version:4,manifest_id:s.route.current_manifest_id,evidence_ref:randomUUID()};
  assert.equal((await s.request('POST',`parcels/${s.ids[0]}/dispatch`,late)).json().error.code,'PARCEL_STATE_CONFLICT');
  await assert.rejects(legacyDispatch(s.pool,s.operator.token,s.ids[0]!,randomUUID(),late),{code:'TEMPORARILY_UNAVAILABLE'});
});
await test('missing ETA remains unavailable after delay and two concurrent same-key events have one effect',{timeout:30000},async t=>{
  const s=await setup(t),input={...s.input,base_eta_at:null},key=randomUUID();
  const [a,b]=await Promise.all([s.post(input,s.dispatcher,key),s.post(input,s.dispatcher,key)]);assert.equal(a.statusCode,200,a.body);assert.equal(b.statusCode,200,b.body);assert.deepEqual(a.json(),b.json());
  const delayed=await s.post(s.delay(a.json().version));assert.equal(delayed.statusCode,200,delayed.body);assert.deepEqual(delayed.json().eta,{state:'unavailable',base_at:null,revised_at:null,total_delay_minutes:120});
  assert.equal((await s.counts())!.effects,4);
});
await test('failure after the first Parcel rolls back state, receipts, effects, audit and events, then retry succeeds',{timeout:30000},async t=>{
  const s=await setup(t),before=await s.counts();
  await s.db.adminQuery(`CREATE FUNCTION shipit.synthetic_route_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM shipit.route_parcel_effects WHERE command_id=NEW.command_id) THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_route_failure BEFORE INSERT ON shipit.route_parcel_effects FOR EACH ROW EXECUTE FUNCTION shipit.synthetic_route_failure()`);
  const key=randomUUID(),r=await s.post(s.input,s.dispatcher,key);assert.equal(r.statusCode,503,r.body);assert.deepEqual(await s.counts(),before);
  assert.ok((await s.db.adminQuery('SELECT status FROM shipit.parcels')).rows.every(p=>p.status==='dispatched'));
  await s.db.adminQuery('DROP TRIGGER synthetic_route_failure ON shipit.route_parcel_effects');const ok=await s.post(s.input,s.dispatcher,key);assert.equal(ok.statusCode,200,ok.body);
  const d=s.delay(ok.json().version),query={organization_id:org,franchise_id:A},baseline=await s.counts();
  for(const point of ['INSERT INTO shipit.route_parcel_effects','SELECT shipit.append_route_audit','INSERT INTO shipit.domain_events','UPDATE shipit.route_commands']){
    const k=randomUUID();await assert.rejects(createRouteEventService(fault(s.pool,point,true)).execute(s.operator.token,s.route.id,query,k,['idempotency-key',k],d,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.deepEqual(await s.counts(),baseline);
  }
  const lostKey=randomUUID();await assert.rejects(createRouteEventService(fault(s.pool,'COMMIT')).execute(s.operator.token,s.route.id,query,lostKey,['idempotency-key',lostKey],d,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  const committed=await s.counts();const recovered=await createRouteEventService(s.db.runtimePool()).execute(s.operator.token,s.route.id,query,lostKey,['idempotency-key',lostKey],d,randomUUID());
  assert.equal(recovered.eta.revised_at,'2099-01-01T14:00:00Z');assert.deepEqual(await s.counts(),committed);
});
await test('1000-Parcel frozen manifest bounds atomic departure and delay work',{timeout:60000},async t=>{
  const s=await setup(t),ids:string[]=[];
  for(let i=0;i<20;i++){
    const b=await s.book({...s.body,parcels:Array.from({length:50},(_,j)=>({...s.body.parcels[0],weight_grams:j===49?950:1}))});
    assert.equal(b.statusCode,201,b.body);ids.push(...b.json().parcels.map((p:{id:string})=>p.id));
  }
  const lot=await s.request('POST','lots',{name:'Synthetic capacity lot',destination_key:'SYN_DEST'});assert.equal(lot.statusCode,201,lot.body);
  // Build only prerequisite fixture states through the owner; all #28 guards stay on.
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships DISABLE TRIGGER lot_memberships_guard');
  await s.db.adminQuery(`INSERT INTO shipit.lot_memberships(id,organization_id,franchise_id,lot_id,booking_id,parcel_id,started_at,start_command_id)
    SELECT gen_random_uuid(),p.organization_id,p.franchise_id,l.id,p.booking_id,p.id,clock_timestamp(),l.last_command_id
    FROM shipit.parcels p JOIN shipit.lots l ON l.organization_id=p.organization_id AND l.franchise_id=p.franchise_id
    WHERE l.id=$1 AND p.id=ANY($2::uuid[])`,[lot.json().id,ids]);
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships ENABLE TRIGGER lot_memberships_guard');
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='checked_in',custody='franchise_office' WHERE id=ANY($1::uuid[])",[ids]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  let r=await s.request('POST','routes',routeMetadata);assert.equal(r.statusCode,201,r.body);let route=r.json();
  r=await s.request('POST',`routes/${route.id}/lots`,{expected_version:route.version,lot_id:lot.json().id});assert.equal(r.statusCode,200,r.body);route=r.json();
  r=await s.request('POST',`routes/${route.id}/finalize`,{expected_version:route.version});assert.equal(r.statusCode,200,r.body);route=r.json();
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='dispatched',custody='route_dispatch' WHERE id=ANY($1::uuid[])",[ids]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const input={...s.input,expected_version:route.version,manifest_id:route.current_manifest_id,manifest_version:route.version};
  const start=performance.now();const d=await s.request('POST',`routes/${route.id}/events`,input,s.dispatcher);assert.equal(d.statusCode,200,d.body);
  assert.equal(d.json().updated_count,1000);assert.equal(d.json().skipped_count,0);
  const delayed=await s.request('POST',`routes/${route.id}/events`,{...s.delay(d.json().version),manifest_id:route.current_manifest_id,manifest_version:route.version});
  assert.equal(delayed.statusCode,200,delayed.body);assert.equal(delayed.json().updated_count,1000);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_parcel_effects WHERE route_id=$1',[route.id])).rows[0]!.n,2000);
  t.diagnostic(`1000-Parcel departure plus delay: ${Math.round(performance.now()-start)} ms`);
});
