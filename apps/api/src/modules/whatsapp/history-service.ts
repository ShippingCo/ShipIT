import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { ewayCursorCodec } from '../eway/cursor.ts';
import { digest } from '../pricing/idempotency.ts';
import { object,uuid } from '../pricing/validation.ts';
import { selection } from '../outbox/service.ts';
import * as delay from '../automation/delay-repository.ts';
import * as automation from '../automation/read-repository.ts';
import * as repository from './history-repository.ts';
import { redriveReason } from './recovery.ts';

export const messageStates=['queued','retry_wait','dispatching','accepted','delivered','read','suppressed','failed','uncertain'] as const;
export const automationStates=['queued','blocked','suppressed','skipped','pending','running','completed','failed'] as const;
export const historyKinds=['updates','requested_assistance','consent_disclosure','delivery_otp','booking_confirmation','parcel_checked_in','parcel_dispatched','route_departed','route_delayed','route_arrived','delivery_attempt_failed','rto_approved','delivery_completed','route_delay','route_delay_reminder'] as const;
export function historySelection(input:unknown,view:repository.HistoryView) {
 const q=object(input,['organization_id','franchise_id','limit','cursor','status','kind','correlation_id','source_id']);
 const {status,kind,correlation_id,source_id,...page}=q;
 if(status!==undefined&&!(view==='messages'?messageStates:automationStates).some(s=>s===status))throw new HttpError('VALIDATION_FAILED');
 if(kind!==undefined&&!historyKinds.some(k=>k===kind))throw new HttpError('VALIDATION_FAILED');
 return {...selection(page,true),filter:{status:status as string??null,kind:kind as string??null,
  correlation:correlation_id===undefined?null:uuid(correlation_id),source:source_id===undefined?null:uuid(source_id)}};
}
const boundaryPattern=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z\|[0-9a-f-]{36}$/;
export function historyDto(row:repository.HistoryRow,permissions:{redrive:boolean},now:Date) {
 const reason=redriveReason(row.state??'',row.rendering_available,row.expires_at??now,row.progress,now);
 return {id:row.id,row_kind:row.row_kind,effective_time:row.effective_time,source_id:row.source_id,source_kind:row.source_kind,
  affected_id:row.affected_id,correlation_id:row.correlation_id,notification_kind:row.notification_kind,
  decision:row.decision_id||row.item_id?{id:row.decision_id??row.item_id!,policy_id:row.policy_id!,policy_version:row.policy_version!,outcome:row.outcome!,reason_code:row.decision_reason!}:null,
  message:row.outbound_id?{id:row.outbound_id,state:row.state!,reason_code:row.reason_code!,version:row.version!,attempt_count:row.attempt_count,
   progress:(['none','sent','delivered','read'] as const)[row.progress]!,failure_observed:row.failure_observed,observed_at:row.observed_at?.toISOString()??null}:null,
  fanout:row.fanout_id?{id:row.fanout_id,route_id:row.route_id!,original_event_id:row.original_event_id!,state:row.fanout_state!,
   total_count:row.total_count!,completed_count:row.completed_count!,skipped_count:row.skipped_count!,failed_count:row.failed_count!}:null,
  recovery:{kind:reason&&permissions.redrive&&row.active?(reason==='retry_uncertain_confirmed'?'investigate_uncertain':'redrive'):'none',
   expected_version:row.version,allowed_reasons:reason&&permissions.redrive&&row.active?[reason]:[]},
 };
}
export function createHistoryService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
 const cursors=ewayCursorCodec(createHash('sha256').update('shipit:message-history:v1\0').update(key).digest(),clock,value=>boundaryPattern.test(value));
 return {
  async list(token:string,view:repository.HistoryView,input:unknown,correlation:string) {
   const q=historySelection(input,view);
   return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.consent.read',correlation,async(scope,revision,permissions)=>{
    const binding=digest({purpose:'message-history',view,org:q.org,franchise:q.franchise,actor:scope.context.actor.id,revision,filter:q.filter,limit:q.limit});
    const boundary=q.cursor?cursors.decode(q.cursor,binding).split('|'):null;
    const rows=await repository.rows(scope,view,q.filter,boundary?{time:boundary[0]!,id:uuid(boundary[1])}:null,q.limit);
    const items=rows.slice(0,q.limit),last=items.at(-1),more=rows.length>q.limit;
    return {items:items.map(row=>historyDto(row,permissions,clock())),page:{has_more:more,next_cursor:more?cursors.encode(binding,`${last!.effective_time}|${last!.id}`):null}};
   });
  },
  async detail(token:string,view:repository.HistoryView,idInput:unknown,input:unknown,correlation:string) {
   const id=uuid(idInput),q=selection(input);
   return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.consent.read',correlation,async(scope,_revision,permissions)=>{
    const row=(await repository.rows(scope,view,{status:null,kind:null,correlation:null,source:null},null,1,id))[0];
    if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
    const history=row.outbound_id?await repository.attempts(scope,row.outbound_id):{attempts:[],history_truncated:false};
    const fanout=row.row_kind==='fanout'?await automation.fanout(scope,row.id):null;
    let reminder=false;
    if(row.row_kind==='fanout'&&row.route_id&&row.original_event_id&&permissions.remind&&row.active) {
     const source=await delay.source(scope,row.original_event_id),execution=await delay.routeExecution(scope,row.route_id);
     reminder=source?.route_id===row.route_id&&execution?.execution_state==='departed'&&
      await delay.latestDelay(scope,row.route_id)===row.original_event_id&&await delay.activationExists(scope,'route-delayed',1)&&
      !await delay.rateLimited(scope,row.original_event_id,clock());
    }
    return {...historyDto(row,permissions,clock()),...history,fanout_items:fanout?.items??[],reminder:{eligible:reminder}};
   });
  },
 };
}
