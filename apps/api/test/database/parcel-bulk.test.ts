import { finalizedManifest } from '../route-support.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MAX_BULK_PARCELS, type BulkParcelItem, type BulkParcelRequest, type BulkParcelResult } from '@shippingco/shared';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { createParcelBulkService } from '../../src/modules/parcels/bulk-service.ts';
import { createParcelService } from '../../src/modules/parcels/service.ts';
import { draft, input as pricingInput, start } from '../pricing-support.ts';
import { taxPolicy, taxFacts } from '../tax-support.ts';
import { contact } from '../customer-support.ts';
import { HttpError } from '../../src/plugins/errors.ts';
const item=(parcel_id:string,version=1):BulkParcelItem=>({parcel_id,idempotency_key:randomUUID(),command:{expected_version:version,evidence_ref:randomUUID(),location_ref:randomUUID()}});
async function setup(t:Parameters<typeof bookingSetup>[0],n=3) {
  const s=await bookingSetup(t);await s.db.prepareRoutes();
  const created=await s.book({...s.body,parcels:Array.from({length:n},(_,i)=>({...s.body.parcels[0],weight_grams:i===n-1?999-n+1:1}))});
  assert.equal(created.statusCode,201,created.body);
  const ids=(created.json().parcels as {id:string}[]).map(p=>p.id).sort();
  const payload:BulkParcelRequest={action:'check_in',items:ids.map(id=>item(id))};
  const post=(body:unknown=payload,key=randomUUID(),actor:{id:string;token:string}=s.operator,organization=org,franchise=A)=>s.app.inject({method:'POST',
    url:'/api/v1/parcels/bulk?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
    headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),payload:JSON.stringify(body)});
  const effects=async()=> (await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.parcel_transitions) transitions,
    (SELECT count(*)::int FROM shipit.domain_events WHERE parcel_command_id IS NOT NULL) events,
    (SELECT count(*)::int FROM shipit.audit_history WHERE resource_type='parcel') audits,
    (SELECT count(*)::int FROM shipit.parcel_commands) commands`)).rows[0];
  return {...s,ids,payload,post,effects};
}
await test('bulk mixed A/current/stale, sibling B, unrelated C and unknown: only authorized current A changes',{timeout:30000},async t=>{
  const s=await setup(t,4);
  async function foreignParcel(organization:string,franchise:string) {
    const administrator=organization===org?s.admin:await s.user();
    if(organization!==org)await s.memberships.bootstrapAdministrator(administrator.id,organization);
    async function actor(role:string) {
      const user=await s.user();const invite=await s.memberships.createInvitation(administrator.token,
        {organization_id:organization,invitee_user_id:user.id,role,franchise_ids:[franchise]});
      await s.memberships.acceptInvitation(user.token,{token:invite.acceptance_token});return user;
    }
    const local=await actor('franchise_admin'),operator=await actor('operator');
    s.setNow('2098-12-31T23:00:00Z');
    const rate=await s.pricing.create(local.token,organization,franchise,randomUUID(),draft,randomUUID());
    await s.pricing.publish(local.token,organization,franchise,rate.id,randomUUID(),{expected_version:1},randomUUID());
    const policy=await s.tax.create(local.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());
    await s.tax.publish(local.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());
    s.setNow(start);
    const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID());
    const quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),pricingInput,randomUUID());
    const tax_intent={quote_id:quote.id,pricing_input:pricingInput,facts:taxFacts};
    const intent=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),tax_intent,randomUUID());
    const calculation=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:intent.id},randomUUID());
    const created=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:calculation.id,tax_intent},randomUUID(),operator.token,franchise,organization);
    assert.equal(created.statusCode,201,created.body);return {p:created.json().parcels[0].id as string};
  }
  const foreign=await foreignParcel(org,B),unrelated=await foreignParcel(otherOrg,C);
  const unknown=randomUUID(),input={...s.payload,items:[s.payload.items[0]!,{...s.payload.items[1]!,command:{...s.payload.items[1]!.command,expected_version:2}},item(foreign.p,99),item(unrelated.p,99),item(unknown,99)]};
  const outerKey=randomUUID(),response=await s.post(input,outerKey);assert.equal(response.statusCode,200,response.body);const result=response.json<BulkParcelResult>();
  assert.deepEqual(result.summary,{succeeded:1,failed:4});
  assert.equal(result.items.find(item=>item.outcome==='succeeded')?.result.version,2);
  const errors=result.items.filter(r=>r.outcome==='failed');
  assert.equal(errors.find(r=>r.parcel_id===s.ids[1])!.error.code,'VERSION_CONFLICT');
  const notFound=errors.filter(r=>[foreign.p,unrelated.p,unknown].includes(r.parcel_id));
  assert.equal(notFound.length,3);assert.ok(notFound.every(r=>JSON.stringify(r.error)==='{"code":"RESOURCE_NOT_FOUND"}'));
  assert.deepEqual(await s.effects(),{transitions:1,events:1,audits:1,commands:1});
  const versions=(await s.db.adminQuery('SELECT id,version FROM shipit.parcels')).rows;
  assert.ok(versions.every(p=>p.version===(p.id===s.ids[0]?2:1)));
  const privacy=JSON.stringify([result,s.logs,(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='parcel'")).rows,
    (await s.db.adminQuery('SELECT envelope FROM shipit.domain_events WHERE parcel_command_id IS NOT NULL')).rows]);
  for(const secret of ['Synthetic Recipient','Synthetic Contact','19 Synthetic Lane','21 Fictional Street','+1 202-555-0101',s.operator.token,outerKey,input.items[0]!.idempotency_key])assert.ok(!privacy.includes(secret));
});
await test('bulk duplicate, concurrent outer and item replay, changed outer intent and failed-only retry count actual effects',{timeout:30000},async t=>{
  const s=await setup(t),first=s.payload.items[0]!,stale={...s.payload.items[1]!,command:{...s.payload.items[1]!.command,expected_version:2}},key=randomUUID();
  const input={action:'check_in' as const,items:[first,first,stale]};
  const raced=await Promise.all([s.post(input,key),s.post(input,key)]);
  assert.ok(raced.every(r=>r.statusCode===200));assert.deepEqual(raced[0]!.json(),raced[1]!.json());
  assert.deepEqual(raced[0]!.json().summary,{succeeded:1,failed:1});
  assert.deepEqual((await s.post({...input,items:[stale,first]},key)).json(),raced[0]!.json());
  const conflict=await s.post({...input,items:[first]},key);assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');
  const retry=await s.post({action:'check_in',items:[{...stale,idempotency_key:randomUUID(),command:{...stale.command,expected_version:1}}]});
  assert.equal(retry.json().summary.succeeded,1);assert.deepEqual(await s.effects(),{transitions:2,events:2,audits:2,commands:2});
  const reused=await s.post({action:'check_in',items:[{...s.payload.items[2]!,idempotency_key:first.idempotency_key}]});
  assert.equal(reused.json().items[0].error.code,'IDEMPOTENCY_CONFLICT');
  const sameItem=await Promise.all([s.post({action:'check_in',items:[first]}),s.post({action:'check_in',items:[first]})]);
  assert.ok(sameItem.every(r=>r.json().items[0].outcome==='succeeded'));assert.deepEqual(await s.effects(),{transitions:2,events:2,audits:2,commands:2});
});
await test('lost response after committed items recovers across service/runtime-pool restart; unexecuted items finish',{timeout:30000},async t=>{
  const s=await setup(t),single=createParcelService(s.pool,s.clock),key=randomUUID();let calls=0;
  const broken=createParcelBulkService(s.pool,{async execute(...args){const result=await single.execute(...args);if(++calls===2)throw new HttpError('TEMPORARILY_UNAVAILABLE');return result;}});
  const args=[s.operator.token,{organization_id:org,franchise_id:A},key,['idempotency-key',key],s.payload,randomUUID()] as const;
  await assert.rejects(broken.execute(...args),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await s.effects(),{transitions:2,events:2,audits:2,commands:2});
  const pool=s.db.runtimePool(),restarted=createParcelBulkService(pool,createParcelService(pool,s.clock));
  const recovered=await restarted.execute(...args);assert.deepEqual(recovered.summary,{succeeded:3,failed:0});
  const original=await restarted.execute(...args);assert.deepEqual(original,recovered);
  assert.deepEqual(await s.effects(),{transitions:3,events:3,audits:3,commands:3});
});
await test('max+1, ambiguous duplicates, item key reuse and prohibited operations reject before any business/receipt work',{timeout:30000},async t=>{
  const s=await setup(t,1),first=s.payload.items[0]!;
  const bad=[{...s.payload,items:Array.from({length:MAX_BULK_PARCELS+1},()=>first)},
    {...s.payload,items:[first,{...first,idempotency_key:randomUUID()}]},
    {...s.payload,items:[first,{...item(randomUUID()),idempotency_key:first.idempotency_key}]},
    ...['delivered','payment','otp_verify','rto','transit','move_to_lot'].map(action=>({...s.payload,action}))];
  for(const body of bad){const response=await s.post(body);assert.equal(response.statusCode,422,response.body);}
  assert.deepEqual(await s.effects(),{transitions:0,events:0,audits:0,commands:0});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.parcel_bulk_requests')).rows[0]!.n,0);
});
await test('exact maximum executes sequentially and two distinct-key batches cannot both win a version',{timeout:30000},async t=>{
  const s=await setup(t,MAX_BULK_PARCELS);
  const response=await s.post();assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json().summary,{succeeded:50,failed:0});
  assert.deepEqual(await s.effects(),{transitions:50,events:50,audits:50,commands:50});
  const manifest=await finalizedManifest(s.pool,s.keys.browser,s.operator.token,[s.ids[0]!]);
  const dispatch=()=>({action:'dispatch',items:[{parcel_id:s.ids[0],idempotency_key:randomUUID(),command:{expected_version:2,evidence_ref:randomUUID(),manifest_id:manifest}}]});
  const race=await Promise.all([s.post(dispatch()),s.post(dispatch())]);
  assert.deepEqual(race.map(r=>r.json().items[0].outcome).sort(),['failed','succeeded']);
  assert.deepEqual(await s.effects(),{transitions:51,events:51,audits:51,commands:51});
});
await test('bulk preserves exact action role matrix, wrong-scope denial, state guards and revoked replay authority',{timeout:30000},async t=>{
  const s=await setup(t,1);
  const actors=[s.admin,s.local,s.operator,await s.grant('dispatcher',[A]),await s.grant('delivery_agent',[A]),await s.grant('accountant',[A]),await s.grant('read_only',[A])];
  const service=createParcelBulkService(s.pool,createParcelService(s.pool,s.clock));
  for(const [index,actor] of actors.entries()) {
    const key=randomUUID();const work=()=>service.execute(actor.token,{organization_id:org,franchise_id:A},key,['idempotency-key',key],s.payload,randomUUID());
    if(index===2)assert.equal((await work()).summary.succeeded,1);else await assert.rejects(work(),{code:'ACTION_FORBIDDEN'});
  }
  for(const [index,actor] of actors.entries()) {
    const key=randomUUID(),payload={action:'dispatch',items:[{parcel_id:s.ids[0],idempotency_key:randomUUID(),command:{expected_version:1,evidence_ref:randomUUID(),manifest_id:randomUUID()}}]};
    const work=()=>service.execute(actor.token,{organization_id:org,franchise_id:A},key,['idempotency-key',key],payload,randomUUID());
    if([1,2,3].includes(index))assert.equal((await work()).items[0]!.outcome,'failed');else await assert.rejects(work(),{code:'ACTION_FORBIDDEN'});
  }
  for(const [actor,organization,franchise] of [[await s.grant('operator',[B]),org,B],[await s.beta('operator'),otherOrg,C]] as const){
    const response=await s.post(s.payload,randomUUID(),actor,organization,franchise);assert.equal(response.json().items[0].error.code,'RESOURCE_NOT_FOUND');
  }
  const again=await s.post({...s.payload,items:[item(s.ids[0]!,2)]});assert.equal(again.json().items[0].error.code,'PARCEL_STATE_CONFLICT');
  const key=randomUUID();await s.post(s.payload,key);
  await s.memberships.revokeMembership(s.admin.token,s.operator.member.id,{expected_version:s.operator.member.version});
  assert.equal((await s.post(s.payload,key)).statusCode,404);
  assert.deepEqual(await s.effects(),{transitions:1,events:1,audits:1,commands:1});
});
await test('dispatch booked and terminal check-in are controlled state conflicts; HTTP CSRF and batch rate bounds remain active',{timeout:30000},async t=>{
  const s=await setup(t,1),id=s.ids[0]!;
  const routes=(await import('../../src/modules/routes/service.ts')).createRouteService(s.pool,s.keys.browser),k=randomUUID();
  const planned=await routes.execute(s.operator.token,null,null,{organization_id:org,franchise_id:A},k,['idempotency-key',k],(await import('../route-support.ts')).routeMetadata,'routes.create',randomUUID());
  const booked=await s.post({action:'dispatch',items:[{parcel_id:id,idempotency_key:randomUUID(),command:{expected_version:1,evidence_ref:randomUUID(),manifest_id:planned.current_manifest_id}}]});
  assert.equal(booked.json().items[0].error.code,'PARCEL_STATE_CONFLICT');
  // Trusted synthetic terminal fixture, following the owning lifecycle suite's setup seam.
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='delivered',custody='recipient' WHERE id=$1",[id]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const terminal=await s.post();assert.equal(terminal.json().items[0].error.code,'PARCEL_STATE_CONFLICT');
  const csrf=await s.app.inject({method:'POST',url:'/api/v1/parcels/bulk?'+new URLSearchParams({organization_id:org,franchise_id:A}),
    headers:{'content-type':'application/json',origin:'http://localhost:5173','idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload:JSON.stringify(s.payload)});
  assert.equal(csrf.statusCode,403);
  let limited=false;
  for(let i=0;i<13;i++){const r=await s.post();if(r.statusCode===429){assert.equal(r.json().error.code,'RATE_LIMITED');assert.ok(r.headers['retry-after']);limited=true;break;}}
  assert.ok(limited);assert.deepEqual(await s.effects(),{transitions:0,events:0,audits:0,commands:0});
});
await test('outer fingerprint binds action, each key, version and evidence; response loss cannot rebind intent',{timeout:30000},async t=>{
  const s=await setup(t,1),service=createParcelBulkService(s.pool,createParcelService(s.pool,s.clock)),key=randomUUID(),first=s.payload.items[0]!;
  const run=(body:unknown)=>service.execute(s.operator.token,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,randomUUID());
  await run(s.payload);
  for(const changed of [
    {...s.payload,items:[{...first,idempotency_key:randomUUID()}]},
    {...s.payload,items:[{...first,command:{...first.command,expected_version:2}}]},
    {...s.payload,items:[{...first,command:{...first.command,evidence_ref:randomUUID()}}]},
    {...s.payload,items:[{...first,command:{...first.command,location_ref:randomUUID()}}]},
    {action:'dispatch',items:[{...first,command:{expected_version:2,evidence_ref:randomUUID(),manifest_id:randomUUID()}}]},
  ])await assert.rejects(run(changed),{code:'IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(await s.effects(),{transitions:1,events:1,audits:1,commands:1});
});
