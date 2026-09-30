import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { bookingSetup } from './booking-support.ts';
import { org,A} from './audit-support.ts';
import { webhookConfig } from './webhook-fixture.ts';
import { createWhatsappService } from '../src/modules/whatsapp/service.ts';
import { consentContactKey } from '../src/modules/whatsapp/consent-worker.ts';
import { createOutboxWorker } from '../src/modules/outbox/worker.ts';
import { createNotificationConsumer } from '../src/modules/automation/service.ts';
import { activateNotificationPolicies } from '../src/modules/security/jobs.ts';
import { policyActivationDocument } from '../src/modules/automation/registry.ts';
import { routeMetadata } from './route-support.ts';
import { input as pricingInput } from './pricing-support.ts';
import { taxFacts } from './tax-support.ts';
import { createParcelService } from '../src/modules/parcels/service.ts';
import { createParcelBulkService } from '../src/modules/parcels/bulk-service.ts';
import { createRouteService } from '../src/modules/routes/service.ts';
import { createRouteEventService } from '../src/modules/routes/event-service.ts';
import { createLotService } from '../src/modules/lots/service.ts';
import { issueTenantAccess } from '../src/modules/security/scope.ts';
import type { Event } from '../src/modules/outbox/types.ts';
import type { Binding, WhatsappDependencies } from '../src/modules/whatsapp/types.ts';

export const policies=[
  {policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']},
  {policy_id:'parcel-checked-in',policy_version:1,template_name:'parcel_checked_in',template_language:'en_US',variables:['docket']},
  {policy_id:'parcel-dispatched',policy_version:1,template_name:'parcel_dispatched',template_language:'en_US',variables:['docket']},
  {policy_id:'route-departed',policy_version:1,template_name:'route_departed',template_language:'en_US',variables:['docket']},
  {policy_id:'route-delayed',policy_version:1,template_name:'route_delayed',template_language:'en_US',variables:['docket','effective_at','revised_eta_at']},
  {policy_id:'route-arrived',policy_version:1,template_name:'route_arrived',template_language:'en_US',variables:['docket']},
];

export async function automationSetup(t:Parameters<typeof bookingSetup>[0],activateBefore=true,options:{skipTemplate?:string;consent?:boolean;missingBinding?:boolean}={}) {
  const s=await bookingSetup(t);await s.db.prepareNotificationAutomation();
  const admin=await s.grant('franchise_admin',[A]),binding={key:'automation_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:automation/v1'};
  const configuredPolicies=options.missingBinding?policies.filter(p=>p.policy_id!=='booking-confirmation'):policies;
  const configuration={graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,automation:{policies:configuredPolicies}};
  const dependencies:WhatsappDependencies & {clock:()=>Date}={configuration,clock:s.clock,provider:{validate:async()=>{},template:async(_binding:Binding,name:string,language:string)=>({provider_id:'100003',name,language,status:'APPROVED',category:'UTILITY',shape_hash:'a'.repeat(64),
    variables:Array.from({length:policies.find(policy=>policy.template_name===name)?.variables.length??0},()=>({type:'text' as const})),supported:true}),send:async()=>({kind:'accepted' as const,provider_message_id:'wamid.automation'})}};
  const whatsapp=createWhatsappService(s.pool,dependencies),query={organization_id:org,franchise_id:A};
  const installed=await whatsapp.execute(admin.token,null,'connect',query,randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
  const installationId=String(installed.id);
  let installationVersion=1;
  for(const policy of policies)if(policy.policy_id!==options.skipTemplate)await whatsapp.execute(admin.token,installationId,'sync',query,randomUUID(),
    {expected_version:installationVersion++,name:policy.template_name,language:policy.template_language},randomUUID());
  const activations=policyActivationDocument(configuredPolicies);
  if(activateBefore)await activateNotificationPolicies(s.pool,[binding],activations);
  const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  if(!activateBefore)for(const policy of activations)await s.db.adminQuery(`INSERT INTO shipit.notification_policy_activations
    (organization_id,franchise_id,consumer_id,policy_id,policy_version,binding_hash,activated_at)
    VALUES($1,$2,'customer-notifications',$3,$4,$5,'2100-01-01T00:00:00Z')`,[org,A,policy.id,policy.version,policy.binding_hash]);
  const customer=(await s.db.adminQuery<{contact_version:string;phone_normalized:string}>('SELECT contact_version,phone_normalized FROM shipit.customers WHERE id=$1',[s.source.id])).rows[0]!;
  if(options.consent!==false) {
    const inbox=randomUUID(),contactKey=consentContactKey(webhookConfig,installationId,customer.phone_normalized),consentAt=new Date();
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_inbox(id,organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,occurred_at,sealed_payload,key_version,correlation_id,state,processed_at)
      VALUES($1,$2,$3,$4,$5,$6,'inbound',$7,$8,$9,$10,$11,'completed',$8)`,[inbox,org,A,installationId,'synthetic:'+inbox,'b'.repeat(64),'wamid.'+inbox,consentAt,'A'.repeat(38),webhookConfig.key_version,randomUUID()]);
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_state(organization_id,franchise_id,installation_id,contact_key,customer_id,contact_version,state,version,last_change_at,last_inbound_at,last_inbox_id,policy_version)
      VALUES($1,$2,$3,$4,$5,$6,'granted',1,$7,$7,$8,'whatsapp-consent-v1')`,[org,A,installationId,contactKey,s.source.id,customer.contact_version,consentAt,inbox]);
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_receipts
      (inbox_id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,intent,outcome,policy_version,occurred_at,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'start','granted','whatsapp-consent-v1',$8,$9)`,
      [inbox,org,A,installationId,s.source.id,customer.contact_version,contactKey,consentAt,randomUUID()]);
  }
  return {...s,franchiseAdmin:admin,dependencies,booked,worker:createOutboxWorker(s.pool,[createNotificationConsumer(dependencies)]),query};
}

type AutomationSetup=Awaited<ReturnType<typeof automationSetup>>;
export async function routeDelayFixture(s:AutomationSetup,count:number,baseEta:string|null='2099-01-01T12:00:00Z',options:{overlap?:boolean;terminalBeforeDelay?:readonly ('delivered'|'rto')[]}={}) {
  const totalWeight=count*999,fixtureTag=randomUUID().slice(0,8).toUpperCase(),quoteResponse=await s.quote({...pricingInput,weight_grams:totalWeight});
  assert.equal(quoteResponse.statusCode,200,quoteResponse.body);const quote=quoteResponse.json<{id:string}>();
  const taxIntent={quote_id:quote.id,pricing_input:{...pricingInput,weight_grams:totalWeight},facts:taxFacts};
  const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),taxIntent,randomUUID());
  const calculated=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
  const booking=await s.booking.create(s.operator.token,org,A,randomUUID(),{customer_id:s.source.id,expected_customer_version:1,
    tax_calculation_id:calculated.id,tax_intent:taxIntent,parcels:Array.from({length:count},(_,index)=>({weight_grams:999,
      docket:`F41-${fixtureTag}-${String(index+1).padStart(3,'0')}`,recipient:{name:'Synthetic recipient',phone:'+1 202-555-0101',address:'21 Fictional Street'}}))},randomUUID());
  const parcelIds=booking.parcels.map(parcel=>parcel.id),bulk=createParcelBulkService(s.pool,createParcelService(s.pool,s.clock));
  const bulkRun=(body:unknown)=>{const key=randomUUID();return bulk.execute(s.operator.token,s.query,key,['idempotency-key',key],body,randomUUID());};
  const checked=await bulkRun({action:'check_in',items:parcelIds.map(parcel_id=>({parcel_id,
    idempotency_key:randomUUID(),command:{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()}}))});
  assert.equal(checked.summary.succeeded,count);
  const routes=createRouteService(s.pool,s.keys.browser),run=(id:string|null,body:unknown,operation:Parameters<typeof routes.execute>[7])=>{
    const key=randomUUID();return routes.execute(s.operator.token,id,null,s.query,key,['idempotency-key',key],body,operation,randomUUID());};
  let route=await run(null,routeMetadata,'routes.create');
  if(options.overlap) {
    const lots=createLotService(s.pool,s.keys.browser),lotRun=(id:string|null,body:unknown,operation:Parameters<typeof lots.execute>[7])=>{
      const key=randomUUID();return lots.execute(s.operator.token,id,null,s.query,key,['idempotency-key',key],body,operation,randomUUID());};
    const lot=await lotRun(null,{name:'Fanout overlap',destination_key:'SYN_DEST'},'lots.create') as {id:string;version:number};
    await lotRun(lot.id,{expected_version:lot.version,parcel_id:parcelIds[0]},'lots.membership.add');
    const key=randomUUID();route=await routes.execute(s.operator.token,route.id,null,s.query,key,['idempotency-key',key],
      {expected_version:route.version,lot_id:lot.id},'routes.lot.attach',randomUUID());
  }
  for(const parcel_id of parcelIds)route=await run(route.id,{expected_version:route.version,parcel_id},'routes.parcel.attach');
  route=await run(route.id,{expected_version:route.version},'routes.finalize');
  const dispatched=await bulkRun({action:'dispatch',items:parcelIds.map(parcel_id=>({parcel_id,
    idempotency_key:randomUUID(),command:{expected_version:2,evidence_ref:randomUUID(),manifest_id:route.current_manifest_id}}))});
  assert.equal(dispatched.summary.succeeded,count);
  const dispatcher=await s.grant('dispatcher',[A]),events=createRouteEventService(s.pool),event=(body:unknown,key=randomUUID())=>{
    return events.execute(dispatcher.token,route.id,s.query,key,['idempotency-key',key],body,randomUUID());};
  const departure=await event({kind:'departure',expected_version:route.version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T04:00:00Z',evidence_ref:randomUUID(),base_eta_at:baseEta});
  if(options.terminalBeforeDelay?.length) {
    await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
    for(const [index,status] of options.terminalBeforeDelay.entries())await s.db.adminQuery(
      "UPDATE shipit.parcels SET status=$2,custody=CASE WHEN $2='delivered' THEN 'recipient' ELSE 'route_dispatch' END,version=version+1,last_command_id=NULL WHERE id=$1",
      [parcelIds[index],status]);
    await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  }
  const delayKey=randomUUID(),delayBody={kind:'delay',expected_version:departure.version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T05:00:00Z',evidence_ref:randomUUID(),total_delay_minutes:120};
  const delay=await event(delayBody,delayKey);
  return {booking,parcelIds,route,departure,delay,dispatcher,replayDelay:()=>event(delayBody,delayKey)};
}
export async function applyDelaySource(s:AutomationSetup,eventId:string) {
  const envelope=(await s.db.adminQuery<{envelope:Event}>('SELECT envelope FROM shipit.domain_events WHERE event_id=$1',[eventId])).rows[0]!.envelope;
  const consumer=createNotificationConsumer(s.dependencies);
  await withTransaction(s.pool,tx=>consumer.apply(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:org,
    permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),envelope,false));
}
