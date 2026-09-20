import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withOutboxScope } from '../memberships/service.ts';
import { object,integer,uuid } from '../pricing/validation.ts';
import { idempotencyKey } from '../customers/validation.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import { ewayCursorCodec } from '../eway/cursor.ts';
import { jobDto } from './types.ts';
import { lockJob } from './repository.ts';
import * as operations from './operations.ts';

export function selection(input:unknown,paged=false) {
  const q=object(input,['organization_id','franchise_id',...(paged?['limit','cursor']:[])]);
  if(q.limit!==undefined&&(typeof q.limit!=='string'||!/^[1-9][0-9]{0,2}$/.test(q.limit)||Number(q.limit)>100))throw new HttpError('VALIDATION_FAILED');
  if(q.cursor!==undefined&&(typeof q.cursor!=='string'||!q.cursor.length||q.cursor.length>4096))throw new HttpError('CURSOR_INVALID');
  return {org:uuid(q.organization_id,'organization_id'),franchise:uuid(q.franchise_id,'franchise_id'),
    limit:q.limit===undefined?50:Number(q.limit),cursor:q.cursor as string|undefined};
}
export function redriveInput(input:unknown) {
  const b=object(input,['expected_version','reason_code']);
  if(!['dependency_repaired','consumer_upgraded','ordering_reconciled'].includes(String(b.reason_code)))throw new HttpError('VALIDATION_FAILED');
  return {version:integer(b.expected_version,'expected_version',1,2147483646),reason:b.reason_code as string};
}
export function createOutboxService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
  // Reuse the authenticated token primitive with a separately derived key and binding.
  const cursors=ewayCursorCodec(createHash('sha256').update('shipit:outbox:cursor:v1\0').update(key).digest(),clock);
  return {
    async health(token:string,query:unknown,correlation:string) {
      const q=selection(query);
      return withOutboxScope(database,token,q.org,q.franchise,'outbox.read',correlation,async scope=>({
        states:await operations.health(scope),recovery_owner:'franchise_admin',runbook:'outbox-quarantine-v1'}));
    },
    async list(token:string,query:unknown,correlation:string) {
      const q=selection(query,true);
      return withOutboxScope(database,token,q.org,q.franchise,'outbox.read',correlation,async(scope,revision)=>{
        const binding=digest({purpose:'outbox.jobs',org:q.org,franchise:q.franchise,actor:scope.context.actor.id,revision,limit:q.limit});
        const after=q.cursor?cursors.decode(q.cursor,binding):null;
        if(after!==null&&!/^[0-9a-f-]{36}$/.test(after))throw new HttpError('CURSOR_INVALID');
        const rows=await operations.list(scope,after,q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
        return {items:items.map(jobDto),page:{has_more:more,next_cursor:more?cursors.encode(binding,items.at(-1)!.id):null}};
      });
    },
    async detail(token:string,idInput:unknown,query:unknown,correlation:string) {
      const id=uuid(idInput,'$'),q=selection(query);
      return withOutboxScope(database,token,q.org,q.franchise,'outbox.read',correlation,async scope=>{
        const value=await operations.detail(scope,id);
        return {job:jobDto(value.job),attempts:value.attempts.map(a=>({...a,occurred_at:a.occurred_at.toISOString()})),history_truncated:value.history_truncated};
      });
    },
    async redrive(token:string,idInput:unknown,query:unknown,keyInput:unknown,body:unknown,correlation:string) {
      const id=uuid(idInput,'$'),q=selection(query),input=redriveInput(body),key=keyDigest(idempotencyKey(keyInput));
      const fingerprint=digest({operation:'api.v1.outbox.redrive',id,...input});
      return withOutboxScope(database,token,q.org,q.franchise,'outbox.redrive',correlation,async scope=>{
        await operations.active(scope);
        const job=await lockJob(scope,id);if(!job)throw new HttpError('RESOURCE_NOT_FOUND');
        const prior=await operations.replay(scope,key,fingerprint);if(prior)return prior;
        return operations.redrive(scope,id,key,fingerprint,input.version,input.reason);
      });
    },
  };
}
