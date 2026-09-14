import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { createRouteService } from '../src/modules/routes/service.ts';
import { org,A } from './audit-support.ts';
export const routeMetadata={origin:'Synthetic Origin',destination:'Synthetic Destination',mode:'road',carrier_code:'SYN-27',scheduled_departure_at:'2099-01-01T09:00:00+05:30'};
export async function finalizedManifest(pool:DatabasePool,key:Buffer,token:string,parcelIds:string[],organization=org,franchise=A) {
  const service=createRouteService(pool,key),q={organization_id:organization,franchise_id:franchise};
  const run=(id:string|null,body:unknown,op:Parameters<typeof service.execute>[7])=>{const k=randomUUID();return service.execute(token,id,null,q,k,['idempotency-key',k],body,op,randomUUID());};
  let route=await run(null,routeMetadata,'routes.create');
  for(const parcel_id of parcelIds)route=await run(route.id,{parcel_id,expected_version:route.version},'routes.parcel.attach');
  return (await run(route.id,{expected_version:route.version},'routes.finalize')).current_manifest_id;
}

/** Pre-#27 producer fixture: the released T03 sequence, deliberately without
 * Route validation. It writes real command/history/audit/event rows under the
 * old schema and also proves the new DB rejects this old producer for new work. */
export async function legacyDispatch(pool:DatabasePool,token:string,parcel:string,key:string,input:{expected_version:number;evidence_ref:string;manifest_id:string}) {
  const {withParcelCommandScope}=await import('../src/modules/memberships/service.ts');
  const repository=await import('../src/modules/parcels/repository.ts');
  const {fingerprint,keyDigest}=await import('../src/modules/parcels/idempotency.ts');
  const {instant}=await import('../src/modules/pricing/types.ts');
  return withParcelCommandScope(pool,token,org,A,'parcels.dispatch',randomUUID(),async scopes=>{
    const before=await repository.load(scopes.command,parcel);
    if(before.status!=='checked_in'||before.version!==input.expected_version)throw new Error('Invalid legacy fixture');
    const commandId=randomUUID(),eventId=randomUUID(),time=instant(await repository.databaseNow(scopes.command));
    await repository.reserve(scopes.command,commandId,before,'parcels.dispatch',keyDigest(key),fingerprint('parcels.dispatch',parcel,input),input);
    const after=await repository.mutate(scopes.command,before,commandId,'parcels.dispatch',time);if(!after)throw new Error('Legacy fixture conflict');
    await repository.appendTransition(scopes.command,commandId,eventId,before,after,'parcels.dispatch',input,time);
    await repository.appendEvent(scopes.events,commandId,eventId,after,'parcels.dispatch',input,time);
    const result={id:after.id,booking_id:after.booking_id,docket:after.docket,version:after.version,status:after.status,custody:after.custody,
      attempts_started:after.attempts_started,failed_attempt_count:after.failed_attempt_count,event_id:eventId,transitioned_at:time};
    await repository.complete(scopes.command,commandId,result);return result;
  });
}
