import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { automationSetup, routeDelayFixture, applyDelaySource } from '../automation-support.ts';
import { bookingSetup } from '../booking-support.ts';
import { paymentFault } from '../payment-support.ts';
import { org, A, B, otherOrg, C } from '../audit-support.ts';
import { contact } from '../customer-support.ts';
import { callback, inbound, signed, webhookConfig } from '../webhook-fixture.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { createNotificationConsumer } from '../../src/modules/automation/service.ts';
import { createRouteDelayFanoutWorker } from '../../src/modules/automation/delay-worker.ts';
import { createOutboxWorker } from '../../src/modules/outbox/worker.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createMembershipService } from '../../src/modules/memberships/service.ts';
import { createConsentWorker } from '../../src/modules/whatsapp/consent-worker.ts';
import type { SendOutcome, WhatsappDependencies } from '../../src/modules/whatsapp/types.ts';
import type { DatabasePool } from '@shippingco/db';

const config = parseEnvironment({ NODE_ENV:'development', HOST:'127.0.0.1', PORT:'3000', LOG_LEVEL:'info',
  ALLOWED_ORIGINS:'http://localhost:5173', TRUSTED_PROXY_HOPS:'0', DATABASE_SECRET_REF:'local:database', DATABASE_TLS_MODE:'disable' });

// Only the transport and SQL boundary fail. Every business service and query is real.
async function setup(t:Parameters<typeof automationSetup>[0]) {
  const s = await automationSetup(t), sends:{recipient:string;binding:string}[] = [];
  let outcome:SendOutcome = {kind:'accepted', provider_message_id:'wamid.qualification45'};
  const dependencies:WhatsappDependencies & {clock:()=>Date} = {...s.dependencies, provider:{...s.dependencies.provider,
    send:async(binding, _template, recipient) => { sends.push({recipient,binding:binding.key}); return outcome; },
  }};
  let pool = s.pool;
  const logs:string[] = [];
  const make = (database:DatabasePool) => buildServer({config,database,auth:{keys:s.keys,delivery:{},webhook:undefined},
    pricingClock:s.clock,whatsapp:dependencies,logSink:{write:value=>logs.push(value)}});
  let app = make(pool);
  t.after(async()=>{await app.close();await pool.close();});
  const workers = () => ({outbox:createOutboxWorker(pool,[createNotificationConsumer(dependencies)],{clock:s.clock}),
    outbound:createOutboundWorker(pool,dependencies),inbox:createInboxWorker(pool)});
  async function restart() {
    await app.close();await s.app.close();await pool.close();
    pool = s.db.runtimePool();app = make(pool);
    return workers();
  }
  const request = (path:string, body?:unknown, token=s.franchiseAdmin.token, query:Record<string,string>=s.query, key=randomUUID()) => app.inject({
    method:body===undefined?'GET':'POST',url:'/api/v1/'+path+'?'+new URLSearchParams(query),cookies:s.cookies(token),
    headers:{...s.headers,'idempotency-key':key},...(body===undefined?{}:{payload:JSON.stringify(body)})});
  const webhook = (body:string, valid=true) => app.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,
    headers:signed(body,valid?webhookConfig.app_secret:'synthetic_wrong_signing_key')});
  const statusBody = (state:string) => JSON.stringify(callback([{id:'wamid.qualification45',status:state,
    timestamp:String(Math.floor(s.clock().getTime()/1000)),recipient_id:'12025550100'}]));
  const history = async(id:string) => {
    const response = await request('whatsapp/history/messages/'+id);assert.equal(response.statusCode,200);
    return response.json();
  };
  async function intent() {
    const rows = (await s.db.adminQuery<{id:string;source_id:string}>("SELECT id,source_id FROM shipit.whatsapp_outbound WHERE purpose='updates' AND source_id IN (SELECT event_id FROM shipit.domain_events WHERE event_type='booking.created')")).rows;
    assert.equal(rows.length,1);return rows[0]!;
  }
  async function advance(id:string, boundary:'available_at'|'lease_until') {
    const row = (await s.db.adminQuery<{ms:string}>(`SELECT ceil(extract(epoch FROM
      CASE WHEN $2='lease_until' THEN lease_until ELSE available_at END)*1000)::bigint::text ms
      FROM shipit.whatsapp_outbound WHERE id=$1`,[id,boundary])).rows[0]!;
    assert.ok(row.ms);s.setNow(new Date(Math.max(s.clock().getTime(),Number(row.ms))).toISOString());
  }
  async function privacy(...surfaces:unknown[]) {
    const audit = (await s.db.adminQuery('SELECT to_jsonb(a) value FROM shipit.audit_history a')).rows;
    const publicText = JSON.stringify([logs,audit,...surfaces]);
    for (const prohibited of [contact.phone,contact.phone.replace(/\D/g,''),contact.address!,s.operator.token,s.franchiseAdmin.token,
      webhookConfig.app_secret,webhookConfig.encryption_key,'wamid.qualification45','synthetic_private_provider_error',
      'sealed_payload','phone_normalized','template_variables','encrypted_secret']) {
      assert.equal(publicText.includes(prohibited),false,'Private marker absent from safe evidence');
    }
  }
  return {...s,dependencies,sends,request,webhook,statusBody,history,intent,advance,privacy,restart,workers,
    currentPool:()=>pool,setOutcome:(value:SendOutcome)=>{outcome=value;}};
}

await test('qualification: booking rollback before COMMIT leaves no source or notification; exact request recovers', {timeout:30000}, async t => {
  const s = await bookingSetup(t);await s.db.prepareNotificationAutomation();
  const before = await s.counts(), key = randomUUID();
  const app = buildServer({config,database:paymentFault(s.pool,'COMMIT','before'),auth:{keys:s.keys,delivery:{},webhook:undefined},
    pricingClock:s.clock,logSink:{write:()=>{}}});t.after(()=>app.close());
  const failed = await app.inject({method:'POST',url:'/api/v1/bookings?'+new URLSearchParams({organization_id:org,franchise_id:A}),
    cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':key},payload:JSON.stringify(s.body)});
  assert.equal(failed.statusCode,503);assert.equal(failed.json().error.code,'TEMPORARILY_UNAVAILABLE');
  assert.deepEqual(await s.counts(),before);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
  await app.close();await s.app.close();await s.pool.close();
  const fresh = buildServer({config,database:s.db.runtimePool(),auth:{keys:s.keys,delivery:{},webhook:undefined},pricingClock:s.clock,logSink:{write:()=>{}}});
  t.after(()=>fresh.close());
  const response = await fresh.inject({method:'POST',url:'/api/v1/bookings?'+new URLSearchParams({organization_id:org,franchise_id:A}),
    cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':key},payload:JSON.stringify(s.body)});
  assert.equal(response.statusCode,201);assert.deepEqual(await s.counts(),{bookings:1,parcels:1,obligations:1,commands:1,audits:1,events:2});
});

await test('qualification: committed booking and decision survive separate restarts, provider rejection recovers once through signed callback and history', {timeout:30000}, async t => {
  const s = await setup(t), before = await s.counts();
  assert.equal(s.sends.length,0);
  let w = await s.restart();await w.outbox.tick();
  const {id,source_id} = await s.intent();
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[source_id])).rows[0]!.n,1);
  w = await s.restart();await w.outbox.tick();assert.equal((await s.intent()).id,id);
  s.setOutcome({kind:'retryable_not_accepted',reason:'rate_limited',retry_after_seconds:120});
  await s.advance(id,'available_at');assert.equal(await w.outbound.tick(),'retry_wait');assert.equal(s.sends.length,1);
  assert.deepEqual(await s.counts(),before);
  const waiting = await s.history(id);assert.equal(waiting.message.state,'retry_wait');
  w = await s.restart();assert.equal(await w.outbound.tick(),null);assert.equal(s.sends.length,1);
  await s.advance(id,'available_at');s.setOutcome({kind:'accepted',provider_message_id:'wamid.qualification45'});
  assert.equal(await w.outbound.tick(),'accepted');assert.equal(s.sends.length,2);
  const accepted = await s.history(id);assert.equal(accepted.message.state,'accepted');assert.equal(accepted.message.progress,'none');
  const callbackBody = s.statusBody('delivered');assert.equal((await s.webhook(callbackBody)).statusCode,200);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_inbox WHERE kind='status' AND state='pending'")).rows[0]!.n,1);
  w = await s.restart();await w.inbox.tick();await w.outbound.tick();
  const delivered = await s.history(id);assert.equal(delivered.message.state,'delivered');assert.equal(delivered.attempts.length,2);
  assert.equal((await s.webhook(callbackBody)).statusCode,200);await w.inbox.tick();await w.outbound.tick();
  assert.equal(s.sends.length,2);assert.deepEqual(await s.counts(),before);assert.equal((await s.intent()).id,id);
  const parcel = await s.request('parcels/'+s.booked.json().parcels[0].id,undefined,s.operator.token);
  assert.equal(parcel.statusCode,200);assert.equal(parcel.json().status,'booked');
  assert.ok(s.sends.every(call=>call.binding==='automation_v1'&&call.recipient===contact.phone.replace(/[\s()-]/g,'')));
  await s.privacy(waiting,accepted,delivered);
});

for (const boundary of ['before reservation commit','lost reservation commit acknowledgement','lost accepted response persistence'] as const) {
  await test('qualification: '+boundary+' preserves one logical booking intent across closed-pool restart', {timeout:30000}, async t => {
    const s = await setup(t);await s.workers().outbox.tick();const {id} = await s.intent();await s.advance(id,'available_at');
    const before = await s.counts();
    const fault = boundary==='lost accepted response persistence' ? paymentFault(s.currentPool(),'INSERT INTO shipit.whatsapp_outbound_attempts','before')
      : paymentFault(s.currentPool(),'COMMIT',boundary==='before reservation commit'?'before':'after');
    await assert.rejects(createOutboundWorker(fault,s.dependencies).tick());
    assert.equal(s.sends.length,boundary==='lost accepted response persistence'?1:0);
    const reserved = await s.history(id);
    assert.equal(reserved.message.state,boundary==='before reservation commit'?'queued':'dispatching');
    const w = await s.restart();
    if (boundary==='before reservation commit') {
      assert.equal(await w.outbound.tick(),'accepted');assert.equal(s.sends.length,1);
    } else {
      await s.advance(id,'lease_until');assert.equal(await w.outbound.tick(),'uncertain');
      const uncertain = await s.history(id);assert.equal(uncertain.message.state,'uncertain');assert.equal(uncertain.attempts.length,1);
      assert.deepEqual(uncertain.recovery.allowed_reasons,['retry_uncertain_confirmed']);
      assert.equal(await w.outbound.tick(),null);assert.equal(await (await s.restart()).outbound.tick(),null);
      assert.equal(s.sends.length,boundary==='lost accepted response persistence'?1:0);await s.privacy(uncertain);
    }
    assert.equal((await s.intent()).id,id);assert.deepEqual(await s.counts(),before);
  });
}

await test('qualification: signed STOP after automation queue suppresses with zero reservations and survives restart', {timeout:30000}, async t => {
  const s = await setup(t);await s.workers().outbox.tick();const {id} = await s.intent();
  const at=(await s.db.adminQuery<{seconds:string}>('SELECT ceil(extract(epoch FROM clock_timestamp()))::bigint::text seconds')).rows[0]!.seconds;
  const body = JSON.stringify(callback([{...inbound('wamid.stop45','STOP'),from:contact.phone.replace(/\D/g,''),
    timestamp:at}],{kind:'messages'}));
  assert.equal((await s.webhook(body)).statusCode,200);await s.workers().inbox.tick();
  assert.equal(await createConsentWorker(s.currentPool(),webhookConfig).tick(),'revoked');
  await s.advance(id,'available_at');assert.equal(await s.workers().outbound.tick(),'suppressed');
  await s.restart();const detail = await s.history(id);
  assert.equal(detail.message.state,'suppressed');assert.equal(detail.message.reason_code,'consent_revoked');assert.equal(detail.attempts.length,0);
  assert.equal(s.sends.length,0);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_consent_receipts WHERE outcome='revoked'")).rows[0]!.n,1);
  assert.equal((await s.db.adminQuery('SELECT sealed_payload FROM shipit.whatsapp_outbound WHERE id=$1',[id])).rows[0]!.sealed_payload,null);
  await s.privacy(detail);
});

await test('qualification: signed callback rollback, committed inbox restart, duplicates and read-delivered-sent-failed ordering stay monotone', {timeout:30000}, async t => {
  const s = await setup(t);await s.workers().outbox.tick();const {id} = await s.intent();await s.advance(id,'available_at');
  await s.workers().outbound.tick();const body = s.statusBody('read');
  const before = (await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_inbox')).rows;
  assert.equal((await s.webhook(body,false)).statusCode,403);assert.deepEqual((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_inbox')).rows,before);
  assert.equal((await s.webhook(body)).statusCode,200);
  await assert.rejects(createInboxWorker(paymentFault(s.currentPool(),'COMMIT','before')).tick());
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_delivery_observations')).rows[0]!.n,0);
  let w = await s.restart();await w.inbox.tick();await w.outbound.tick();
  assert.equal((await s.history(id)).message.state,'read');
  for (const state of ['read','delivered','sent','failed']) {
    assert.equal((await s.webhook(s.statusBody(state))).statusCode,200);
    w = await s.restart();await w.inbox.tick();await w.outbound.tick();assert.equal((await s.history(id)).message.state,'read');
  }
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_inbox WHERE kind='status'")).rows[0]!.n,4);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_delivery_observations')).rows[0]!.n,1);
  const detail = await s.history(id);assert.equal(detail.message.failure_observed,true);assert.equal(detail.attempts.length,1);assert.equal(s.sends.length,1);
  await s.privacy(detail);
});

await test('qualification: uncertain recovery reauthorizes revoked membership, foreign scope and role before idempotent risk-aware redrive', {timeout:30000}, async t => {
  const s = await setup(t);await s.workers().outbox.tick();const {id,source_id} = await s.intent();await s.advance(id,'available_at');
  s.setOutcome({kind:'uncertain',reason:'synthetic_private_provider_error'});await s.workers().outbound.tick();
  const detail = await s.history(id), path = 'whatsapp/outbound/'+id+'/redrive';
  const body = {expected_version:detail.message.version,reason_code:'retry_uncertain_confirmed'}, key = randomUUID();
  const before = (await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action='whatsapp.redrive'")).rows;
  for (const actor of [s.admin,s.operator,await s.grant('read_only',[A])]) {
    assert.equal((await s.request(path,body,actor.token)).statusCode,403);
  }
  for (const [actor,query] of [[await s.grant('franchise_admin',[B]),{organization_id:org,franchise_id:B}],
    [await s.beta('franchise_admin'),{organization_id:otherOrg,franchise_id:C}]] as const) {
    for (const ref of [id,randomUUID()])assert.equal((await s.request('whatsapp/history/messages/'+ref,undefined,actor.token,query)).statusCode,404);
    const list = await s.request('whatsapp/history/messages',undefined,actor.token,{...query,source_id});
    assert.equal(list.statusCode,200);assert.deepEqual(list.json().items,[]);assert.equal(list.json().page.has_more,false);
    assert.equal((await s.request(path,body,actor.token,query)).statusCode,404);
  }
  assert.deepEqual((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action='whatsapp.redrive'")).rows,before);
  await s.memberships.revokeMembership(s.admin.token,s.franchiseAdmin.member.id,{expected_version:s.franchiseAdmin.member.version});
  assert.equal((await s.request(path,body)).statusCode,404);
  const replacement = await s.grant('franchise_admin',[A]);
  assert.equal((await s.request(path,{...body,reason_code:'dependency_repaired'},replacement.token)).statusCode,409);
  assert.equal((await s.request(path,{...body,expected_version:1},replacement.token)).statusCode,409);
  assert.equal((await s.request(path,{...body,recipient:contact.phone},replacement.token)).statusCode,422);
  const recovered = await s.request(path,body,replacement.token,s.query,key);assert.equal(recovered.statusCode,200);
  await s.restart();assert.deepEqual((await s.request(path,body,replacement.token,s.query,key)).json(),recovered.json());
  assert.equal((await s.request(path,{...body,reason_code:'dependency_repaired'},replacement.token,s.query,key)).statusCode,409);
  s.setOutcome({kind:'accepted',provider_message_id:'wamid.qualification45'});await s.advance(id,'available_at');
  assert.equal(await s.workers().outbound.tick(),'accepted');assert.equal(s.sends.length,2);assert.equal((await s.intent()).id,id);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action='whatsapp.redrive'")).rows[0]!.n,1);
  // Returning an old receipt is also an authorized read, even after successful recovery.
  await createMembershipService(s.currentPool()).revokeMembership(s.admin.token,replacement.member.id,{expected_version:replacement.member.version});
  assert.equal((await s.request(path,body,replacement.token,s.query,key)).statusCode,404);
  await s.privacy(detail,recovered.json());
});

await test('qualification: 45-Parcel Lot/direct fanout closes its pool after item seven, races resumed workers and sends each logical delay once', {timeout:180000}, async t => {
  const s = await setup(t), fixture = await routeDelayFixture(s,45,'2099-01-01T12:00:00Z',{overlap:true});
  await applyDelaySource(s,fixture.delay.event_id);await applyDelaySource(s,fixture.delay.event_id);
  const eta = async()=>(await s.db.adminQuery('SELECT version,total_delay_minutes,base_eta_at FROM shipit.routes WHERE id=$1',[fixture.route.id])).rows;
  const before = await eta();assert.deepEqual(await fixture.replayDelay(),fixture.delay);assert.deepEqual(await eta(),before);
  const crash = createRouteDelayFanoutWorker(s.currentPool(),s.dependencies,{afterItem:n=>{if(n===7)throw new Error('SYNTHETIC_ITEM_COMMITTED');}});
  await assert.rejects(crash.tick(),{message:'SYNTHETIC_ITEM_COMMITTED'});
  const committed = (await s.db.adminQuery('SELECT parcel_id,outbound_intent_id FROM shipit.route_delay_fanout_items ORDER BY parcel_id')).rows;assert.equal(committed.length,7);
  await s.restart();
  const a = createRouteDelayFanoutWorker(s.currentPool(),s.dependencies), peer = s.db.runtimePool();
  const b = createRouteDelayFanoutWorker(peer,s.dependencies);assert.equal(await a.tick(),20);
  const done = await Promise.all([a.tick(),b.tick()]);assert.equal(done.reduce((x,y)=>x+y,0),18);await peer.close();
  const root = (await s.db.adminQuery('SELECT state,total_count,completed_count,attempt_count FROM shipit.route_delay_fanouts')).rows;
  assert.deepEqual(root,[{state:'completed',total_count:45,completed_count:45,attempt_count:45}]);
  assert.deepEqual((await s.db.adminQuery('SELECT parcel_id,outbound_intent_id FROM shipit.route_delay_fanout_items ORDER BY parcel_id LIMIT 7')).rows,committed);
  const intents = (await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_outbound WHERE source_id=$1',[fixture.delay.event_id])).rows;assert.equal(intents.length,45);
  // Deliberately bound to fixture cardinality; no retry-until-green loop.
  for (const item of intents) {s.setOutcome({kind:'accepted',provider_message_id:'wamid.fanout45_'+randomUUID()});await s.advance(item.id,'available_at');assert.equal(await s.workers().outbound.tick(),'accepted');}
  assert.equal(s.sends.length,45);assert.equal(await s.workers().outbound.tick(),null);
  await s.restart();await applyDelaySource({...s,pool:s.currentPool()},fixture.delay.event_id);assert.deepEqual(await eta(),before);assert.equal(await s.workers().outbound.tick(),null);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE source_id=$1 AND state='accepted' AND attempts=1",[fixture.delay.event_id])).rows[0]!.n,45);
});

await test('qualification: decision COMMIT followed by missing job acknowledgement reclaims its receipt without a second intent',{timeout:30000},async t=>{
 const s=await setup(t),worker=s.workers().outbox;
 assert.equal(await worker.relay('customer-notifications'),1);
 const job=await worker.claim('customer-notifications');assert.ok(job);
 assert.equal(await worker.effect(job),null);
 const {id,source_id}=await s.intent();assert.equal(s.sends.length,0);
 const expiry=(await s.db.adminQuery<{ms:string}>('SELECT ceil(extract(epoch FROM lease_until)*1000)::bigint::text ms FROM shipit.outbox_jobs WHERE id=$1',[job.id])).rows[0]!;
 const fresh=await s.restart();s.setNow(new Date(Number(expiry.ms)).toISOString());
 await fresh.outbox.tick();
 assert.equal((await s.intent()).id,id);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[source_id])).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.outbox_receipts WHERE job_id=$1',[job.id])).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.outbox_jobs WHERE id=$1',[job.id])).rows[0]!.state,'completed');
 await s.advance(id,'available_at');assert.equal(await fresh.outbound.tick(),'accepted');assert.equal(s.sends.length,1);
});

await test('qualification: unavailable provider preserves booking, explicit dependency repair restores the same logical notification',{timeout:30000},async t=>{
 const s=await setup(t),before=await s.counts();await s.workers().outbox.tick();const {id}=await s.intent();
 s.setOutcome({kind:'unavailable',reason:'synthetic_private_provider_error'});await s.advance(id,'available_at');
 assert.equal(await s.workers().outbound.tick(),'failed');assert.deepEqual(await s.counts(),before);assert.equal(s.sends.length,1);
 await s.restart();const detail=await s.history(id);assert.equal(detail.message.reason_code,'provider_rejected');
 assert.deepEqual(detail.recovery.allowed_reasons,['dependency_repaired']);assert.equal(await s.workers().outbound.tick(),null);
 const response=await s.request('whatsapp/outbound/'+id+'/redrive',{expected_version:detail.message.version,reason_code:'dependency_repaired'});
 assert.equal(response.statusCode,200);s.setOutcome({kind:'accepted',provider_message_id:'wamid.qualification45'});
 await s.advance(id,'available_at');assert.equal(await s.workers().outbound.tick(),'accepted');
 const body=s.statusBody('delivered');assert.equal((await s.webhook(body)).statusCode,200);
 await s.workers().inbox.tick();await s.workers().outbound.tick();await s.restart();
 const final=await s.history(id);assert.equal(final.message.state,'delivered');assert.equal(final.attempts.length,2);
 assert.equal(s.sends.length,2);assert.equal((await s.intent()).id,id);assert.deepEqual(await s.counts(),before);await s.privacy(detail,final);
});
