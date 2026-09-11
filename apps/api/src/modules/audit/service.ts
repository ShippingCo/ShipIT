import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { withAuditScope } from '../memberships/service.ts';
import { HttpError } from '../../plugins/errors.ts';
import { filterInput } from './validation.ts';
import { auditCursorCodec } from './cursor.ts';
import * as repository from './repository.ts';

export function createAuditService(database:DatabasePool,key:Buffer) {
  const codec=auditCursorCodec(key);
  return {async list(sessionToken:string,input:unknown,correlationId:string) {
    const filter=filterInput(input);
    return withAuditScope(database,sessionToken,filter.organizationId,correlationId,async (scope,revision)=>{
      const c=scope.context;
      if(filter.franchiseId && !c.organizationWide && !c.permittedFranchiseIds.includes(filter.franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');
      const binding=createHash('sha256').update(JSON.stringify({actor:c.actor,organization:c.organizationId,
        franchises:c.permittedFranchiseIds,organizationWide:c.organizationWide,revision,
        filter:{...filter,cursor:null},sort:'occurred_at_desc',version:1})).digest('hex');
      const boundary=filter.cursor?codec.decode(filter.cursor,binding):null;
      const rows=await repository.list(scope,filter,boundary);
      if(!boundary&&!rows.length&&(filter.resourceId||filter.franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');
      const hasMore=rows.length>filter.limit,visible=rows.slice(0,filter.limit),last=visible.at(-1);
      // Explicit public projection: never spread database rows or include free text.
      const items=visible.map(r=>({id:r.id,organization_id:r.organization_id,franchise_ids:r.franchise_ids,
        actor:{type:r.actor_type,id:r.actor_id},action:r.action,resource:{type:r.resource_type,id:r.resource_id},
        result:r.result,reason_code:r.reason_code,correlation_id:r.correlation_id,occurred_at:r.occurred_at,
        changes:{previous_lifecycle:r.previous_lifecycle,new_lifecycle:r.new_lifecycle,committed_version:r.committed_version,role:r.role}}));
      return {items,page:{has_more:hasMore,next_cursor:hasMore&&last?codec.encode(binding,{time:last.occurred_at,id:last.id}):null}};
    });
  }};
}
