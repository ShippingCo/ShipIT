import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {withRouteScope} from '../memberships/service.ts';
import {scopedQuery} from '../security/scope.ts';
import {object} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {enqueueMessage} from '../whatsapp/outbound-enqueue.ts';
import type {WhatsappDependencies} from '../whatsapp/types.ts';
import {uuid,selection,idempotencyKey} from './validation.ts';
import * as repository from './repository.ts';
interface Result{id:string;queued:number;suppressed:number;failed:number;unavailable:number}
export function createRouteMessages(database:DatabasePool,deps?:WhatsappDependencies){
 return async(session:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],input:unknown,correlation:string)=>{
  const id=uuid(idInput,'route_id'),q=selection(query),b=object(input,['text']);
  if(typeof b.text!=='string'||!b.text.trim()||b.text.length>4096||Array.from(b.text).some(c=>c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c)))throw new FieldValidationError('$','INVALID_FORMAT');
  const text=b.text.trim(),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({route_id:id,text});
  return withRouteScope(database,session,q.organizationId,q.franchiseId,'routes.update',correlation,async s=>{
   await repository.active(s.command);const route=await repository.load(s.command,id,true);
   if(route.state==='archived')throw new HttpError('ROUTE_STATE_CONFLICT');
   const prior=(await scopedQuery<{fingerprint:string;result:Result}>(s.command,['routes.update'],`SELECT fingerprint,result FROM shipit.route_message_requests WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[s.command.context.actor.id,key])).rows[0];
   if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
   const targets=(await scopedQuery<{parcel_id:string;customer_id:string}>(s.command,['routes.update'],`SELECT DISTINCT ON (b.customer_id) p.id AS parcel_id,b.customer_id FROM shipit.route_manifest_parcels m
    JOIN shipit.parcels p ON p.organization_id=m.organization_id AND p.franchise_id=m.franchise_id AND p.id=m.parcel_id
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.route_id=$1 AND m.manifest_id=$2 AND b.state='active'
      AND p.status NOT IN ('delivered','rto') ORDER BY b.customer_id,p.id LIMIT 1001`,[id,route.current_manifest_id])).rows;
   if(targets.length&&!deps?.configuration.webhook)throw new HttpError('TEMPORARILY_UNAVAILABLE');
   if(targets.length>1000)throw new FieldValidationError('$','OUT_OF_RANGE');
   const planned=(await scopedQuery<{id:string}>(s.command,['routes.update'],`SELECT DISTINCT b.id FROM shipit.counter_bookings b
     WHERE {{franchise:b.organization_id:b.franchise_id}} AND (b.id=ANY($2::uuid[]) OR EXISTS(
       SELECT 1 FROM shipit.lots l WHERE l.organization_id=b.organization_id AND l.franchise_id=b.franchise_id AND l.state='active'
         AND (SELECT c.input->>'planning_route_id' FROM shipit.lot_commands c WHERE c.organization_id=l.organization_id AND c.franchise_id=l.franchise_id AND c.lot_id=l.id AND c.input ? 'planning_route_id' ORDER BY COALESCE(c.expected_version,0) DESC LIMIT 1)=$1
         AND (SELECT c.input->'planning_entry_ids' FROM shipit.lot_commands c WHERE c.organization_id=l.organization_id AND c.franchise_id=l.franchise_id AND c.lot_id=l.id AND c.input ? 'planning_entry_ids' ORDER BY COALESCE(c.expected_version,0) DESC LIMIT 1) ? b.id::text))`,[id,route.planning_entry_ids??[]])).rows;
   const request=randomUUID(),result:Result={id:request,queued:0,suppressed:0,failed:0,unavailable:planned.length};
   await scopedQuery(s.command,['routes.update'],`INSERT INTO shipit.route_message_requests(id,organization_id,franchise_id,route_id,actor_id,key_digest,fingerprint,targets,correlation_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[request,q.franchiseId,id,s.command.context.actor.id,key,fingerprint,JSON.stringify(targets),correlation,q.organizationId]);
   for(const target of targets){const message=await enqueueMessage(s.outbound!,deps!,{source_kind:'event',source_id:request,affected_entity_id:target.parcel_id,customer_id:target.customer_id,purpose:'updates',format:'text',text});
    if(message.state==='queued')result.queued++;else if(message.state==='suppressed')result.suppressed++;else result.failed++;
   }
   await scopedQuery(s.command,['routes.update'],`UPDATE shipit.route_message_requests SET result=$2 WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[request,result]);return result;
  });
 };
}
