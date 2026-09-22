import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { enqueueMessage } from '../whatsapp/outbound-enqueue.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';
import { withNextRouteDelayFanoutScope } from '../security/jobs.ts';
import { policyBindings } from './registry.ts';
import { routeDelayBatchSize,type DelayFanoutCandidate,type DelayFanoutOutcome,type DelayFanoutRow } from './delay-types.ts';
import * as repository from './delay-repository.ts';

function relevance(root:DelayFanoutRow,item:DelayFanoutCandidate):{outcome:DelayFanoutOutcome;reason:string}|null {
  if(root.source_suppression_reason)return {outcome:'skipped',reason:root.source_suppression_reason};
  if(item.source_outcome==='skipped')return {outcome:'skipped',reason:item.source_skip_reason??'source_ineligible'};
  if(['delivered','rto'].includes(item.status))return {outcome:'skipped',reason:'terminal'};
  if(item.booking_state!=='active')return {outcome:'skipped',reason:'booking_inactive'};
  if(!['dispatched','in_transit'].includes(item.status)||item.execution_state!=='departed'||item.latest_delay_event_id!==root.original_event_id)
    return {outcome:'skipped',reason:'state_superseded'};
  if(!item.customer_id)return {outcome:'skipped',reason:'recipient_unavailable'};
  if(!item.contact_current)return {outcome:'skipped',reason:'recipient_contact_changed'};
  return null;
}
export function routeDelayVariables(names:readonly string[],item:Pick<DelayFanoutCandidate,'docket'|'effective_at'|'revised_eta_at'>) {
  return names.map(name=>{
    if(name==='docket')return item.docket;
    if(name==='effective_at'&&item.effective_at)return item.effective_at.toISOString();
    if(name==='revised_eta_at')return item.revised_eta_at?.toISOString()??'unavailable';
    throw new Error('ROUTE_DELAY_VARIABLE_UNRESOLVED');
  });
}
export function createRouteDelayFanoutWorker(database:DatabasePool,dependencies:WhatsappDependencies,options:{afterItem?:(count:number)=>void}={}) {
  const bindings=policyBindings(dependencies.configuration.automation?.policies??[]);let processed=0;
  async function one() {
    return withNextRouteDelayFanoutScope(database,dependencies.clock?.()??new Date(),async(scope,id)=>{
      const root=await repository.lockFanout(scope,id);if(!root)return false;
      const item=await repository.candidate(scope,root);if(!item)throw new Error('ROUTE_DELAY_FANOUT_SOURCE_INCOMPLETE');
      let decided=relevance(root,item),outbound:string|null=null;
      if(!decided) {
        const binding=bindings.get(`${root.policy_id}:${root.policy_version}`);
        if(!binding)decided={outcome:'blocked',reason:'policy_binding_missing'};
        else {
          const queued=await enqueueMessage(scope,dependencies,{source_kind:'event',source_id:root.source_identity_id,affected_entity_id:item.parcel_id,
            customer_id:item.customer_id!,purpose:'updates',format:'template',template_name:binding.template_name,template_language:binding.template_language,
            variables:routeDelayVariables(binding.variables,item)});
          outbound=queued.id;decided=queued.state==='suppressed'?{outcome:'suppressed',reason:queued.reason_code}:
            queued.state==='failed'?{outcome:'blocked',reason:queued.reason_code}:{outcome:'queued',reason:queued.state==='queued'?'eligible':'outbound_already_enqueued'};
        }
      }
      await repository.recordItem(scope,root,item,{id:randomUUID(),...decided,outbound,etaEvent:item.eta_event_id});return true;
    });
  }
  async function tick(limit=routeDelayBatchSize) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>routeDelayBatchSize)throw new Error('ROUTE_DELAY_BATCH_INVALID');
    let count=0;for(;count<limit;count++){if(!await one())break;processed++;options.afterItem?.(processed);}return count;
  }
  return {tick};
}
