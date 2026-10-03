import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { carrierSetup,referenceInput,observationInput } from '../carrier-support.ts';
import { finalizedManifest } from '../route-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createCarrierService } from '../../src/modules/carriers/service.ts';
import { createCarrierReconciliationService } from '../../src/modules/carriers/reconciliation-service.ts';
import { paymentFault } from '../payment-support.ts';
import { policyFor,policyActivationDocument } from '../../src/modules/automation/registry.ts';
import { createNotificationConsumer } from '../../src/modules/automation/service.ts';
import { activateNotificationPolicies } from '../../src/modules/security/jobs.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { withTransaction } from '@shippingco/db';
import type { Event } from '../../src/modules/outbox/types.ts';

async function pilot(t:Parameters<typeof carrierSetup>[0]) {
  const s=await carrierSetup(t);
  const installKey=randomUUID(),selection={label:'AGC-MANUAL-FICTIONAL',file_import:false};
  const installed=await s.request('POST','carriers/installations',selection,s.local.token,installKey);
  assert.equal(installed.statusCode,201,installed.body);const iid=installed.json().id as string;
  assert.deepEqual((await s.request('POST','carriers/installations',selection,s.local.token,installKey)).json(),installed.json());
  assert.equal((await s.request('POST','carriers/installations',{...selection,file_import:true},s.local.token,installKey)).statusCode,409);
  const linked=await s.link(iid);assert.equal(linked.statusCode,201,linked.body);const ref=linked.json().id as string;
  const health=async()=>{const r=await s.request('GET',`carriers/installations/${iid}/health`);assert.equal(r.statusCode,200,r.body);return r.json();};
  const queue=async()=>{const r=await s.request('GET',`carriers/installations/${iid}/reconciliation`);assert.equal(r.statusCode,200,r.body);return r.json().items as {id:string;reason:string;decision:string|null}[];};
  const resolve=(id:string,decision='reject',version=1,key=randomUUID())=>s.request('POST',`carriers/reconciliation/${id}/resolve`,
    {decision,reason_code:decision==='apply'?'verified_movement':'incorrect_report',expected_version:1,expected_parcel_version:version},s.local.token,key);
  return {...s,iid,ref,health,queue,resolve};
}

await test('Akash Ganga fictional manual pilot: booking, mapping, review, one canonical transition, durable recovery and no carrier interfaces',{timeout:60000},async t=>{
  const s=await pilot(t),initial=await s.health();
  assert.deepEqual(Object.entries(initial.capabilities).filter(([,value])=>(value as {enabled:boolean}).enabled).map(([name])=>name),['manual_observations']);
  assert.deepEqual(initial.api,{state:'not_applicable',reason:'live_api_not_selected'});
  assert.equal(initial.manual.state,'no_observations');assert.equal(initial.manual.last_observation,null);
  for(const kind of ['imports','rates'])assert.equal((await s.request('POST',`carriers/installations/${s.iid}/${kind}`,{})).statusCode,403);
  assert.equal((await s.book()).statusCode,201); // A disabled carrier interface cannot prevent a second local booking.
  await s.db.prepareRoutes();
  const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.local.id,role:'dispatcher',franchise_ids:[A]});
  await s.memberships.acceptInvitation(s.local.token,{token:invite.acceptance_token});
  assert.equal((await s.request('POST',`parcels/${s.parcel}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()},s.operator.token)).statusCode,200);
  const manifest=await finalizedManifest(s.pool,s.keys.browser,s.local.token,[s.parcel]);
  assert.equal((await s.request('POST',`parcels/${s.parcel}/dispatch`,{expected_version:2,evidence_ref:randomUUID(),manifest_id:manifest})).statusCode,200);
  const body={...observationInput(s.ref),expected_parcel_version:3,occurred_at:{state:'known',at:s.clock().toISOString()}},key=randomUUID();
  const uncertain=createCarrierService(paymentFault(s.pool,'COMMIT'),s.keys.browser,s.clock);
  await assert.rejects(uncertain.mutate('observation',s.local.token,s.parcel,key,body,s.q,randomUUID()));
  const retry=await s.observe(s.ref,body,key);assert.equal(retry.statusCode,201,retry.body);
  assert.deepEqual((await s.observe(s.ref,body,key)).json(),retry.json());
  assert.equal((await s.queue()).length,1);
  const record=(await s.queue())[0]!;assert.equal(record.reason,'ready');
  const decisionKey=randomUUID(),results=await Promise.all([s.resolve(record.id,'apply',3,decisionKey),s.resolve(record.id,'apply',3,decisionKey)]);
  results.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.deepEqual(results[0]!.json(),results[1]!.json());
  const fresh=createCarrierReconciliationService(s.db.runtimePool(),s.keys.browser,s.clock);
  assert.equal((await fresh.list(s.local.token,s.iid,s.q,randomUUID())).items[0]!.decision,'apply');
  assert.equal((await fresh.list(s.local.token,s.iid,s.q,randomUUID())).freshness.state,'manual_only');
  assert.equal((await s.health()).manual.state,'last_known');
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows,[{status:'in_transit',version:4}]);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='parcel.in_transit'")).rows[0]!.n,1);
  // This canonical event intentionally suppresses route-overlap notifications.
  assert.equal(policyFor('parcel.in_transit')!.notify,false);
  await s.db.prepareNotificationAutomation();
  await activateNotificationPolicies(s.pool,[{organization_id:org,franchise_id:A}],policyActivationDocument([]));
  const unexpected=async():Promise<never>=>{throw new Error('Unexpected provider call');};
  const consumer=createNotificationConsumer({configuration:{graph_version:'v24.0',bindings:[]},
    provider:{validate:unexpected,template:unexpected,send:unexpected},clock:s.clock});
  const envelope=(await s.db.adminQuery<{envelope:Event}>("SELECT envelope FROM shipit.domain_events WHERE event_type='parcel.in_transit'")).rows[0]!.envelope;
  for(let attempt=0;attempt<2;attempt++)await withTransaction(s.pool,tx=>consumer.apply(issueTenantAccess(tx,{
    action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:org,permittedFranchiseIds:[A],organizationWide:false,
    correlationId:randomUUID(),provenance:'trusted-event'}),envelope,false));
  assert.deepEqual((await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[envelope.event_id])).rows,
    [{outcome:'skipped',reason_code:'unsupported_source_cause'}]);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
  const duplicate=await s.observe(s.ref,{...body,expected_parcel_version:4});assert.equal(duplicate.statusCode,201);
  assert.equal((await s.resolve(duplicate.json().id,'apply',4)).statusCode,409);
  s.setNow(new Date(s.clock().getTime()+3600_000).toISOString());
  const health=await s.health();assert.equal(health.manual.carrier_verified,false);assert.equal(health.manual.last_observation.actor_id,s.local.id);
  assert.equal(health.manual.received_age_seconds,3600);assert.equal(health.manual.source_age_seconds,3600);assert.equal(health.manual.review.unresolved,1);
  const rebooted=createCarrierService(s.db.runtimePool(),s.keys.browser,s.clock);
  assert.deepEqual(JSON.parse(JSON.stringify(await rebooted.health(s.local.token,s.iid,s.q,randomUUID()))),health);
  const audit=(await s.db.adminQuery("SELECT action,resource_type,reason_code FROM shipit.audit_history WHERE resource_type IN ('carrier','carrier_reconciliation')")).rows;
  assert.ok(audit.some(x=>x.action==='carrier.observation'));
  assert.equal(audit.filter(x=>x.resource_type==='carrier_reconciliation'&&x.reason_code==='verified_movement').length,1);
  assert.doesNotMatch(JSON.stringify(health)+s.logs.join('\n'),/Synthetic Recipient|Fictional Street|202-555|SYN-54|LLM_API_KEY/);
});

await test('manual recovery retains incorrect observations, reference corrections and proof/payment boundaries',{timeout:60000},async t=>{
  const s=await pilot(t),money=(await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows;
  const unknown=await s.observe(s.ref,{...observationInput(s.ref),status:null});assert.equal(unknown.statusCode,201);
  let h=await s.health();assert.equal(h.manual.review.unmapped,1);assert.equal(h.manual.source_time_state,'unknown');assert.equal(h.manual.source_age_seconds,null);
  const delivered=await s.observe(s.ref,{...observationInput(s.ref),status:'delivered_claim',occurred_at:{state:'known',at:s.clock().toISOString()}});
  assert.equal(delivered.statusCode,201);assert.equal((await s.resolve(delivered.json().id,'apply')).statusCode,409);
  assert.equal((await s.resolve(unknown.json().id)).statusCode,200);
  assert.equal((await s.resolve(delivered.json().id)).statusCode,200);
  assert.equal((await s.health()).manual.review.unresolved,0);
  const corrected=await s.link(s.iid,{...referenceInput(s.iid),external_docket:'AGC-FICTIONAL-CORRECTED',expected_version:1,reason_code:'reference_correction'});
  assert.equal(corrected.statusCode,201);assert.equal((await s.observe(s.ref)).statusCode,409);
  s.setNow(new Date(s.clock().getTime()+1000).toISOString());
  const next=await s.observe(corrected.json().id,{...observationInput(corrected.json().id),status:null,occurred_at:{state:'known',at:'2099-01-02T00:00:00Z'}});
  assert.equal(next.statusCode,201);h=await s.health();assert.equal(h.manual.source_time_state,'future');assert.equal(h.manual.source_age_seconds,null);
  assert.equal(h.manual.review.unresolved,1);assert.equal(h.manual.review.unmapped,1);
  const malformed=await s.observe(corrected.json().id,{...observationInput(corrected.json().id),paid:true});assert.equal(malformed.statusCode,422);
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,money);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.delivery_proofs')).rows[0]!.n,0);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.carrier_references')).rows[0]!.n,2);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.carrier_observations')).rows[0]!.n,3);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE reason_code='reference_correction'")).rows[0]!.n,1);
});

await test('manual health and configuration deny foreign installations, nested references and read-only writes',{timeout:60000},async t=>{
  const s=await pilot(t);await s.observe(s.ref);
  const reader=await s.grant('read_only',[A]);
  assert.equal((await s.request('POST','carriers/installations',{label:'NO',file_import:false},reader.token)).statusCode,403);
  assert.equal((await s.request('POST',`parcels/${s.parcel}/carriers/observations`,observationInput(s.ref),reader.token)).statusCode,403);
  const sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta('franchise_admin');
  for(const [actor,q] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
    for(const id of [s.iid,randomUUID()]){
      const r=await s.request('GET',`carriers/installations/${id}/health`,undefined,actor.token,randomUUID(),q);
      assert.equal(r.statusCode,404);assert.equal(r.json().error.code,'RESOURCE_NOT_FOUND');assert.doesNotMatch(r.body,/unresolved|actor_id|AGC|last_observation/);
    }
    assert.equal((await s.request('POST',`parcels/${s.parcel}/carriers/references`,referenceInput(s.iid),actor.token,randomUUID(),q)).statusCode,404);
    assert.equal((await s.request('POST',`parcels/${s.parcel}/carriers/observations`,observationInput(s.ref),actor.token,randomUUID(),q)).statusCode,404);
  }
  const assigned=await s.grant('delivery_agent',[A]);
  assert.equal((await s.request('GET',`carriers/installations/${s.iid}/health`,undefined,assigned.token)).statusCode,403);
  assert.equal((await s.request('GET',`carriers/installations/${s.iid}/health`,undefined,s.local.token,randomUUID(),{...s.q,cursor:'invalid'})).statusCode,422);
  const legacy=await s.install();assert.equal(legacy.statusCode,201);
  const manifests=(await s.request('GET','carriers/installations')).json().items;
  assert.equal(manifests.find((x:{id:string})=>x.id===legacy.json().id).capabilities.tracking_import.enabled,true);
  assert.equal(manifests.find((x:{id:string})=>x.id===s.iid).capabilities.tracking_import.enabled,false);
});
