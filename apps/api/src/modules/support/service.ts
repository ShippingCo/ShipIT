import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { scopedQuery } from '../security/scope.ts';
import { uuid,object,idempotencyKey } from '../pricing/validation.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';
import { commandInput,availability } from './rules.ts';
import { enqueue } from './notifications.ts';
import * as repository from './repository.ts';
const selection=(value:unknown)=>{const b=object(value,['organization_id','franchise_id','after']);return {org:uuid(b.organization_id),franchise:uuid(b.franchise_id),after:b.after===undefined?null:uuid(b.after)};};
export function createSupportService(database:DatabasePool,deps:WhatsappDependencies) {
 return {
  async list(token:string,query:unknown,correlation:string) {
   const q=selection(query);return withWhatsappScope(database,token,q.org,q.franchise,'support.read',correlation,async scope=>{
    const rows=(await scopedQuery<repository.Case>(scope,['support.read'],`SELECT c.* FROM shipit.support_cases c WHERE {{franchise:c.organization_id:c.franchise_id}} AND ($1::uuid IS NULL OR c.id>$1) ORDER BY c.id LIMIT 51`,[q.after])).rows;
    return {items:rows.slice(0,50).map(repository.summary),next:rows.length>50?rows[49]!.id:null};
   });
  },
  async detail(token:string,id:string,query:unknown,correlation:string) {
   uuid(id);const q=selection(query);return withWhatsappScope(database,token,q.org,q.franchise,'support.read',correlation,async scope=>{
    const c=await repository.get(scope,id);if(!c)throw new HttpError('RESOURCE_NOT_FOUND');
    const events=(await scopedQuery<{id:string;event_type:string;reason:string;actor_id:string;actor_type:string;occurred_at:Date;sealed_payload:string|null;key_version:string|null;message_state:string|null;message_reason:string|null;attempts:number|null}>(scope,['support.read'],`SELECT e.id,e.event_type,e.reason,e.actor_id,e.actor_type,e.occurred_at,e.sealed_payload,e.key_version,m.state AS message_state,m.reason_code AS message_reason,m.attempts
     FROM shipit.support_events e LEFT JOIN shipit.whatsapp_outbound m ON m.organization_id=e.organization_id AND m.franchise_id=e.franchise_id AND m.support_event_id=e.id
     WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.case_id=$1 ORDER BY e.version DESC LIMIT 50`,[id])).rows;
    const context=(await scopedQuery<{intent:string;outcome:string;recorded_at:Date}>(scope,['support.read'],`SELECT t.intent,t.outcome,t.recorded_at FROM shipit.customer_conversation_turns t WHERE {{franchise:t.organization_id:t.franchise_id}} AND t.conversation_id=$1 ORDER BY t.recorded_at DESC LIMIT 20`,[c.conversation_id])).rows;
    const staff=(await scopedQuery<{id:string}>(scope,['support.read'],`SELECT DISTINCT m.user_id AS id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
     WHERE {{franchise:s.organization_id:s.franchise_id}} AND m.lifecycle='active' AND m.role IN ('franchise_admin','operator') ORDER BY m.user_id LIMIT 100`)).rows;
    return {...repository.summary(c),parcel_id:c.parcel_id,current_actor_id:scope.context.actor.id,staff,
     availability:availability(deps.configuration.support_hours?.find(h=>h.franchise_id===q.franchise),new Date()),
     history:events.map(e=>({id:e.id,action:e.event_type,reason:e.reason,actor_id:e.actor_id,actor_type:e.actor_type,occurred_at:e.occurred_at.toISOString(),text:repository.privateText(deps,e),message_state:e.message_state,message_reason:e.message_reason,attempts:e.attempts})),
     context:context.map(t=>({...t,recorded_at:t.recorded_at.toISOString()}))};
   });
  },
  async command(token:string,id:string,query:unknown,key:unknown,input:unknown,correlation:string) {
   uuid(id);const q=selection(query),b=commandInput(input),hash=keyDigest(idempotencyKey(key)),fingerprint=digest({id,...b});
   return withWhatsappScope(database,token,q.org,q.franchise,'support.write',correlation,async scope=>{
    if(!deps.configuration.support_enabled||!deps.configuration.webhook)throw new HttpError('TEMPORARILY_UNAVAILABLE');
    if(!(await scopedQuery(scope,['support.write'],`SELECT f.id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} AND f.lifecycle='active'`)).rows.length)throw new HttpError('ACTION_FORBIDDEN');
    await scopedQuery(scope,['support.write'],`SELECT i.id FROM shipit.whatsapp_installations i WHERE {{franchise:i.organization_id:i.franchise_id}} ORDER BY i.id FOR UPDATE`);
    const c=await repository.get(scope,id,true);if(!c)throw new HttpError('RESOURCE_NOT_FOUND');
    const actor=scope.context.actor.id;
    const prior=(await scopedQuery<{fingerprint:string;result:ReturnType<typeof repository.summary>}>(scope,['support.write'],`SELECT r.fingerprint,r.result FROM shipit.support_commands r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.actor_id=$1 AND r.key_digest=$2`,[actor,hash])).rows[0];
    if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
    if(c.version!==b.version)throw new HttpError('VERSION_CONFLICT');
    let state=c.state,assigned=c.assigned_staff_id;
    if(b.action==='claim') {if(state!=='open')throw new HttpError('VERSION_CONFLICT');state='claimed';assigned=actor;}
    else if(b.action==='assign') {
     if(state==='resolved')throw new HttpError('VERSION_CONFLICT');
     const target=(await scopedQuery(scope,['support.write'],`SELECT m.id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
      WHERE {{franchise:s.organization_id:s.franchise_id}} AND m.user_id=$1 AND m.lifecycle='active' AND m.role IN ('franchise_admin','operator')`,[b.assigned])).rows[0];
     if(!target)throw new HttpError('RESOURCE_NOT_FOUND');state='claimed';assigned=b.assigned;
    }else if(b.action==='reopen') {if(state!=='resolved'||await repository.active(scope,c.conversation_id))throw new HttpError('VERSION_CONFLICT');state='open';assigned=null;}
    else {if(state!=='claimed'||assigned!==actor)throw new HttpError('ACTION_FORBIDDEN');if(b.action==='resolve')state='resolved';}
    // Do not discard an in-flight/uncertain staff answer by releasing ownership.
    if(['resolve','assign'].includes(b.action)&&(await scopedQuery(scope,['support.write'],`SELECT m.id FROM shipit.whatsapp_outbound m WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.affected_entity_id=$1 AND m.source_kind='support' AND m.state IN ('queued','retry_wait','dispatching','uncertain') LIMIT 1`,[id])).rows.length)throw new HttpError('VERSION_CONFLICT');
    const changed=(await scopedQuery<repository.Case>(scope,['support.write'],`UPDATE shipit.support_cases c SET state=$2,assigned_staff_id=$3,version=version+1,updated_at=clock_timestamp() WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 RETURNING *`,[id,state,assigned])).rows[0]!;
    const types={claim:'claimed',assign:'assigned',respond:'responded',note:'noted',resolve:'resolved',reopen:'reopened'};
    const event=await repository.event(scope,changed,types[b.action],b.reason,deps,b.text);
    if(b.action==='respond')await enqueue(scope,deps,changed,event,b.text!);
    if(['resolve','reopen'].includes(b.action))await scopedQuery(scope,['support.write'],`UPDATE shipit.customer_conversations c SET state=$2,selected_docket=NULL,pending_intent=NULL,version=version+1 WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1`,[c.conversation_id,state==='resolved'?'active':'human_requested']);
    const result=repository.summary(changed);
    await scopedQuery(scope,['support.write'],`INSERT INTO shipit.support_commands(organization_id,franchise_id,actor_id,key_digest,fingerprint,case_id,result) SELECT {{organization}},$1,$2,$3,$4,$5,$6 WHERE {{franchise:$7:$1}}`,[q.franchise,actor,hash,fingerprint,id,result,q.org]);
    return result;
   });
  },
 };
}
