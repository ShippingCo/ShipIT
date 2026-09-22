import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { selection } from '../outbox/service.ts';
import { digest } from '../pricing/idempotency.ts';
import { uuid } from '../pricing/validation.ts';
import { ewayCursorCodec } from '../eway/cursor.ts';
import * as repository from './read-repository.ts';

export function createAutomationReadService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
  const cursors=ewayCursorCodec(createHash('sha256').update('shipit:notification-automation:cursor:v1\0').update(key).digest(),clock);
  return {
    async list(token:string,query:unknown,correlation:string) {
      const q=selection(query,true);return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.consent.read',correlation,async(scope,revision)=>{
        const binding=digest({purpose:'notification.automation',org:q.org,franchise:q.franchise,actor:scope.context.actor.id,revision,limit:q.limit});
        const after=q.cursor?uuid(cursors.decode(q.cursor,binding)):null,rows=await repository.list(scope,after,q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
        return {items:items.map(repository.dto),page:{has_more:more,next_cursor:more?cursors.encode(binding,items.at(-1)!.id):null}};
      });
    },
    async detail(token:string,idInput:unknown,query:unknown,correlation:string) {
      const id=uuid(idInput),q=selection(query);return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.consent.read',correlation,async scope=>{
        const row=await repository.detail(scope,id);if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return repository.dto(row);
      });
    },
    async fanouts(token:string,query:unknown,correlation:string) {
      const q=selection(query,true);return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.consent.read',correlation,async(scope,revision)=>{
        const binding=digest({purpose:'notification.route-delay-fanouts',org:q.org,franchise:q.franchise,actor:scope.context.actor.id,revision,limit:q.limit});
        const after=q.cursor?uuid(cursors.decode(q.cursor,binding)):null,rows=await repository.fanouts(scope,after,q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
        return {items:items.map(repository.fanoutDto),page:{has_more:more,next_cursor:more?cursors.encode(binding,items.at(-1)!.id):null}};
      });
    },
    async fanout(token:string,idInput:unknown,query:unknown,correlation:string) {
      const id=uuid(idInput),q=selection(query);return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.consent.read',correlation,async scope=>{
        const result=await repository.fanout(scope,id);if(!result)throw new HttpError('RESOURCE_NOT_FOUND');
        return {...repository.fanoutDto(result.root),items:result.items};
      });
    },
  };
}
