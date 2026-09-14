import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError,type DatabasePool } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { createRouteService } from '../../src/modules/routes/service.ts';
import { routeMetadata,legacyDispatch } from '../route-support.ts';
import type { RouteDto,RouteManifestItem } from '@shippingco/shared';
import { draft,input as pricingInput,start } from '../pricing-support.ts';
import { taxPolicy,taxFacts } from '../tax-support.ts';
import { contact } from '../customer-support.ts';
type Actor={id:string;token:string};
async function setup(t:Parameters<typeof bookingSetup>[0]) {
  const s=await bookingSetup(t);await s.db.prepareRoutes();
  const request=(method:'POST'|'PATCH'|'GET'|'DELETE',path:string,body?:unknown,actor:Actor=s.operator,key=randomUUID(),organization=org,franchise=A,extra:Record<string,string>={})=>s.app.inject({method,
    url:'/api/v1/'+path+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise,...extra}),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
  const create=async(actor:Actor=s.operator,organization=org,franchise=A)=>{const r=await request('POST','routes',routeMetadata,actor,randomUUID(),organization,franchise);assert.equal(r.statusCode,201,r.body);return r.json<RouteDto>();};
  const parcel=async()=>{const r=await s.book();assert.equal(r.statusCode,201,r.body);return r.json().parcels[0].id as string;};
  const check=async(id:string)=>{const r=await request('POST',`parcels/${id}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()});assert.equal(r.statusCode,200,r.body);};
  const mutate=async(route:RouteDto,path:string,body:Record<string,unknown>={})=>{const r=await request('POST',`routes/${route.id}/${path}`,{expected_version:route.version,...body});assert.equal(r.statusCode,200,r.body);return r.json<RouteDto>();};
  const effects=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.routes) routes,(SELECT count(*)::int FROM shipit.route_commands) commands,
    (SELECT count(*)::int FROM shipit.route_lots) lots,(SELECT count(*)::int FROM shipit.route_parcels) direct,
    (SELECT count(*)::int FROM shipit.route_manifests) manifests,(SELECT count(*)::int FROM shipit.route_manifest_parcels) parcels,
    (SELECT count(*)::int FROM shipit.route_manifest_sources) sources,(SELECT count(*)::int FROM shipit.route_audit_events) audits,
    (SELECT count(*)::int FROM shipit.domain_events WHERE route_id IS NOT NULL) events`)).rows[0];
  return {...s,request,create,parcel,check,mutate,effects,service:createRouteService(s.pool,s.keys.browser)};
}
await test('route persistence, UTC/Kolkata instant, inert carrier metadata, update/archive and original replay',{timeout:30000},async t=>{
  const provider=t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected provider request');});
  const s=await setup(t),key=randomUUID(),created=await s.request('POST','routes',routeMetadata,s.operator,key);assert.equal(created.statusCode,201,created.body);
  const route=created.json<RouteDto>();assert.equal(route.state,'planning');assert.equal(route.version,1);assert.equal(route.scheduled_departure_at,'2099-01-01T03:30:00Z');
  assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(route.scheduled_departure_at)),'09:00');
  assert.deepEqual((await s.request('POST','routes',{...routeMetadata,scheduled_departure_at:route.scheduled_departure_at},s.operator,key)).json(),route);
  assert.equal((await s.request('POST','routes',{...routeMetadata,carrier_code:'DIFFERENT'},s.operator,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  const fresh=createRouteService(s.db.runtimePool(),s.keys.browser);assert.deepEqual(await fresh.read(s.operator.token,route.id,{organization_id:org,franchise_id:A},randomUUID()),route);
  const updateKey=randomUUID(),body={...routeMetadata,origin:'Revised Origin',expected_version:1};
  const updated=await s.request('PATCH',`routes/${route.id}`,body,s.operator,updateKey);assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().version,2);
  assert.deepEqual((await s.request('PATCH',`routes/${route.id}`,body,s.operator,updateKey)).json(),updated.json());
  assert.equal((await s.request('PATCH',`routes/${route.id}`,body)).json().error.code,'VERSION_CONFLICT');
  const archiveKey=randomUUID(),archive={expected_version:2};const archived=await s.request('POST',`routes/${route.id}/archive`,archive,s.local,archiveKey);assert.equal(archived.statusCode,200,archived.body);
  assert.equal(archived.json().state,'archived');assert.deepEqual((await s.request('POST',`routes/${route.id}/archive`,archive,s.local,archiveKey)).json(),archived.json());
  assert.equal((await s.request('POST',`routes/${route.id}/finalize`,{expected_version:3})).json().error.code,'ROUTE_STATE_CONFLICT');
  assert.equal((await s.request('POST',`routes/${route.id}/events`,{})).statusCode,404);assert.equal((await s.request('DELETE',`routes/${route.id}`,{})).statusCode,404);
  assert.deepEqual(await s.effects(),{routes:1,commands:3,lots:0,direct:0,manifests:2,parcels:0,sources:0,audits:3,events:3});
  const col=(await s.db.adminQuery("SELECT data_type FROM information_schema.columns WHERE table_schema='shipit' AND table_name='routes' AND column_name='scheduled_departure_at'")).rows[0];assert.equal(col!.data_type,'timestamp with time zone');assert.equal(provider.mock.callCount(),0);
});
await test('lot/direct union has one Parcel with deterministic provenance; finalization freezes history and releases Lot guard',{timeout:30000},async t=>{
  const s=await setup(t),p1=await s.parcel(),p2=await s.parcel(),p3=await s.parcel();
  const l=await s.request('POST','lots',{name:'Synthetic Lot',destination_key:'SYN_DEST'});assert.equal(l.statusCode,201,l.body);const lot=l.json().id as string;
  const m1=await s.request('POST',`lots/${lot}/parcels`,{expected_version:1,parcel_id:p1});assert.equal(m1.statusCode,200,m1.body);
  const m2=await s.request('POST',`lots/${lot}/parcels`,{expected_version:2,parcel_id:p2});assert.equal(m2.statusCode,200,m2.body);
  let route=await s.create();route=await s.mutate(route,'lots',{lot_id:lot});route=await s.mutate(route,'parcels',{parcel_id:p2});route=await s.mutate(route,'parcels',{parcel_id:p3});
  const manifest=(await s.request('GET',`routes/${route.id}/parcels`)).json();assert.equal(manifest.manifest.parcel_count,3);
  assert.deepEqual(manifest.items.map((i:RouteManifestItem)=>i.parcel_id),[p1,p2,p3].sort());
  assert.deepEqual(manifest.items.find((i:RouteManifestItem)=>i.parcel_id===p2).sources.map((x:{kind:string})=>x.kind),['direct','lot']);
  const before=await s.effects();
  for(const actor of [s.operator,s.local,await s.grant('dispatcher',[A])]){
    assert.equal((await s.request('POST',`lots/${lot}/archive`,{expected_version:3},actor)).json().error.code,'LOT_ACTIVE_ROUTE');
    assert.equal((await s.request('POST',`lots/${lot}/parcels/${p1}/remove`,{expected_version:3,membership_id:m1.json().membership.id},actor)).json().error.code,'LOT_ACTIVE_ROUTE');
  }
  assert.deepEqual(await s.effects(),before);
  assert.equal((await s.request('POST',`routes/${route.id}/finalize`,{expected_version:route.version})).json().error.code,'PARCEL_STATE_CONFLICT');
  for(const p of [p1,p2,p3])await s.check(p);
  const key=randomUUID(),body={expected_version:route.version};const final=await s.request('POST',`routes/${route.id}/finalize`,body,s.operator,key);assert.equal(final.statusCode,200,final.body);route=final.json();
  assert.deepEqual((await s.request('POST',`routes/${route.id}/finalize`,body,s.operator,key)).json(),route);
  const frozen=(await s.request('GET',`routes/${route.id}/parcels`)).json();assert.equal(frozen.manifest.finalized,true);
  const removed=await s.request('POST',`lots/${lot}/parcels/${p1}/remove`,{expected_version:3,membership_id:m1.json().membership.id});assert.equal(removed.statusCode,200,removed.body);
  const added=await s.request('POST',`lots/${lot}/parcels`,{expected_version:4,parcel_id:p3});assert.equal(added.statusCode,200,added.body);
  assert.deepEqual((await s.request('GET',`routes/${route.id}/parcels`)).json(),frozen);
  assert.deepEqual((await s.request('GET',`routes/${route.id}/manifests/${manifest.manifest.id}`)).json(),manifest);
  for(const path of ['lots/'+lot+'/remove','parcels/'+p2+'/remove'])assert.equal((await s.request('POST',`routes/${route.id}/${path}`,{expected_version:route.version})).json().error.code,'ROUTE_STATE_CONFLICT');
  assert.equal((await s.request('POST',`routes/${route.id}/parcels`,{expected_version:route.version,parcel_id:p1})).json().error.code,'ROUTE_STATE_CONFLICT');
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.parcels WHERE status='dispatched'")).rows[0]!.n,0);
});
await test('T03 finalized membership and bounded bulk dispatch preserve existing lifecycle/audit and deny fabricated references',{timeout:30000},async t=>{
  const s=await setup(t),p1=await s.parcel(),p2=await s.parcel();await s.check(p1);await s.check(p2);
  let route=await s.create();route=await s.mutate(route,'parcels',{parcel_id:p1});const planning=route.current_manifest_id;route=await s.mutate(route,'finalize');
  await assert.rejects(legacyDispatch(s.pool,s.operator.token,p2,randomUUID(),{expected_version:2,evidence_ref:randomUUID(),manifest_id:randomUUID()}),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.parcel_dispatch_manifests')).rows[0]!.n,0);
  const dispatch=(p:string,m:string,key=randomUUID())=>s.request('POST',`parcels/${p}/dispatch`,{expected_version:2,evidence_ref:'00000000-0000-4000-8000-000000000555',manifest_id:m},s.operator,key);
  for(const [p,m,code] of [[p1,randomUUID(),'RESOURCE_NOT_FOUND'],[p1,planning,'PARCEL_STATE_CONFLICT'],[p2,route.current_manifest_id,'PARCEL_STATE_CONFLICT']])assert.equal((await dispatch(p!,m!)).json().error.code,code);
  const key=randomUUID(),ok=await dispatch(p1,route.current_manifest_id,key);assert.equal(ok.statusCode,200,ok.body);assert.equal(ok.json().version,3);assert.equal(ok.json().status,'dispatched');
  assert.deepEqual((await dispatch(p1,route.current_manifest_id,key)).json(),ok.json());
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.parcel_dispatch_manifests')).rows[0]!.n,1);
  const p3=await s.parcel();await s.check(p3);let other=await s.create();other=await s.mutate(other,'parcels',{parcel_id:p3});other=await s.mutate(other,'finalize');
  const bulk={action:'dispatch',items:[{parcel_id:p3,idempotency_key:randomUUID(),command:{expected_version:2,evidence_ref:randomUUID(),manifest_id:other.current_manifest_id}},
    {parcel_id:p2,idempotency_key:randomUUID(),command:{expected_version:2,evidence_ref:randomUUID(),manifest_id:randomUUID()}}]};
  const b=await s.request('POST','parcels/bulk',bulk);assert.equal(b.statusCode,200,b.body);assert.deepEqual(b.json().summary,{succeeded:1,failed:1});
  assert.deepEqual(b.json().items.find((i:{parcel_id:string})=>i.parcel_id===p2).error,{code:'RESOURCE_NOT_FOUND'});
});
await test('all seven roles enforce R09 W05 W06, live revocation and disabled-root historical reads',{timeout:30000},async t=>{
  const s=await setup(t),route=await s.create();
  const actors=[s.admin,s.local,s.operator,await s.grant('dispatcher',[A]),await s.grant('delivery_agent',[A]),await s.grant('accountant',[A]),await s.grant('read_only',[A])];
  for(const [i,actor] of actors.entries()){
    const read=await s.request('GET',`routes/${route.id}`,undefined,actor);assert.equal(read.statusCode,[0,1,2,3,6].includes(i)?200:403,read.body);
    const write=await s.request('POST','routes',routeMetadata,actor);assert.equal(write.statusCode,[1,2,3].includes(i)?201:403,write.body);
    const archive=await s.request('POST',`routes/${route.id}/archive`,{expected_version:0},actor);assert.equal(archive.statusCode,422);
    if(i!==1)assert.equal((await s.request('POST',`routes/${route.id}/archive`,{expected_version:1},actor)).json().error.code,'ACTION_FORBIDDEN');
  }
  const key=randomUUID(),created=await s.request('POST','routes',routeMetadata,s.operator,key);assert.equal(created.statusCode,201,created.body);
  await s.memberships.revokeMembership(s.admin.token,s.operator.member.id,{expected_version:1});
  assert.equal((await s.request('POST','routes',routeMetadata,s.operator,key)).statusCode,404);
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1 WHERE id=$1",[A]);
  assert.equal((await s.request('POST','routes',routeMetadata,s.local)).json().error.code,'FRANCHISE_DISABLED');
  assert.equal((await s.request('GET',`routes/${route.id}`,undefined,s.local)).statusCode,200);
  await s.db.adminQuery("UPDATE shipit.organizations SET lifecycle='disabled',version=version+1 WHERE id=$1",[org]);
  assert.equal((await s.request('POST','routes',routeMetadata,s.local)).json().error.code,'ORGANIZATION_DISABLED');
  assert.equal((await s.request('GET',`routes/${route.id}`,undefined,s.local)).statusCode,200);
});
for(const state of ['delivered','rto','dispatched'])await test(`ineligible ${state} direct and Lot members reject atomically; detach provides recovery`,{timeout:30000},async t=>{
  const s=await setup(t),p=await s.parcel();const l=await s.request('POST','lots',{name:'Synthetic Lot',destination_key:'SYN_DEST'}),lot=l.json().id as string;
  const added=await s.request('POST',`lots/${lot}/parcels`,{expected_version:1,parcel_id:p});assert.equal(added.statusCode,200,added.body);
  let route=await s.create();route=await s.mutate(route,'lots',{lot_id:lot});
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery('UPDATE shipit.parcels SET status=$2,custody=$3 WHERE id=$1',[p,state,state==='delivered'?'recipient':state==='dispatched'?'route_dispatch':'awaiting_intake']);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const before=await s.effects();
  assert.equal((await s.request('POST',`routes/${route.id}/parcels`,{expected_version:2,parcel_id:p})).json().error.code,'PARCEL_STATE_CONFLICT');
  assert.equal((await s.request('POST',`routes/${route.id}/finalize`,{expected_version:2})).json().error.code,'PARCEL_STATE_CONFLICT');
  const fresh=await s.create();const afterCreate=await s.effects();
  assert.equal((await s.request('POST',`routes/${fresh.id}/lots`,{expected_version:1,lot_id:lot})).json().error.code,'PARCEL_STATE_CONFLICT');
  assert.deepEqual(await s.effects(),afterCreate);assert.equal(before!.commands,2);
  route=await s.mutate(route,`lots/${lot}/remove`);assert.equal((await s.request('GET',`routes/${route.id}/parcels`)).json().manifest.parcel_count,0);
  assert.equal((await s.db.adminQuery('SELECT status FROM shipit.parcels WHERE id=$1',[p])).rows[0]!.status,state);
});
await test('optimistic attach/detach winner, exact source replay and permanent finalized dispatch uniqueness',{timeout:30000},async t=>{
  const s=await setup(t),p=await s.parcel(),q=await s.parcel();let route=await s.create();
  const key=randomUUID(),body={expected_version:1,parcel_id:p};
  const pair=await Promise.all([s.request('POST',`routes/${route.id}/parcels`,body,s.operator,key),s.request('POST',`routes/${route.id}/parcels`,body,s.operator,key)]);
  assert.equal(pair[0]!.statusCode,200,pair[0]!.body);assert.deepEqual(pair[0]!.json(),pair[1]!.json());route=pair[0]!.json();
  assert.equal((await s.request('POST',`routes/${route.id}/parcels`,{...body,parcel_id:q},s.operator,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  const race=await Promise.all([s.request('POST',`routes/${route.id}/parcels`,{expected_version:2,parcel_id:q}),s.request('POST',`routes/${route.id}/parcels/${p}/remove`,{expected_version:2})]);
  assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409]);assert.equal(race.find(r=>r.statusCode===409)!.json().error.code,'VERSION_CONFLICT');
  const lot=await s.request('POST','lots',{name:'Concurrent Source',destination_key:'SYN_DEST'});assert.equal(lot.statusCode,201,lot.body);
  const lotId=lot.json().id as string,spare=await s.parcel();
  const grouped=await s.request('POST',`lots/${lotId}/parcels`,{expected_version:1,parcel_id:q});assert.equal(grouped.statusCode,200,grouped.body);
  const version=race.find(r=>r.statusCode===200)!.json().version as number;
  const mixed=await Promise.all([s.request('POST',`routes/${route.id}/lots`,{expected_version:version,lot_id:lotId}),
    s.request('POST',`routes/${route.id}/parcels`,{expected_version:version,parcel_id:spare})]);
  assert.deepEqual(mixed.map(r=>r.statusCode).sort(),[200,409]);assert.equal(mixed.find(r=>r.statusCode===409)!.json().error.code,'VERSION_CONFLICT');
  // A separate pair isolates the finalization uniqueness invariant from source deduplication.
  await s.check(q);let a=await s.create(),b=await s.create();a=await s.mutate(a,'parcels',{parcel_id:q});b=await s.mutate(b,'parcels',{parcel_id:q});
  await s.mutate(a,'finalize');const before=await s.effects();
  const failed=await s.request('POST',`routes/${b.id}/finalize`,{expected_version:b.version});assert.equal(failed.json().error.code,'ROUTE_MANIFEST_CONFLICT');assert.deepEqual(await s.effects(),before);
  const removeKey=randomUUID(),removeBody={expected_version:b.version};const removed=await s.request('POST',`routes/${b.id}/parcels/${q}/remove`,removeBody,s.operator,removeKey);assert.equal(removed.statusCode,200,removed.body);
  assert.deepEqual((await s.request('POST',`routes/${b.id}/parcels/${q}/remove`,removeBody,s.operator,removeKey)).json(),removed.json());
});
await test('real sibling B and unrelated C nested resources and manifests are indistinguishable from unknown',{timeout:60000},async t=>{
  const s=await setup(t),p=await s.parcel();await s.check(p);const local=await s.create();
  async function foreign(organization:string,franchise:string){
    const admin=organization===org?s.admin:await s.user();if(organization!==org)await s.memberships.bootstrapAdministrator(admin.id,organization);
    async function actor(role:string){const u=await s.user(),i=await s.memberships.createInvitation(admin.token,{organization_id:organization,invitee_user_id:u.id,role,franchise_ids:[franchise]});await s.memberships.acceptInvitation(u.token,{token:i.acceptance_token});return u;}
    const owner=await actor('franchise_admin'),operator=await actor('operator');s.setNow('2098-12-31T23:00:00Z');
    const rate=await s.pricing.create(owner.token,organization,franchise,randomUUID(),draft,randomUUID());await s.pricing.publish(owner.token,organization,franchise,rate.id,randomUUID(),{expected_version:1},randomUUID());
    const policy=await s.tax.create(owner.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());await s.tax.publish(owner.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
    const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID());const quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),pricingInput,randomUUID());
    const tax_intent={quote_id:quote.id,pricing_input:pricingInput,facts:taxFacts},intent=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),tax_intent,randomUUID());
    const calc=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:intent.id},randomUUID());const booked=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:calc.id,tax_intent},randomUUID(),operator.token,franchise,organization);assert.equal(booked.statusCode,201,booked.body);
    const parcel=booked.json().parcels[0].id as string;
    const req=(method:'POST'|'GET',path:string,body?:unknown)=>s.request(method,path,body,operator,randomUUID(),organization,franchise);
    const l=await req('POST','lots',{name:'Foreign Lot',destination_key:'SYN_DEST'});assert.equal(l.statusCode,201,l.body);const lot=l.json().id as string;
    assert.equal((await req('POST',`lots/${lot}/parcels`,{expected_version:1,parcel_id:parcel})).statusCode,200);
    assert.equal((await req('POST',`parcels/${parcel}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()})).statusCode,200);
    let route=await s.create(operator,organization,franchise);
    const attached=await req('POST',`routes/${route.id}/lots`,{expected_version:1,lot_id:lot});assert.equal(attached.statusCode,200,attached.body);route=attached.json();
    const finalized=await req('POST',`routes/${route.id}/finalize`,{expected_version:route.version});assert.equal(finalized.statusCode,200,finalized.body);route=finalized.json();
    return {organization,franchise,operator,lot,parcel,route,booking:booked.json().id as string};
  }
  const others=[await foreign(org,B),await foreign(otherOrg,C)],before=await s.effects();
  const safe=(response:Awaited<ReturnType<typeof s.request>>)=>{assert.equal(response.statusCode,404,response.body);const e=response.json().error;delete e.correlation_id;return e;};
  for(const f of others){
    assert.deepEqual(safe(await s.request('GET',`routes/${f.route.id}`)),safe(await s.request('GET',`routes/${randomUUID()}`)));
    assert.deepEqual(safe(await s.request('POST',`routes/${local.id}/lots`,{expected_version:999,lot_id:f.lot})),safe(await s.request('POST',`routes/${local.id}/lots`,{expected_version:999,lot_id:randomUUID()})));
    safe(await s.request('POST',`routes/${local.id}/parcels`,{expected_version:999,parcel_id:f.parcel}));
    safe(await s.request('POST',`routes/${local.id}/lots/${f.lot}/remove`,{expected_version:999}));
    safe(await s.request('POST',`routes/${local.id}/parcels/${f.parcel}/remove`,{expected_version:999}));
    safe(await s.request('GET',`routes/${local.id}/manifests/${f.route.current_manifest_id}`));safe(await s.request('GET',`routes/${f.route.id}/parcels`));
    safe(await s.request('PATCH',`routes/${f.route.id}`,{...routeMetadata,expected_version:3}));
    safe(await s.request('POST',`routes/${f.route.id}/finalize`,{expected_version:3}));
    safe(await s.request('GET',`routes/${local.id}`,undefined,f.operator,randomUUID(),f.organization,f.franchise));
    const dispatch=(m:string)=>s.request('POST',`parcels/${p}/dispatch`,{expected_version:2,evidence_ref:randomUUID(),manifest_id:m});
    assert.deepEqual(safe(await dispatch(f.route.current_manifest_id)),safe(await dispatch(randomUUID())));
  }
  assert.deepEqual(await s.effects(),before);assert.deepEqual((await s.request('GET','routes')).json().items.map((r:RouteDto)=>r.id),[local.id]);
  // Isolate composite FKs using the disposable owner; normal runtime cannot disable guards.
  const cmd=(await s.db.adminQuery('SELECT last_command_id FROM shipit.routes WHERE id=$1',[local.id])).rows[0]!.last_command_id;
  for(const [table,field,resource] of [['route_lots','lot_id',others[0]!.lot],['route_parcels','parcel_id',others[1]!.parcel]]){
    await s.db.adminQuery(`ALTER TABLE shipit.${table} DISABLE TRIGGER ${table}_guard`);
    await assert.rejects(s.db.ownerPool().query(`INSERT INTO shipit.${table}(id,organization_id,franchise_id,route_id,${field},start_command_id,started_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`,[randomUUID(),org,A,local.id,resource,cmd]),e=>e instanceof DatabaseError&&e.sqlState==='23503');
    await s.db.adminQuery(`ALTER TABLE shipit.${table} ENABLE TRIGGER ${table}_guard`);
  }
  assert.deepEqual(await s.effects(),before);
});
function fault(pool:DatabasePool,point:string,omit=false):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    if(omit&&sql.includes(point))return {rows:[],rowCount:0,command:'SELECT',oid:0,fields:[]};
    const r=await client.query<Row>(sql,params);if(sql.includes(point))throw new DatabaseError('DB_CONNECTION_FAILED');return r;
  }};}};
}
await test('every transaction boundary rolls back; omitted facts cannot commit; uncertain COMMIT replays across restart',{timeout:60000},async t=>{
  const s=await setup(t),p=await s.parcel(),route=await s.create(),query={organization_id:org,franchise_id:A};
  const args=(key:string)=>[s.operator.token,route.id,null,query,key,['idempotency-key',key],{expected_version:1,parcel_id:p},'routes.parcel.attach' as const,randomUUID()] as const;
  const before=await s.effects();
  for(const point of ['INSERT INTO shipit.route_commands','INSERT INTO shipit.route_parcels','INSERT INTO shipit.route_manifests(',
    'INSERT INTO shipit.route_manifest_parcels','INSERT INTO shipit.route_manifest_sources','UPDATE shipit.routes','SELECT shipit.append_route_audit','INSERT INTO shipit.domain_events','UPDATE shipit.route_commands']){
    await assert.rejects(createRouteService(fault(s.pool,point),s.keys.browser).execute(...args(randomUUID())),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.deepEqual(await s.effects(),before);assert.deepEqual((await s.request('GET',`routes/${route.id}`)).json(),route);
  }
  for(const point of ['INSERT INTO shipit.route_manifest_sources','SELECT shipit.append_route_audit','INSERT INTO shipit.domain_events','UPDATE shipit.route_commands']){
    await assert.rejects(createRouteService(fault(s.pool,point,true),s.keys.browser).execute(...args(randomUUID())),{code:'TEMPORARILY_UNAVAILABLE'});assert.deepEqual(await s.effects(),before);
  }
  const key=randomUUID();await assert.rejects(createRouteService(fault(s.pool,'COMMIT'),s.keys.browser).execute(...args(key)),{code:'TEMPORARILY_UNAVAILABLE'});
  const committed=await s.effects();assert.equal(committed!.commands,2);assert.equal(committed!.manifests,2);
  const fresh=createRouteService(s.db.runtimePool(),s.keys.browser),recovered=await fresh.execute(...args(key));assert.equal(recovered.version,2);
  assert.deepEqual(await fresh.execute(...args(key)),recovered);assert.deepEqual(await s.effects(),committed);
  const receipts=(await s.db.adminQuery('SELECT * FROM shipit.route_commands')).rows;
  const privacy=JSON.stringify([recovered,s.logs,receipts,(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='route'")).rows,
    (await s.db.adminQuery('SELECT envelope FROM shipit.domain_events WHERE route_id IS NOT NULL')).rows]);
  for(const secret of [key,s.operator.token,s.headers['x-csrf-token'],'Synthetic Recipient','Synthetic Contact','19 Synthetic Lane','21 Fictional Street','+1 202-555-0101'])assert.ok(!privacy.includes(secret));
  const audit=await s.audit.list(s.local.token,{organization_id:org,resource_type:'route'},randomUUID());assert.equal(audit.items.length,2);
  const auditPage=await s.audit.list(s.local.token,{organization_id:org,resource_type:'route',limit:'1'},randomUUID());
  const auditNext=await s.audit.list(s.local.token,{organization_id:org,resource_type:'route',limit:'1',cursor:auditPage.page.next_cursor},randomUUID());
  assert.equal(auditNext.items.length,1);assert.notEqual(auditNext.items[0]!.id,auditPage.items[0]!.id);
  for(const table of ['route_manifests','route_manifest_parcels','route_manifest_sources','route_audit_events','route_commands']){
    await assert.rejects(s.db.ownerPool().query(`UPDATE shipit.${table} SET organization_id=organization_id`));
    await assert.rejects(s.db.ownerPool().query(`DELETE FROM shipit.${table}`));
  }
  await assert.rejects(s.db.ownerPool().query("UPDATE shipit.routes SET organization_id=$1 WHERE id=$2",[otherOrg,route.id]));
  const manifest=recovered.current_manifest_id;
  await assert.rejects(s.db.ownerPool().query(`INSERT INTO shipit.route_manifest_parcels(organization_id,franchise_id,route_id,manifest_id,parcel_id,booking_id,finalized)
    SELECT organization_id,franchise_id,$1,$2,id,booking_id,false FROM shipit.parcels WHERE id=$3`,[route.id,manifest,p]));
  assert.deepEqual(await s.effects(),committed);
});
await test('bounded deterministic pagination, source detach replay, cursor binding, strict HTTP and lock timeout',{timeout:30000},async t=>{
  const s=await setup(t),routes=[await s.create(),await s.create(),await s.create()];
  const first=(await s.request('GET','routes',undefined,s.operator,randomUUID(),org,A,{limit:'2'})).json();assert.equal(first.items.length,2);assert.equal(first.page.has_more,true);
  const next=(await s.request('GET','routes',undefined,s.operator,randomUUID(),org,A,{limit:'2',cursor:first.page.next_cursor})).json();assert.equal(next.items.length,1);assert.equal(next.page.has_more,false);
  assert.equal(new Set([...first.items,...next.items].map((r:RouteDto)=>r.id)).size,3);
  assert.equal((await s.request('GET','routes',undefined,s.local,randomUUID(),org,A,{limit:'2',cursor:first.page.next_cursor})).json().error.code,'CURSOR_INVALID');
  let route=routes[0]!;const parcels=[await s.parcel(),await s.parcel(),await s.parcel()];for(const p of parcels)route=await s.mutate(route,'parcels',{parcel_id:p});
  const page=(await s.request('GET',`routes/${route.id}/parcels`,undefined,s.operator,randomUUID(),org,A,{limit:'2'})).json();assert.equal(page.items.length,2);
  const last=(await s.request('GET',`routes/${route.id}/parcels`,undefined,s.operator,randomUUID(),org,A,{limit:'2',cursor:page.page.next_cursor})).json();
  assert.deepEqual([...page.items,...last.items].map((i:RouteManifestItem)=>i.parcel_id),parcels.sort());
  const old=route.current_manifest_id;route=await s.mutate(route,`parcels/${parcels[0]}/remove`);
  assert.equal((await s.request('GET',`routes/${route.id}/parcels`,undefined,s.operator,randomUUID(),org,A,{limit:'2',cursor:page.page.next_cursor})).json().error.code,'CURSOR_INVALID');
  assert.deepEqual((await s.request('GET',`routes/${route.id}/manifests/${old}`,undefined,s.operator,randomUUID(),org,A,{limit:'2',cursor:page.page.next_cursor})).json(),last);
  for(const extra of [{limit:'0'},{limit:'101'},{limit:'1.5'},{cursor:'garbage'},{state:'departed'}] as Record<string,string>[])assert.equal((await s.request('GET','routes',undefined,s.operator,randomUUID(),org,A,extra)).statusCode,422);
  const invalid=[{}, {...routeMetadata,origin:12},{...routeMetadata,scheduled_departure_at:'2099-02-30T03:30:00Z'}, {...routeMetadata,mode:'Flight'}, {...routeMetadata,organization_id:otherOrg}];
  for(const b of invalid)assert.equal((await s.request('POST','routes',b)).statusCode,422);
  const duplicate=await s.app.inject({method:'POST',url:`/api/v1/routes?organization_id=${org}&franchise_id=${A}`,cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:'{"origin":"One","origin":"Two"}'});assert.equal(duplicate.statusCode,400);
  const csrf=await s.app.inject({method:'POST',url:`/api/v1/routes?organization_id=${org}&franchise_id=${A}`,cookies:s.cookies(s.operator.token),headers:{'content-type':'application/json','idempotency-key':randomUUID()},payload:JSON.stringify(routeMetadata)});assert.equal(csrf.statusCode,403);
  const owner=await s.db.ownerPool().connect();await owner.query('BEGIN');await owner.query('SELECT id FROM shipit.organizations WHERE id=$1 FOR UPDATE',[org]);
  const service=createRouteService(s.db.runtimePool({statementTimeoutMs:150,queryTimeoutMs:1000}),s.keys.browser),key=randomUUID();
  const args=[s.operator.token,null,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],routeMetadata,'routes.create' as const,randomUUID()] as const;
  try{await assert.rejects(service.execute(...args),{code:'IDEMPOTENCY_IN_PROGRESS'});}
  finally{await owner.query('ROLLBACK');owner.release();}
  const recovered=await service.execute(...args);assert.deepEqual(await service.execute(...args),recovered);
});
await test('capacity bounds accept 1000 deduplicated Parcels and 100 sources; excess work rejects atomically',{timeout:60000},async t=>{
  const s=await setup(t),parcels:string[]=[];
  for(let i=0;i<20;i++){
    const b=await s.book({...s.body,parcels:Array.from({length:50},(_,j)=>({...s.body.parcels[0],weight_grams:j===49?950:1}))});assert.equal(b.statusCode,201,b.body);
    parcels.push(...b.json().parcels.map((p:{id:string})=>p.id));
  }
  const extra=await s.parcel(),l=await s.request('POST','lots',{name:'Capacity Lot',destination_key:'SYN_DEST'});assert.equal(l.statusCode,201,l.body);const lot=l.json().id as string;
  // Populate a large, valid-shaped synthetic Lot without 1000 unrelated Lot command
  // receipts. Only its old command guard is suspended; ownership/uniqueness remain on.
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships DISABLE TRIGGER lot_memberships_guard');
  try{await s.db.adminQuery(`INSERT INTO shipit.lot_memberships(id,organization_id,franchise_id,lot_id,booking_id,parcel_id,started_at,start_command_id)
    SELECT gen_random_uuid(),p.organization_id,p.franchise_id,l.id,p.booking_id,p.id,clock_timestamp(),l.last_command_id
    FROM shipit.parcels p JOIN shipit.lots l ON l.organization_id=p.organization_id AND l.franchise_id=p.franchise_id WHERE l.id=$1 AND p.id=ANY($2::uuid[])`,[lot,parcels]);}
  finally{await s.db.adminQuery('ALTER TABLE shipit.lot_memberships ENABLE TRIGGER lot_memberships_guard');}
  let large=await s.create();large=await s.mutate(large,'lots',{lot_id:lot});large=await s.mutate(large,'parcels',{parcel_id:parcels[0]});
  assert.equal((await s.request('GET',`routes/${large.id}/parcels`)).json().manifest.parcel_count,1000);
  let before=await s.effects();assert.equal((await s.request('POST',`routes/${large.id}/parcels`,{expected_version:large.version,parcel_id:extra})).json().error.code,'ROUTE_LIMIT_EXCEEDED');assert.deepEqual(await s.effects(),before);
  let many=await s.create();for(const parcel_id of parcels.slice(0,100)){const k=randomUUID();many=await s.service.execute(s.operator.token,many.id,null,{organization_id:org,franchise_id:A},k,['idempotency-key',k],{expected_version:many.version,parcel_id},'routes.parcel.attach',randomUUID());}
  before=await s.effects();assert.equal((await s.request('POST',`routes/${many.id}/parcels`,{expected_version:many.version,parcel_id:extra})).json().error.code,'ROUTE_LIMIT_EXCEEDED');assert.deepEqual(await s.effects(),before);
  // Archive is a recovery path and releases the still-planning Lot relationship.
  const archived=await s.request('POST',`routes/${large.id}/archive`,{expected_version:large.version},s.local);assert.equal(archived.statusCode,200,archived.body);
  assert.equal((await s.request('POST',`lots/${lot}/archive`,{expected_version:1})).statusCode,200);
});
await test('Lot detach original replay releases grouping guard, including independent SQL rejection',{timeout:30000},async t=>{
  const s=await setup(t),p=await s.parcel(),l=await s.request('POST','lots',{name:'Guard Lot',destination_key:'SYN_DEST'}),lot=l.json().id as string;
  const add=await s.request('POST',`lots/${lot}/parcels`,{expected_version:1,parcel_id:p});assert.equal(add.statusCode,200,add.body);
  let route=await s.create();const attachKey=randomUUID(),attachBody={expected_version:1,lot_id:lot};
  const attached=await s.request('POST',`routes/${route.id}/lots`,attachBody,s.operator,attachKey);assert.equal(attached.statusCode,200,attached.body);route=attached.json();
  assert.deepEqual((await s.request('POST',`routes/${route.id}/lots`,attachBody,s.operator,attachKey)).json(),route);
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships DISABLE TRIGGER lot_memberships_guard');
  try{await assert.rejects(s.db.ownerPool().query('UPDATE shipit.lot_memberships SET started_at=started_at WHERE lot_id=$1',[lot]),e=>e instanceof DatabaseError&&e.constraint==='lot_active_route_guard');}
  finally{await s.db.adminQuery('ALTER TABLE shipit.lot_memberships ENABLE TRIGGER lot_memberships_guard');}
  const key=randomUUID(),body={expected_version:2};const detached=await s.request('POST',`routes/${route.id}/lots/${lot}/remove`,body,s.operator,key);assert.equal(detached.statusCode,200,detached.body);
  assert.deepEqual((await s.request('POST',`routes/${route.id}/lots/${lot}/remove`,body,s.operator,key)).json(),detached.json());
  assert.equal((await s.request('POST',`lots/${lot}/parcels/${p}/remove`,{expected_version:2,membership_id:add.json().membership.id})).statusCode,200);
});
