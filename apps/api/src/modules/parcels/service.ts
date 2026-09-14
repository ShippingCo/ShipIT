import { dispatchManifest } from '../routes/repository.ts';
import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withParcelCommandScope } from '../memberships/service.ts';
import { parcelId,selection,idempotencyKey } from '../bookings/validation.ts';
import { instant } from '../pricing/types.ts';
import { command } from './validation.ts';
import { fingerprint,keyDigest } from './idempotency.ts';
import type { ParcelCommandInput,ParcelLifecycleRow,ParcelOperation,ParcelTransitionDto } from './types.ts';
import * as repository from './repository.ts';

const source:Readonly<Record<ParcelOperation,string>>={
  'parcels.check_in':'booked','parcels.dispatch':'checked_in','parcels.transit':'dispatched',
  'parcels.fail_delivery':'out_for_delivery','parcels.approve_rto':'failed_attempt',
};
const retryReasons=new Set(['customer_unavailable','address_issue','payment_not_collected','operational_issue']);
function guard(parcel:ParcelLifecycleRow,operation:ParcelOperation,input:ParcelCommandInput,actorId:string) {
  if(parcel.version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
  if(parcel.status!==source[operation])throw new HttpError('PARCEL_STATE_CONFLICT');
  if(operation==='parcels.fail_delivery'&&
    (parcel.active_attempt_id!==input.attempt_id||parcel.assigned_agent_id!==actorId||parcel.attempts_started<1||
      parcel.attempts_started>2||parcel.failed_attempt_count!==parcel.attempts_started-1))throw new HttpError('PARCEL_STATE_CONFLICT');
}
function dto(row:ParcelLifecycleRow,eventId:string,time:string,input:ParcelCommandInput):ParcelTransitionDto {
  return {id:row.id,booking_id:row.booking_id,docket:row.docket,version:row.version,status:row.status,custody:row.custody,
    attempts_started:row.attempts_started,failed_attempt_count:row.failed_attempt_count,event_id:eventId,transitioned_at:time,
    ...(input.reason_code?{reason_code:input.reason_code}:{})};
}
export function createParcelService(database:DatabasePool,clock?:()=>Date) {
  async function execute(session:string,parcelInput:unknown,query:unknown,keyInput:unknown,rawHeaders:readonly string[],bodyInput:unknown,
    operation:ParcelOperation,correlation:string) {
    const id=parcelId(parcelInput),selected=selection(query),body=command(operation,bodyInput);
    const key=keyDigest(idempotencyKey(keyInput,rawHeaders)),intent=fingerprint(operation,id,body);
    return withParcelCommandScope(database,session,selected.organizationId,selected.franchiseId,operation,correlation,async scopes=>{
      const previous=await repository.replay(scopes.command,id,operation,key,intent);if(previous)return previous;
      const before=await repository.load(scopes.command,id);
      if(operation==='parcels.dispatch')await dispatchManifest(scopes.command,body.manifest_id!,id);
      guard(before,operation,body,scopes.command.context.actor.id);
      if(operation==='parcels.approve_rto'&&!body.override_reason_code){
        const last=await repository.lastFailureReason(scopes.command,id);
        if(before.failed_attempt_count!==2||!retryReasons.has(last??''))throw new HttpError('RTO_NOT_ELIGIBLE');
      }
      const commandId=randomUUID(),eventId=randomUUID(),time=instant(clock?clock():await repository.databaseNow(scopes.command));
      await repository.reserve(scopes.command,commandId,before,operation,key,intent,body);
      const after=await repository.mutate(scopes.command,before,commandId,operation,time);
      if(!after)throw new HttpError('VERSION_CONFLICT');
      await repository.appendTransition(scopes.command,commandId,eventId,before,after,operation,body,time);
      if(operation==='parcels.fail_delivery')await repository.appendFailure(scopes.command,commandId,eventId,after,body,time);
      if(operation==='parcels.approve_rto')await repository.appendRto(scopes.command,commandId,eventId,after,body,time);
      await repository.appendEvent(scopes.events,commandId,eventId,after,operation,body,time);
      const result=dto(after,eventId,time,body);await repository.complete(scopes.command,commandId,result);return result;
    });
  }
  return {execute};
}
