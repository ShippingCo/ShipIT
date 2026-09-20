import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withOutboxScope } from '../memberships/service.ts';
import { selection } from '../outbox/service.ts';
import { active } from '../outbox/operations.ts';
import { integer,object,uuid } from '../pricing/validation.ts';
import { idempotencyKey } from '../customers/validation.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import { ewayCursorCodec } from '../eway/cursor.ts';
import * as repository from './outbound-repository.ts';

export function createOutboundService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
 const cursors=ewayCursorCodec(createHash('sha256').update('shipit:outbound:cursor:v1\0').update(key).digest(),clock);
 return {
  async health(token:string,query:unknown,correlation:string) {
   const q=selection(query);return withOutboxScope(database,token,q.org,q.franchise,'outbox.read',correlation,async scope=>({
    states:await repository.health(scope),recovery_owner:'franchise_admin',runbook:'whatsapp-outbound-v1'}));
  },
  async list(token:string,query:unknown,correlation:string) {
   const q=selection(query,true);return withOutboxScope(database,token,q.org,q.franchise,'outbox.read',correlation,async(scope,revision)=>{
    const binding=digest({purpose:'whatsapp.outbound',org:q.org,franchise:q.franchise,actor:scope.context.actor.id,revision,limit:q.limit});
    const after=q.cursor?uuid(cursors.decode(q.cursor,binding)):null;
    const rows=await repository.list(scope,after,q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
    return {items:items.map(repository.safeMessage),page:{has_more:more,next_cursor:more?cursors.encode(binding,items.at(-1)!.id):null}};
   });
  },
  async detail(token:string,id:string,query:unknown,correlation:string) {
   uuid(id);const q=selection(query);return withOutboxScope(database,token,q.org,q.franchise,'outbox.read',correlation,async scope=>{
    const detail=await repository.detail(scope,id);if(!detail)throw new HttpError('RESOURCE_NOT_FOUND');return detail;
   });
  },
  async redrive(token:string,id:string,query:unknown,keyInput:string,body:unknown,correlation:string) {
   uuid(id);const q=selection(query),b=object(body,['expected_version','reason_code']);
   const version=integer(b.expected_version,'expected_version',1,2147483646);
   if(!['dependency_repaired','retry_uncertain_confirmed'].includes(String(b.reason_code)))throw new HttpError('VALIDATION_FAILED');
   const reason=b.reason_code as string,keyHash=keyDigest(idempotencyKey(keyInput)),fingerprint=digest({id,version,reason});
   return withOutboxScope(database,token,q.org,q.franchise,'outbox.redrive',correlation,async scope=>{
    await active(scope);const m=await repository.lock(scope,id);if(!m)throw new HttpError('RESOURCE_NOT_FOUND');
    const prior=await repository.replay(scope,keyHash);
    if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:prior.intent_id,version:prior.version,state:'queued'};}
    const observed=await repository.observation(scope,id),now=clock();
    if(m.version!==version||!['failed','uncertain'].includes(m.state)||!m.sealed_payload||m.expires_at<=now||observed.progress>=2||
      (m.state==='uncertain')!==(reason==='retry_uncertain_confirmed'))throw new HttpError('VERSION_CONFLICT');
    const updated=await repository.update(scope,m,'queued','redriven',now,{reset:true});
    await repository.redriveReceipt(scope,updated,keyHash,fingerprint,reason);
    return {id,version:updated.version,state:'queued'};
   });
  },
 };
}
