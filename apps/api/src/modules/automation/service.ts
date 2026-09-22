import { createHash,randomUUID } from 'node:crypto';
import type { TenantAccess } from '../security/scope.ts';
import type { Consumer,Event } from '../outbox/types.ts';
import { enqueueMessage } from '../whatsapp/outbound-enqueue.ts';
import type { AutomationPolicyBinding,WhatsappDependencies } from '../whatsapp/types.ts';
import { notificationConsumerId,notificationSubscriptions,policyBindings,policyFor,validateNotificationEvent } from './registry.ts';
import * as repository from './repository.ts';
import type { DecisionOutcome,ResolvedNotification } from './types.ts';
import { establishDelayFanout } from './delay-fanout.ts';

const safe=(value:string)=>value.length&&value.length<=1024&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
function semantic(event:Event,resolved:ResolvedNotification,kind:string) {
  return createHash('sha256').update(JSON.stringify([event.organization_id,event.franchise_id,resolved.canonical_event_id,kind,
    resolved.affected_entity_id,resolved.customer_id])).digest('hex');
}
async function resolved(scope:TenantAccess,event:Event) {
  if(event.event_type==='booking.created')return repository.booking(scope,event);
  if(event.event_type==='parcel.checked_in')return repository.parcel(scope,event,'checked_in');
  if(event.event_type==='parcel.dispatched')return repository.parcel(scope,event,'dispatched');
  if(event.event_type==='parcel.in_transit')return repository.transit(scope,event);
  return repository.route(scope,event);
}
function variables(binding:AutomationPolicyBinding,item:ResolvedNotification) {
  const values=binding.variables.map(name=>item.values[name]);
  if(values.some(value=>typeof value!=='string'||!safe(value)))throw new Error('NOTIFICATION_VARIABLE_RESOLUTION_FAILED');
  return values as string[];
}
export function createNotificationConsumer(dependencies:WhatsappDependencies):Consumer {
  const bindings=policyBindings(dependencies.configuration.automation?.policies??[]);
  async function apply(scope:TenantAccess,event:Event,stale:boolean) {
    const policy=policyFor(event.event_type);if(!policy)throw new Error('NOTIFICATION_POLICY_MISSING');
    const activation=await repository.activation(scope,policy.id,policy.version);if(!activation)throw new Error('NOTIFICATION_POLICY_NOT_ACTIVATED');
    if(event.event_type==='route.delayed') {
      const suppression=stale?'stale_aggregate_event':new Date(event.occurred_at)<activation.activated_at?'historical_cutover':null;
      await establishDelayFanout(scope,event,policy,suppression);return;
    }
    const items=await resolved(scope,event);if(!items.length)throw new Error('NOTIFICATION_SOURCE_UNRESOLVED');
    const binding=bindings.get(`${policy.id}:${policy.version}`);
    const install=binding&&policy.notify?await repository.installationAvailable(scope):false;
    for(const item of items) {
      if(await repository.decided(scope,event.event_id,policy.id,policy.version,item.affected_entity_id))continue;
      let outcome:DecisionOutcome,reason:string,outbound:string|null=null;
      if(stale){outcome='skipped';reason='stale_aggregate_event';}
      else if(new Date(event.occurred_at)<activation.activated_at){outcome='skipped';reason='historical_cutover';}
      else if(!item.relevant){reason=item.reason_code;outcome=reason==='overlapping_route_cause'?'suppressed':'skipped';}
      else if(!item.customer_id){outcome='skipped';reason='recipient_unavailable';}
      else if(!item.contact_current){outcome='skipped';reason='recipient_contact_changed';}
      else if(!binding){outcome='blocked';reason='policy_binding_missing';}
      else if(!install){outcome='blocked';reason='installation_unavailable';}
      else {
        const queued=await enqueueMessage(scope,dependencies,{source_kind:'event',source_id:event.event_id,affected_entity_id:item.affected_entity_id,
          customer_id:item.customer_id,purpose:'updates',format:'template',template_name:binding.template_name,
          template_language:binding.template_language,variables:variables(binding,item)});
        outbound=queued.id;
        if(queued.state==='suppressed'){outcome='suppressed';reason=queued.reason_code;}
        else if(queued.state==='failed'){outcome='blocked';reason=queued.reason_code;}
        else {outcome='queued';reason=queued.state==='queued'?'eligible':'outbound_already_enqueued';}
      }
      await repository.record(scope,{id:randomUUID(),event,policy:policy.id,version:policy.version,resolved:item,kind:policy.kind,
        semantic:semantic(event,item,policy.kind),outcome,reason,outbound});
    }
  }
  return {id:notificationConsumerId,subscriptions:notificationSubscriptions,ordering:'M',validate:validateNotificationEvent,
    reconcileGap:repository.reconcileGap,
    apply:(scope,event)=>apply(scope,event,false),applyStale:(scope,event)=>apply(scope,event,true)};
}
