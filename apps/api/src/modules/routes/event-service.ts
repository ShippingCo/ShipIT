import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError, FieldValidationError } from '../../plugins/errors.ts';
import { withRouteScope } from '../memberships/service.ts';
import { appendRoute } from '../audit/repository.ts';
import { digest, keyDigest } from '../pricing/idempotency.ts';
import { instant } from '../pricing/types.ts';
import { transitForRoute } from '../parcels/service.ts';
import { selection, idempotencyKey, uuid } from './validation.ts';
import { eventCommand } from './event-validation.ts';
import type { RouteEventResult } from './event-types.ts';
import * as routes from './repository.ts';
import * as repository from './event-repository.ts';

export function createRouteEventService(database:DatabasePool) {
  async function execute(session:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
    const id=uuid(idInput,'route_id'),b=eventCommand(body),q=selection(query),op=repository.operationFor(b.kind);
    const key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation_id:'api.v1.'+op,route_id:id,body:b});
    return withRouteScope(database,session,q.organizationId,q.franchiseId,op,correlation,async s=>{
      const now=await routes.active(s.command),previous=await repository.replay(s.command,key);
      if(previous){
        if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
        if(!previous.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
        if(previous.requires_transit&&!s.transit)throw new HttpError('ACTION_FORBIDDEN');
        return structuredClone(previous.result);
      }
      await routes.load(s.command,id,true);
      const manifest=await routes.manifest(s.command,id,b.manifest_id),before=await repository.execution(s.command,id);
      if(before.version!==b.expected_version)throw new HttpError('VERSION_CONFLICT');
      if(!manifest.finalized||manifest.version!==b.manifest_version||before.current_manifest_id!==manifest.id)throw new HttpError('ROUTE_MANIFEST_CONFLICT');
      if(before.state!=='finalized'||(b.kind==='departure'?before.execution_state!=='pending':before.execution_state!=='departed'))throw new HttpError('ROUTE_STATE_CONFLICT');
      if(before.last_effective_at&&Date.parse(b.effective_at)<=before.last_effective_at.getTime())throw new HttpError('VERSION_CONFLICT');
      if(b.kind==='delay'&&b.total_delay_minutes!<before.total_delay_minutes)throw new HttpError('VERSION_CONFLICT');
      const members=await repository.members(s.command,manifest.id);
      if(members.length>1000||members.length!==manifest.parcel_count)throw new HttpError('ROUTE_LIMIT_EXCEEDED');
      if(b.kind==='departure'&&members.some(p=>p.booking_state==='active'&&['booked','checked_in'].includes(p.status)))throw new HttpError('PARCEL_STATE_CONFLICT');
      const eligible=(p:typeof members[number])=>p.booking_state==='active'&&['dispatched','in_transit'].includes(p.status);
      if(b.kind==='departure'&&members.some(p=>eligible(p)&&p.status==='dispatched')&&!s.transit)throw new HttpError('ACTION_FORBIDDEN');
      const base=b.kind==='departure'?b.base_eta_at??null:before.base_eta_at?instant(before.base_eta_at):null;
      const delay=b.total_delay_minutes??before.total_delay_minutes;
      if(base&&new Date(Date.parse(base)+delay*60000).getUTCFullYear()>9999)throw new FieldValidationError('total_delay_minutes','OUT_OF_RANGE');
      const revised=base&&b.kind!=='arrival'?instant(new Date(Date.parse(base)+delay*60000)):null;
      const event=randomUUID(),command=randomUUID(),time=instant(now);
      const result:RouteEventResult={event_id:event,route_id:id,version:before.version+1,manifest_id:manifest.id,manifest_version:manifest.version,
        kind:b.kind,effective_at:b.effective_at,updated_count:members.filter(eligible).length,skipped_count:members.filter(p=>!eligible(p)).length,
        eta:{state:b.kind==='arrival'?'arrived':revised?'available':'unavailable',base_at:base,revised_at:revised,total_delay_minutes:delay}};
      await repository.reserve(s.command,command,id,key,fingerprint,b,time);
      for(const p of members){
        const reason=eligible(p)?null:['delivered','rto'].includes(p.status)?'terminal':p.booking_state!=='active'?'booking_inactive':'ineligible_state';
        const parcelEvent=!reason&&b.kind==='departure'&&p.status==='dispatched'
          ?await transitForRoute(s.transit!,s.parcelEvents!,p.parcel_id,id,event,time):null;
        await repository.effect(s.command,result,command,p.parcel_id,p.booking_id,p.status,reason,parcelEvent);
      }
      await repository.revise(s.command,id,command,b,time);
      const after=await routes.load(s.command,id);
      await appendRoute(s.audit!,id,command,event);
      await routes.appendEvent(s.events!,after,command,event,b.kind==='departure'?'route.departed':b.kind==='arrival'?'route.arrived':'route.delayed',time,
        {manifest_id:manifest.id,affected_set_ref:event});
      await repository.finish(s.command,command,result);
      return result;
    });
  }
  async function read(session:string,idInput:unknown,query:unknown,correlation:string) {
    const id=uuid(idInput,'route_id'),q=selection(query);
    return withRouteScope(database,session,q.organizationId,q.franchiseId,'routes.read',correlation,async s=>{
      const route=await routes.load(s.command,id);
      return {route_id:id,version:route.version,latest:await repository.latest(s.command,id)};
    });
  }
  async function detail(session:string,idInput:unknown,eventInput:unknown,query:unknown,correlation:string) {
    const id=uuid(idInput,'route_id'),event=uuid(eventInput,'event_id'),q=selection(query);
    return withRouteScope(database,session,q.organizationId,q.franchiseId,'routes.read',correlation,async s=>{
      await routes.load(s.command,id);return repository.detail(s.command,id,event);
    });
  }
  return {execute,read,detail};
}
