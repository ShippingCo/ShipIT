import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withLotScope} from '../memberships/service.ts';
import {scopedQuery} from '../security/scope.ts';
import {object} from '../pricing/validation.ts';
import {selection,uuid,idempotencyKey} from './validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import type {WhatsappDependencies} from '../whatsapp/types.ts';
import {enqueueMessage} from '../whatsapp/outbound-enqueue.ts';
import * as repository from './repository.ts';

interface Result {id:string;queued:number;suppressed:number;failed:number;unavailable:number}
export function createLotMessages(database:DatabasePool,deps?:WhatsappDependencies){
 return async(session:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],input:unknown,correlation:string)=>{
  const id=uuid(idInput,'lot_id'),selected=selection(query),b=object(input,['text']);
  if(typeof b.text!=='string'||!b.text.trim()||b.text.length>4096||Array.from(b.text).some(c=>c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c)))throw new FieldValidationError('$','INVALID_FORMAT');
  const text=b.text.trim(),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({lot_id:id,text});
  return withLotScope(database,session,selected.organizationId,selected.franchiseId,'lots.update',correlation,async s=>{
   await repository.active(s.command);const lot=await repository.load(s.command,id,true);
   if(lot.state!=='active')throw new HttpError('LOT_STATE_CONFLICT');
   const prior=(await scopedQuery<{fingerprint:string;result:Result}>(s.command,['lots.update'],`SELECT fingerprint,result FROM shipit.lot_message_requests
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[s.command.context.actor.id,key])).rows[0];
   if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
   if(!deps?.configuration.webhook)throw new HttpError('TEMPORARILY_UNAVAILABLE');
   const targets=(await scopedQuery<{parcel_id:string;customer_id:string}>(s.command,['lots.update'],`SELECT p.id AS parcel_id,b.customer_id FROM shipit.lot_memberships m
    JOIN shipit.parcels p ON p.organization_id=m.organization_id AND p.franchise_id=m.franchise_id AND p.id=m.parcel_id
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.lot_id=$1 AND m.ended_at IS NULL
      AND p.status NOT IN ('delivered','rto') ORDER BY p.id LIMIT 1001`,[id])).rows;
   if(targets.length>1000)throw new FieldValidationError('$','OUT_OF_RANGE');
   const requestId=randomUUID(),result:Result={id:requestId,queued:0,suppressed:0,failed:0,unavailable:lot.planning_entry_ids?.length??0};
   await scopedQuery(s.command,['lots.update'],`INSERT INTO shipit.lot_message_requests(id,organization_id,franchise_id,lot_id,actor_id,key_digest,fingerprint,targets,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[requestId,selected.franchiseId,id,s.command.context.actor.id,key,fingerprint,JSON.stringify(targets),correlation,selected.organizationId]);
   for(const target of targets){
    const message=await enqueueMessage(s.outbound!,deps,{source_kind:'event',source_id:requestId,affected_entity_id:target.parcel_id,customer_id:target.customer_id,purpose:'updates',format:'text',text});
    if(message.state==='queued')result.queued++;else if(message.state==='suppressed')result.suppressed++;else result.failed++;
   }
   await scopedQuery(s.command,['lots.update'],`UPDATE shipit.lot_message_requests SET result=$2 WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[requestId,result]);
   return result;
  });
 };
}
