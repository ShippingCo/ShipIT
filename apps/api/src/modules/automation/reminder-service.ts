import { randomUUID } from 'node:crypto';
import { DatabaseError,type DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withRouteScope } from '../memberships/service.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import { object,uuid } from '../pricing/validation.ts';
import { idempotencyKey,selection } from '../routes/validation.ts';
import * as routes from '../routes/repository.ts';
import { routeDelayReminderCooldownMinutes } from './delay-types.ts';
import * as repository from './delay-repository.ts';

const policy={id:'route-delayed',version:1} as const;
export function createRouteDelayReminderService(database:DatabasePool,clock?:()=>Date) {
  return {async execute(session:string,routeInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
    const route=uuid(routeInput,'route_id'),q=selection(query),b=object(body,['original_delay_event_id']),original=uuid(b.original_delay_event_id,'event_id');
    const key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation_id:'api.v1.routes.delay.remind',route_id:route,body:{original_delay_event_id:original}});
    return withRouteScope(database,session,q.organizationId,q.franchiseId,'routes.delay.remind',correlation,async scopes=>{
      await routes.active(scopes.command);await routes.load(scopes.command,route,true);
      const prior=await repository.reminderReplay(scopes.command,key);
      if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(!prior.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');return prior.result;}
      const source=await repository.source(scopes.command,original);if(!source||source.route_id!==route)throw new HttpError('RESOURCE_NOT_FOUND');
      const execution=await repository.routeExecution(scopes.command,route);if(!execution||execution.execution_state!=='departed')throw new HttpError('ROUTE_STATE_CONFLICT');
      if((await repository.latestDelay(scopes.command,route))!==original)throw new HttpError('VERSION_CONFLICT');
      if(!await repository.activationExists(scopes.command,policy.id,policy.version))throw new HttpError('TEMPORARILY_UNAVAILABLE');
      const now=clock?.()??new Date();if(await repository.rateLimited(scopes.command,original,now))throw new HttpError('RATE_LIMITED');
      try {
        return await repository.createReminder(scopes.command,{command:randomUUID(),event:randomUUID(),fanout:randomUUID(),route,original,key,fingerprint,now,
          policy:policy.id,version:policy.version,source});
      } catch(error) {
        if(error instanceof DatabaseError&&error.sqlState==='P0041')throw new HttpError('RATE_LIMITED');
        throw error;
      }
    });
  },cooldown_minutes:routeDelayReminderCooldownMinutes};
}
