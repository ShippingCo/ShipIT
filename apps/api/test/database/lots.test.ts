import { finalizedManifest,legacyDispatch } from '../route-support.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseError,type DatabasePool } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { createLotService } from '../../src/modules/lots/service.ts';
import { draft,input as pricingInput,start } from '../pricing-support.ts';
import { taxPolicy,taxFacts } from '../tax-support.ts';
import { contact } from '../customer-support.ts';
import type { LotDto,LotMembershipResult } from '@shippingco/shared';
import type { LotOperation } from '../../src/modules/lots/types.ts';
type Actor={id:string;token:string};
async function setup(t:Parameters<typeof bookingSetup>[0]) {
  const s=await bookingSetup(t);await s.db.prepareRoutes();
  const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);const parcel={id:booked.json().parcels[0].id as string,booking_id:booked.json().id as string};
  const request=(method:'POST'|'PATCH'|'GET'|'DELETE',path:string,body?:unknown,actor:Actor=s.operator,key=randomUUID(),organization=org,franchise=A,extra:Record<string,string>={})=>s.app.inject({method,
    url:'/api/v1/'+path+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise,...extra}),
    headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
  const create=async(name='Synthetic Lot',destination='SYN_DEST',actor:Actor=s.operator,organization=org,franchise=A)=>{
    const r=await request('POST','lots',{name,destination_key:destination},actor,randomUUID(),organization,franchise);assert.equal(r.statusCode,201,r.body);return r.json<LotDto>();
  };
  const effects=async()=> (await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.lots) lots,
    (SELECT count(*)::int FROM shipit.lot_memberships) memberships,(SELECT count(*)::int FROM shipit.lot_memberships WHERE ended_at IS NULL) active,
    (SELECT count(*)::int FROM shipit.lot_commands) commands,(SELECT count(*)::int FROM shipit.lot_audit_events) audits,
    (SELECT count(*)::int FROM shipit.domain_events WHERE lot_id IS NOT NULL) events`)).rows[0];
  const service=createLotService(s.pool,s.keys.browser);
  return {...s,parcel,request,create,effects,service};
}
await test('lots create/read/update/archive persist, replay stable, key and stale conflicts; scoped server codes',{timeout:30000},async t=>{
  const s=await setup(t),key=randomUUID(),body={name:'  Synthetic Lot  ',destination_key:'SYN_DEST'};
  const created=await s.request('POST','lots',body,s.operator,key);assert.equal(created.statusCode,201,created.body);const lot=created.json<LotDto>();
  assert.equal(lot.code,'LOT-0000000000000000001');assert.equal(lot.name,'Synthetic Lot');assert.equal(lot.version,1);
  assert.deepEqual((await s.request('POST','lots',body,s.operator,key)).json(),lot);
  assert.equal((await s.request('POST','lots',{...body,name:'Changed'},s.operator,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  assert.deepEqual((await s.request('GET',`lots/${lot.id}`)).json(),lot);
  const updated=await s.request('PATCH',`lots/${lot.id}`,{expected_version:1,name:'Renamed'});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().version,2);
  assert.equal((await s.request('PATCH',`lots/${lot.id}`,{expected_version:1,name:'Stale'})).json().error.code,'VERSION_CONFLICT');
  const archiveKey=randomUUID(),archiveBody={expected_version:2};
  const archived=await s.request('POST',`lots/${lot.id}/archive`,archiveBody,s.operator,archiveKey);assert.equal(archived.statusCode,200,archived.body);assert.equal(archived.json().state,'archived');
  assert.deepEqual((await s.request('POST',`lots/${lot.id}/archive`,archiveBody,s.operator,archiveKey)).json(),archived.json());
  assert.equal((await s.create()).code,'LOT-0000000000000000002');
  assert.equal((await s.request('DELETE',`lots/${lot.id}`,{})).statusCode,404);
  assert.deepEqual(await s.effects(),{lots:2,memberships:0,active:0,commands:4,audits:4,events:4});
  const fresh=createLotService(s.db.runtimePool(),s.keys.browser);
  assert.deepEqual(await fresh.read(s.operator.token,lot.id,{organization_id:org,franchise_id:A},randomUUID()),archived.json());
});
await test('add, atomic move, remove to ungrouped retain history and exact duplicate effects without lifecycle changes',{timeout:30000},async t=>{
  const s=await setup(t),a=await s.create('A'),b=await s.create('B'),addKey=randomUUID();
  const input={parcel_id:s.parcel.id,expected_version:1};
  const added=await s.request('POST',`lots/${a.id}/parcels`,input,s.operator,addKey);assert.equal(added.statusCode,200,added.body);const membership=added.json<LotMembershipResult>().membership!;
  assert.deepEqual((await s.request('POST',`lots/${a.id}/parcels`,input,s.operator,addKey)).json(),added.json());
  const moveKey=randomUUID(),moveBody={membership_id:membership.id,target_lot_id:b.id,expected_version:2,expected_target_version:1};
  const moved=await s.request('POST',`lots/${a.id}/parcels/${s.parcel.id}/move`,moveBody,s.operator,moveKey);assert.equal(moved.statusCode,200,moved.body);
  assert.deepEqual((await s.request('POST',`lots/${a.id}/parcels/${s.parcel.id}/move`,moveBody,s.operator,moveKey)).json(),moved.json());
  const next=moved.json<LotMembershipResult>().membership!;assert.notEqual(next.id,membership.id);assert.equal(next.lot_id,b.id);
  const removeKey=randomUUID(),removeBody={membership_id:next.id,expected_version:2};
  const removed=await s.request('POST',`lots/${b.id}/parcels/${s.parcel.id}/remove`,removeBody,s.operator,removeKey);assert.equal(removed.statusCode,200,removed.body);assert.equal(removed.json().membership,null);
  assert.deepEqual((await s.request('POST',`lots/${b.id}/parcels/${s.parcel.id}/remove`,removeBody,s.operator,removeKey)).json(),removed.json());
  assert.equal((await s.request('GET',`parcels/${s.parcel.id}/lot-membership`)).json(),null);
  assert.deepEqual(await s.effects(),{lots:2,memberships:2,active:0,commands:5,audits:6,events:6});
  const history=(await s.db.adminQuery('SELECT lot_id,end_reason,ended_at IS NOT NULL closed FROM shipit.lot_memberships ORDER BY started_at')).rows;
  assert.deepEqual(history,[{lot_id:a.id,end_reason:'moved',closed:true},{lot_id:b.id,end_reason:'removed',closed:true}]);
  assert.deepEqual((await s.db.adminQuery('SELECT version,status,custody FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0],{version:1,status:'booked',custody:'awaiting_intake'});
  assert.equal((await s.request('GET',`lots/${a.id}/memberships`)).json().items[0].end_reason,'moved');
});
await test('concurrent two-lot assignment and stale lot mutation produce one winner, controlled loser and exact counts',{timeout:30000},async t=>{
  const s=await setup(t),a=await s.create('A'),b=await s.create('B');
  const outcomes=await Promise.all([s.request('POST',`lots/${a.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1}),s.request('POST',`lots/${b.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1})]);
  assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);assert.equal(outcomes.find(r=>r.statusCode===409)!.json().error.code,'LOT_MEMBERSHIP_CONFLICT');
  assert.deepEqual(await s.effects(),{lots:2,memberships:1,active:1,commands:3,audits:3,events:3});
  const lot=outcomes.find(r=>r.statusCode===200)!.json().lots[0] as LotDto;
  const race=await Promise.all(['First','Second'].map(name=>s.request('PATCH',`lots/${lot.id}`,{name,expected_version:2})));
  assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409]);assert.equal(race.find(r=>r.statusCode===409)!.json().error.code,'VERSION_CONFLICT');
  assert.deepEqual(await s.effects(),{lots:2,memberships:1,active:1,commands:4,audits:4,events:4});
});
await test('destination mismatch provides fixed correction and does not close source or change versions/evidence',{timeout:30000},async t=>{
  const s=await setup(t),a=await s.create();
  s.setNow('2098-12-31T23:00:00Z');const rate=await s.pricing.create(s.local.token,org,A,randomUUID(),{...draft,effective_from:'2099-01-03T00:00:00Z',effective_to:'2099-01-04T00:00:00Z',rules:draft.rules.map(r=>({...r,destination_key:'OTHER'}))},randomUUID());
  await s.pricing.publish(s.local.token,org,A,rate.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
  const b=await s.create('Other','OTHER');
  const added=await s.request('POST',`lots/${a.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1});assert.equal(added.statusCode,200,added.body);
  const before=await s.effects(),versions=(await s.db.adminQuery('SELECT id,version FROM shipit.lots ORDER BY id')).rows;
  const r=await s.request('POST',`lots/${a.id}/parcels/${s.parcel.id}/move`,{membership_id:added.json().membership.id,target_lot_id:b.id,expected_version:2,expected_target_version:1});
  assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,'LOT_DESTINATION_MISMATCH');assert.equal(r.json().error.message,"Parcel destination does not match this lot. Choose or create a lot for the parcel's destination.");
  assert.deepEqual(await s.effects(),before);assert.deepEqual((await s.db.adminQuery('SELECT id,version FROM shipit.lots ORDER BY id')).rows,versions);
  assert.equal((await s.request('GET',`parcels/${s.parcel.id}/lot-membership`)).json().lot_id,a.id);
  const ungrouped=await s.book();assert.equal(ungrouped.statusCode,201,ungrouped.body);
  const mismatch=await s.request('POST',`lots/${b.id}/parcels`,{parcel_id:ungrouped.json().parcels[0].id,expected_version:1});
  assert.equal(mismatch.json().error.code,'LOT_DESTINATION_MISMATCH');assert.deepEqual(await s.effects(),before);
  assert.deepEqual((await s.db.adminQuery('SELECT id,version FROM shipit.lots ORDER BY id')).rows,versions);
});
await test('dispatcher-only post-dispatch correction and archive preserve membership and authoritative dispatch timeline',{timeout:30000},async t=>{
  const s=await setup(t),a=await s.create(),b=await s.create('B'),dispatcher=await s.grant('dispatcher',[A]);
  const add=await s.request('POST',`lots/${a.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1});assert.equal(add.statusCode,200,add.body);
  const check=await s.request('POST',`parcels/${s.parcel.id}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()});assert.equal(check.statusCode,200,check.body);
  const dispatch=await s.request('POST',`parcels/${s.parcel.id}/dispatch`,{expected_version:2,evidence_ref:randomUUID(),manifest_id:await finalizedManifest(s.pool,s.keys.browser,s.operator.token,[s.parcel.id])});assert.equal(dispatch.statusCode,200,dispatch.body);
  const beforeTimeline=(await s.request('GET',`parcels/${s.parcel.id}/timeline`)).json();
  const move={membership_id:add.json().membership.id,target_lot_id:b.id,expected_version:2,expected_target_version:1};
  for(const actor of [s.operator,s.local]){
    assert.equal((await s.request('POST',`lots/${a.id}/parcels/${s.parcel.id}/move`,move,actor)).statusCode,403);
    assert.equal((await s.request('POST',`lots/${a.id}/archive`,{expected_version:2},actor)).statusCode,403);
  }
  const moved=await s.request('POST',`lots/${a.id}/parcels/${s.parcel.id}/move`,move,dispatcher);assert.equal(moved.statusCode,200,moved.body);
  const key=randomUUID(),archived=await s.request('POST',`lots/${b.id}/archive`,{expected_version:2},dispatcher,key);assert.equal(archived.statusCode,200,archived.body);
  assert.equal(archived.json().state,'archived');assert.equal(archived.json().active_member_count,0);
  assert.deepEqual((await s.request('POST',`lots/${b.id}/archive`,{expected_version:2},dispatcher,key)).json(),archived.json());
  assert.deepEqual((await s.request('GET',`parcels/${s.parcel.id}/timeline`)).json(),beforeTimeline);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.lot_memberships WHERE ended_at IS NOT NULL")).rows[0]!.n,2);
  assert.deepEqual((await s.db.adminQuery('SELECT version,status,custody FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0],{version:3,status:'dispatched',custody:'route_dispatch'});
  assert.equal((await s.request('POST',`lots/${b.id}/parcels`,{parcel_id:s.parcel.id,expected_version:3},dispatcher)).json().error.code,'LOT_STATE_CONFLICT');
  assert.equal((await s.request('POST',`lots/${a.id}/archive`,{expected_version:3})).statusCode,403);
  await s.memberships.updateMembership(s.admin.token,dispatcher.member.id,{expected_version:1,role:'operator',franchise_ids:[A]});
  assert.equal((await s.request('POST',`lots/${b.id}/archive`,{expected_version:2},dispatcher,key)).statusCode,403);
  assert.deepEqual((await s.request('GET',`parcels/${s.parcel.id}/timeline`)).json(),beforeTimeline);
});
for(const status of ['delivered','rto'])await test(`terminal ${status} cannot enter active lot, even dispatcher; zero success effects`,{timeout:30000},async t=>{
  const s=await setup(t),lot=await s.create(),dispatcher=await s.grant('dispatcher',[A]);
  // Trusted future-domain fixture only; no delivery/proof API is introduced by #26.
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery(`UPDATE shipit.parcels SET status=$2,custody=$3 WHERE id=$1`,[s.parcel.id,status,status==='delivered'?'recipient':'awaiting_intake']);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const before=await s.effects();
  for(const actor of [s.operator,s.local,dispatcher]){const r=await s.request('POST',`lots/${lot.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1},actor);assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,'PARCEL_STATE_CONFLICT');}
  assert.deepEqual(await s.effects(),before);
});
await test('R08/W04 exact roles, current replay revocation, disabled roots and malformed inputs',{timeout:30000},async t=>{
  const s=await setup(t),lot=await s.create();
  for(const role of ['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only']){
    const actor=role==='org_admin'?s.admin:await s.grant(role,[A]);
    assert.equal((await s.request('GET',`lots/${lot.id}`,undefined,actor)).statusCode,['accountant','delivery_agent'].includes(role)?403:200);
    const r=await s.request('POST','lots',{name:'Role test',destination_key:'SYN_DEST'},actor);
    assert.equal(r.statusCode,['franchise_admin','operator','dispatcher'].includes(role)?201:403,r.body);
  }
  const key=randomUUID(),body={name:'Replay',destination_key:'SYN_DEST'},actor=await s.grant('operator',[A]);
  assert.equal((await s.request('POST','lots',body,actor,key)).statusCode,201);
  await s.memberships.revokeMembership(s.admin.token,actor.member.id,{expected_version:1});
  assert.equal((await s.request('POST','lots',body,actor,key)).statusCode,404);
  for(const bad of [{name:'bad',destination_key:'SYN_DEST',organization_id:org},{name:'bad',destination_key:'unknown'},{name:'bad',destination_key:'UNKNOWN'}])assert.equal((await s.request('POST','lots',bad)).statusCode,422);
  const before=await s.effects();await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1 WHERE id=$1",[A]);
  assert.equal((await s.request('POST','lots',body)).json().error.code,'FRANCHISE_DISABLED');
  await s.db.adminQuery("UPDATE shipit.organizations SET lifecycle='disabled',version=version+1 WHERE id=$1",[org]);
  assert.equal((await s.request('POST','lots',body)).json().error.code,'ORGANIZATION_DISABLED');assert.deepEqual(await s.effects(),before);
});
function fault(pool:DatabasePool,point:string,mode:'throw'|'omit'='throw'):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    if(mode==='omit'&&sql.includes(point))return {rows:[],rowCount:0,command:'SELECT',oid:0,fields:[]};
    const r=await client.query<Row>(sql,params);if(sql.includes(point))throw new DatabaseError('DB_CONNECTION_FAILED');return r;
  }};}};
}
await test('injected failures at every move boundary roll back state, versions, receipt, audit and events',{timeout:60000},async t=>{
  const s=await setup(t),a=await s.create(),b=await s.create('B');const add=await s.request('POST',`lots/${a.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1});assert.equal(add.statusCode,200,add.body);
  const before=await s.effects(),body={membership_id:add.json().membership.id,target_lot_id:b.id,expected_version:2,expected_target_version:1};
  for(const point of ['INSERT INTO shipit.lot_commands','UPDATE shipit.lot_memberships','INSERT INTO shipit.lot_memberships','UPDATE shipit.lots','SELECT shipit.append_lot_audit','INSERT INTO shipit.domain_events','UPDATE shipit.lot_commands']){
    const key=randomUUID(),broken=createLotService(fault(s.pool,point),s.keys.browser);
    await assert.rejects(broken.execute(s.operator.token,a.id,s.parcel.id,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,'lots.membership.move',randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.deepEqual(await s.effects(),before);assert.equal((await s.request('GET',`lots/${a.id}`)).json().version,2);assert.equal((await s.request('GET',`lots/${b.id}`)).json().version,1);
  }
  for(const point of ['SELECT shipit.append_lot_audit','INSERT INTO shipit.domain_events','UPDATE shipit.lot_commands']){
    const broken=createLotService(fault(s.pool,point,'omit'),s.keys.browser),key=randomUUID();
    await assert.rejects(broken.execute(s.operator.token,a.id,s.parcel.id,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,'lots.membership.move',randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.deepEqual(await s.effects(),before);
  }
});
await test('committed lost response replays across pool/service restart with no second membership/version/fact',{timeout:30000},async t=>{
  const s=await setup(t),lot=await s.create(),key=randomUUID(),body={parcel_id:s.parcel.id,expected_version:1};
  const args=[s.operator.token,lot.id,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,'lots.membership.add' as LotOperation,randomUUID()] as const;
  const broken=createLotService(fault(s.pool,'COMMIT'),s.keys.browser);await assert.rejects(broken.execute(...args),{code:'TEMPORARILY_UNAVAILABLE'});
  const before=await s.effects();assert.deepEqual(before,{lots:1,memberships:1,active:1,commands:2,audits:2,events:2});
  const fresh=createLotService(s.db.runtimePool(),s.keys.browser),recovered=await fresh.execute(...args);
  assert.deepEqual(await fresh.execute(...args),recovered);assert.deepEqual(await s.effects(),before);
  const privacy=JSON.stringify([recovered,s.logs,(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='lot'")).rows,
    (await s.db.adminQuery('SELECT envelope FROM shipit.domain_events WHERE lot_id IS NOT NULL')).rows]);
  for(const secret of ['Synthetic Recipient','Synthetic Contact','19 Synthetic Lane','21 Fictional Street','+1 202-555-0101',s.operator.token,key,s.headers['x-csrf-token']])assert.ok(!privacy.includes(secret));
  const audit=await s.audit.list(s.local.token,{organization_id:org,resource_type:'lot'},randomUUID());assert.equal(audit.items.length,2);
});
await test('A/B/C real resources: uniform foreign/unknown detail and nested denial, no counts or mutation; reverse scope',{timeout:60000},async t=>{
  const s=await setup(t),localLot=await s.create();
  async function foreign(organization:string,franchise:string){
    const admin=organization===org?s.admin:await s.user();if(organization!==org)await s.memberships.bootstrapAdministrator(admin.id,organization);
    async function actor(role:string){const u=await s.user(),i=await s.memberships.createInvitation(admin.token,{organization_id:organization,invitee_user_id:u.id,role,franchise_ids:[franchise]});await s.memberships.acceptInvitation(u.token,{token:i.acceptance_token});return u;}
    const local=await actor('franchise_admin'),operator=await actor('operator');s.setNow('2098-12-31T23:00:00Z');
    const rate=await s.pricing.create(local.token,organization,franchise,randomUUID(),draft,randomUUID());await s.pricing.publish(local.token,organization,franchise,rate.id,randomUUID(),{expected_version:1},randomUUID());
    const tax=await s.tax.create(local.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());await s.tax.publish(local.token,organization,franchise,tax.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
    const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID());
    const quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),pricingInput,randomUUID());const tax_intent={quote_id:quote.id,pricing_input:pricingInput,facts:taxFacts};
    const intent=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),tax_intent,randomUUID());const calc=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:intent.id},randomUUID());
    const book=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:calc.id,tax_intent},randomUUID(),operator.token,franchise,organization);assert.equal(book.statusCode,201,book.body);
    const lot=await s.create('Foreign Lot','SYN_DEST',operator,organization,franchise),parcel=book.json().parcels[0].id as string;
    const added=await s.request('POST',`lots/${lot.id}/parcels`,{parcel_id:parcel,expected_version:1},operator,randomUUID(),organization,franchise);
    assert.equal(added.statusCode,200,added.body);
    return {lot,parcel,membership:added.json().membership.id as string,operator,organization,franchise};
  }
  const others=[await foreign(org,B),await foreign(otherOrg,C)];const before=await s.effects(),errors:Record<string,unknown>[]=[];
  for(const f of others){
    for(const id of [f.lot.id,randomUUID()]){const r=await s.request('GET',`lots/${id}`);assert.equal(r.statusCode,404,r.body);const e=r.json().error;delete e.correlation_id;errors.push(e);}
    assert.equal((await s.request('GET','lots',undefined,s.operator,randomUUID(),f.organization,f.franchise)).statusCode,404);
    assert.equal((await s.request('GET',`lots/${localLot.id}`,undefined,f.operator,randomUUID(),f.organization,f.franchise)).statusCode,404);
    assert.equal((await s.request('POST',`lots/${f.lot.id}/parcels`,{parcel_id:s.parcel.id,expected_version:1})).statusCode,404);
    assert.equal((await s.request('POST',`lots/${localLot.id}/parcels`,{parcel_id:f.parcel,expected_version:1})).statusCode,404);
    assert.equal((await s.request('POST',`lots/${localLot.id}/parcels/${s.parcel.id}/move`,{membership_id:randomUUID(),target_lot_id:f.lot.id,expected_version:1,expected_target_version:1})).statusCode,404);
    assert.equal((await s.request('GET',`parcels/${f.parcel}/lot-membership`)).statusCode,404);
    assert.equal((await s.request('GET',`lots/${f.lot.id}/memberships`)).statusCode,404);
    const head=await s.app.inject({method:'HEAD',url:`/api/v1/lots/${f.lot.id}?organization_id=${org}&franchise_id=${A}`,cookies:s.cookies(s.operator.token)});
    assert.equal(head.statusCode,404);assert.equal(head.body,'');
    assert.equal((await s.request('PATCH',`lots/${f.lot.id}`,{expected_version:2,name:'Denied'})).statusCode,404);
    assert.equal((await s.request('POST',`lots/${f.lot.id}/archive`,{expected_version:2})).statusCode,404);
    for(const membership of [f.membership,randomUUID()])assert.equal((await s.request('POST',`lots/${localLot.id}/parcels/${s.parcel.id}/remove`,{membership_id:membership,expected_version:1})).statusCode,404);
  }
  assert.ok(errors.every(e=>JSON.stringify(e)===JSON.stringify(errors[0])));assert.deepEqual(await s.effects(),before);
  assert.deepEqual((await s.request('GET','lots')).json().items.map((x:LotDto)=>x.id),[localLot.id]);
  const denials=(await s.db.adminQuery("SELECT organization_id,franchise_id,resource_id FROM shipit.audit_records WHERE resource_type='lot' AND result='denied'")).rows;
  assert.ok(denials.length>=20);assert.ok(denials.every(r=>r.organization_id===null&&r.franchise_id===null&&r.resource_id===null));
  const audit=await s.audit.list(s.local.token,{organization_id:org,resource_type:'lot'},randomUUID());
  assert.deepEqual(audit.items.map(r=>r.resource.id),[localLot.id]);
  // Independently test composite FK integrity without the application guard: synthetic owner-only trigger suspension.
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships DISABLE TRIGGER lot_memberships_guard');
  const command=(await s.db.adminQuery('SELECT id FROM shipit.lot_commands WHERE lot_id=$1',[localLot.id])).rows[0]!.id;
  for(const f of others){
    const booking=(await s.db.adminQuery('SELECT booking_id FROM shipit.parcels WHERE id=$1',[f.parcel])).rows[0]!.booking_id;
    for(const [lot,parcel,book] of [[f.lot.id,s.parcel.id,s.parcel.booking_id],[localLot.id,f.parcel,booking]])await assert.rejects(s.db.ownerPool().query(`INSERT INTO shipit.lot_memberships(id,organization_id,franchise_id,lot_id,booking_id,parcel_id,started_at,start_command_id)
      VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)`,[randomUUID(),org,A,lot,book,parcel,command]),e=>e instanceof DatabaseError&&e.sqlState==='23503');
  }
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships ENABLE TRIGGER lot_memberships_guard');assert.deepEqual(await s.effects(),before);
});
await test('pagination bounds filters and live cursors; audit source and runtime history privileges',{timeout:30000},async t=>{
  const s=await setup(t),a=await s.create('A');await s.create('B');await s.create('C');
  const first=await s.request('GET','lots',undefined,s.operator,randomUUID(),org,A,{limit:'2'});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().items.length,2);assert.equal(first.json().page.has_more,true);
  const cursor=first.json().page.next_cursor;const next=await s.request('GET','lots',undefined,s.operator,randomUUID(),org,A,{limit:'2',cursor});assert.equal(next.json().items.length,1);assert.equal(next.json().page.has_more,false);
  assert.equal(new Set([...first.json().items,...next.json().items].map((l:LotDto)=>l.id)).size,3);
  assert.equal((await s.request('GET','lots',undefined,s.local,randomUUID(),org,A,{limit:'2',cursor})).json().error.code,'CURSOR_INVALID');
  const before=await s.effects();
  for(const table of ['lots','lot_memberships','lot_commands','lot_audit_events','lot_code_counters']){
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));await assert.rejects(s.pool.query(`ALTER TABLE shipit.${table} ADD COLUMN injected text`));
  }
  await assert.rejects(s.pool.query('UPDATE shipit.lots SET organization_id=$1 WHERE id=$2',[otherOrg,a.id]));
  await assert.rejects(s.pool.query('UPDATE shipit.lots SET name=$1 WHERE id=$2',['Bypass',a.id]));
  await assert.rejects(s.db.ownerPool().query('UPDATE shipit.lot_audit_events SET action=action'));
  await assert.rejects(s.pool.query('SELECT * FROM shipit.lot_code_counters'));
  await assert.rejects(s.pool.query('SELECT * FROM shipit.lot_audit_events'));
  assert.deepEqual(await s.effects(),before);
});

await test('database independent active-membership uniqueness blocks a real concurrent insert; active scoped code uniqueness',{timeout:30000},async t=>{
  const s=await setup(t),a=await s.create('A'),b=await s.create('B');
  const command=(await s.db.adminQuery('SELECT id FROM shipit.lot_commands WHERE lot_id=$1',[a.id])).rows[0]!.id;
  // Deliberately omit application/command guards to isolate the permanent FK/index invariant.
  // Only this disposable fixture's migration owner can suspend triggers.
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships DISABLE TRIGGER lot_memberships_guard');
  const pool=s.db.ownerPool(),first=await pool.connect(),second=await pool.connect();
  try {
    await first.query('BEGIN');await second.query('BEGIN');
    const sql=`INSERT INTO shipit.lot_memberships(id,organization_id,franchise_id,lot_id,booking_id,parcel_id,started_at,start_command_id)
      VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)`;
    await first.query(sql,[randomUUID(),org,A,a.id,s.parcel.booking_id,s.parcel.id,command]);
    const pid=(await second.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0]!.pid;
    const competing=second.query(sql,[randomUUID(),org,A,b.id,s.parcel.booking_id,s.parcel.id,command]);
    const outcome=competing.then(()=>null,e=>e as DatabaseError);
    let waiting=false;const deadline=performance.now()+2000;
    while(performance.now()<deadline){const row=(await s.db.adminQuery("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];if(row?.wait_event_type==='Lock'){waiting=true;break;}await delay(10);}
    assert.ok(waiting,'contender must actually wait on PostgreSQL uniqueness');await first.query('COMMIT');
    const rejected=await outcome;assert.ok(rejected instanceof DatabaseError);assert.equal(rejected.sqlState,'23505');assert.equal(rejected.constraint,'lot_memberships_one_active_idx');
    await second.query('ROLLBACK');
    assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.lot_memberships WHERE ended_at IS NULL')).rows[0]!.n,1);
  } finally {await first.query('ROLLBACK');await second.query('ROLLBACK');first.release();second.release();await s.db.adminQuery('ALTER TABLE shipit.lot_memberships ENABLE TRIGGER lot_memberships_guard');}
  await s.db.adminQuery('ALTER TABLE shipit.lots DISABLE TRIGGER lots_guard');
  await assert.rejects(pool.query('UPDATE shipit.lots SET code=$1 WHERE id=$2',[a.code,b.id]),e=>e instanceof DatabaseError&&e.sqlState==='23505'&&e.constraint==='lots_active_code_idx');
  await s.db.adminQuery('ALTER TABLE shipit.lots ENABLE TRIGGER lots_guard');
});

await test('upgrade preserves existing booking and dispatch events/audit byte-for-byte and old producers still work',{timeout:30000},async t=>{
  const {provisionDatabase}=await import('../../../../packages/db/test/support.ts');
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:14}),{applied:14});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db);const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  const parcelId=booked.json().parcels[0].id as string;
  const transition=(name:string,body:unknown)=>s.app.inject({method:'POST',url:`/api/v1/parcels/${parcelId}/${name}?organization_id=${org}&franchise_id=${A}`,
    headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload:JSON.stringify(body)});
  assert.equal((await transition('check-in',{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()})).statusCode,200);
  const legacyKey=randomUUID(),legacyBody={expected_version:2,evidence_ref:randomUUID(),manifest_id:randomUUID()};
  const legacy=await legacyDispatch(s.pool,s.operator.token,parcelId,legacyKey,legacyBody);
  const beforeEvents=(await db.adminQuery('SELECT event_id,envelope FROM shipit.domain_events ORDER BY event_id')).rows;
  const beforeAudit=(await db.adminQuery('SELECT * FROM shipit.audit_history ORDER BY id')).rows;assert.ok(beforeEvents.length>=4);assert.ok(beforeAudit.length>0);
  db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:10});await db.prepareRoutes();
  assert.deepEqual((await db.adminQuery('SELECT event_id,envelope FROM shipit.domain_events ORDER BY event_id')).rows,beforeEvents);
  assert.deepEqual((await db.adminQuery('SELECT * FROM shipit.audit_history ORDER BY id')).rows,beforeAudit);
  const {createParcelService}=await import('../../src/modules/parcels/service.ts');
  assert.deepEqual(await createParcelService(db.runtimePool()).execute(s.operator.token,parcelId,{organization_id:org,franchise_id:A},legacyKey,['idempotency-key',legacyKey],legacyBody,'parcels.dispatch',randomUUID()),legacy);
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.parcel_dispatch_manifests')).rows[0]!.n,0);
  const created=await createLotService(db.runtimePool(),s.keys.browser).execute(s.operator.token,null,null,{organization_id:org,franchise_id:A},'synthetic-upgrade-lot',['idempotency-key','synthetic-upgrade-lot'],
    {name:'Upgrade lot',destination_key:'SYN_DEST'},'lots.create',randomUUID());assert.equal((created as LotDto).version,1);
  assert.equal((await s.book()).statusCode,201);assert.deepEqual(await db.migrate(),{applied:0});
});

await test('actual unique violation becomes controlled membership conflict after rollback; concurrent exact retry has one effect',{timeout:30000},async t=>{
  const s=await setup(t),lot=await s.create(),body={parcel_id:s.parcel.id,expected_version:1};
  const before=await s.effects();
  // Suspend only the command guard in this disposable fixture so a second valid-shaped
  // membership reaches the independent unique index after the application's first insert.
  await s.db.adminQuery('ALTER TABLE shipit.lot_memberships DISABLE TRIGGER lot_memberships_guard');
  const raced:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    const result=await client.query<Row>(sql,params);
    if(sql.includes('INSERT INTO shipit.lot_memberships'))await client.query(sql,[randomUUID(),...params!.slice(1)]);
    return result;
  }};}};
  const key=randomUUID();try {
    await assert.rejects(createLotService(raced,s.keys.browser).execute(s.operator.token,lot.id,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,'lots.membership.add',randomUUID()),{code:'LOT_MEMBERSHIP_CONFLICT'});
  } finally {await s.db.adminQuery('ALTER TABLE shipit.lot_memberships ENABLE TRIGGER lot_memberships_guard');}
  assert.deepEqual(await s.effects(),before);
  const results=await Promise.all([s.request('POST',`lots/${lot.id}/parcels`,body,s.operator,key),s.request('POST',`lots/${lot.id}/parcels`,body,s.operator,key)]);
  assert.equal(results[0]!.statusCode,200);assert.deepEqual(results[0]!.json(),results[1]!.json());
  assert.deepEqual(await s.effects(),{lots:1,memberships:1,active:1,commands:2,audits:2,events:2});
});

await test('unresolved organization serialization is bounded and exact retry succeeds after lock release',{timeout:30000},async t=>{
  const s=await setup(t),owner=await s.db.ownerPool().connect(),key=randomUUID();
  const service=createLotService(s.db.runtimePool({statementTimeoutMs:150,queryTimeoutMs:1000}),s.keys.browser);
  const args=[s.operator.token,null,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],{name:'Retry lot',destination_key:'SYN_DEST'},'lots.create' as LotOperation,randomUUID()] as const;
  const before=await s.effects();await owner.query('BEGIN');await owner.query('SELECT id FROM shipit.organizations WHERE id=$1 FOR UPDATE',[org]);
  try {
    await assert.rejects(service.execute(...args),{code:'IDEMPOTENCY_IN_PROGRESS'});
    await assert.rejects(service.read(s.operator.token,randomUUID(),{organization_id:org,franchise_id:A},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  }
  finally {await owner.query('ROLLBACK');owner.release();}
  assert.deepEqual(await s.effects(),before);const result=await service.execute(...args);assert.deepEqual(await service.execute(...args),result);
  assert.deepEqual(await s.effects(),{lots:1,memberships:0,active:0,commands:1,audits:1,events:1});
});
