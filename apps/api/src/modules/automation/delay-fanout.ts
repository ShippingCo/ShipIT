import { randomUUID } from 'node:crypto';
import type { TenantAccess } from '../security/scope.ts';
import type { Event } from '../outbox/types.ts';
import type { NotificationPolicy } from './registry.ts';
import * as repository from './delay-repository.ts';

export async function establishDelayFanout(scope:TenantAccess,event:Event,policy:NotificationPolicy,suppression:string|null) {
  const source=await repository.source(scope,event.event_id);if(!source)throw new Error('NOTIFICATION_SOURCE_UNRESOLVED');
  await repository.insertFanout(scope,{id:randomUUID(),sourceIdentity:event.event_id,sourceKind:'route_delay',originalEvent:event.event_id,reminderEvent:null,
    source,policy:policy.id,version:policy.version,purpose:'route_delay',correlation:event.correlation_id,suppression});
}
