import type { ScopedApi } from './scoped-api';
import type { CommandIntent } from './command-intent';
import { array,choice,instant,integer,list,nullable,object,protocol,text,uuid } from './dto';
export type HistoryView='messages'|'automation';
export const messageStates=['queued','retry_wait','dispatching','accepted','delivered','read','suppressed','failed','uncertain'] as const;
export const automationStates=['queued','blocked','suppressed','skipped','pending','running','completed','failed'] as const;
export const kinds=['updates','requested_assistance','consent_disclosure','delivery_otp','booking_confirmation','parcel_checked_in','parcel_dispatched','route_departed','route_delayed','route_arrived','delivery_attempt_failed','rto_approved','delivery_completed','route_delay','route_delay_reminder'] as const;
const fields={id:uuid,row_kind:choice('message','decision','fanout'),effective_time:instant,source_id:uuid,source_kind:text,affected_id:uuid,correlation_id:uuid,notification_kind:choice(...kinds),
 decision:nullable(object({id:uuid,policy_id:text,policy_version:integer(1),outcome:choice('queued','blocked','suppressed','skipped'),reason_code:text})),
 message:nullable(object({id:uuid,state:choice(...messageStates),reason_code:text,version:integer(1),attempt_count:integer(),progress:choice('none','sent','delivered','read'),failure_observed:choice(true,false),observed_at:nullable(instant)})),
 fanout:nullable(object({id:uuid,route_id:uuid,original_event_id:uuid,state:choice('pending','running','completed','failed'),total_count:integer(),completed_count:integer(),skipped_count:integer(),failed_count:integer()})),
 recovery:object({kind:choice('none','redrive','investigate_uncertain'),expected_version:nullable(integer(1)),allowed_reasons:array(choice('dependency_repaired','retry_uncertain_confirmed'),1)})};
export const historyDto=object(fields);
export type HistoryRow=ReturnType<typeof historyDto>;
export const historyDetail=object({...fields,attempts:array(object({attempt:integer(1),outcome:choice('accepted','retryable_not_accepted','permanent_failure','configuration_failure','uncertain','unavailable'),reason_code:text,recorded_at:instant}),100),history_truncated:choice(true,false),
 fanout_items:array(object({parcel_id:uuid,outcome:choice('queued','blocked','suppressed','skipped'),reason_code:text,outbound_intent_id:nullable(uuid),eta_event_id:nullable(uuid),decided_at:instant}),1000),reminder:object({eligible:choice(true,false)})});
export type HistoryDetail=ReturnType<typeof historyDetail>;
export function messaging(api:ScopedApi) {
 const base='/api/v1/whatsapp/history';
 return {
  list(view:HistoryView,filter:{status?:string;kind?:string;source_id?:string;correlation_id?:string;cursor?:string|null}={},signal?:AbortSignal) {
   const q=new URLSearchParams({limit:'25'});for(const[k,v]of Object.entries(filter))if(v)q.set(k,v);
   return api.read(api.path(`${base}/${view}`)+'&'+q,list(historyDto),signal);
  },
  detail(view:HistoryView,id:string,signal?:AbortSignal){return api.read(api.path(`${base}/${view}/${uuid(id)}`),value=>{const row=historyDetail(value);return row.id===id?row:protocol();},signal);},
  redrive(row:HistoryDetail) {
   if(!row.message||row.recovery.kind==='none'||row.recovery.allowed_reasons.length!==1||row.recovery.expected_version!==row.message.version)return protocol();
   return api.intent('api.v1.whatsapp.outbound.redrive',api.path(`/api/v1/whatsapp/outbound/${row.message.id}/redrive`),
    {expected_version:row.message.version,reason_code:row.recovery.allowed_reasons[0]},'POST',row.message.version);
  },
  reminder(row:HistoryDetail) {
   if(!row.fanout||row.row_kind!=='fanout'||!row.reminder.eligible)return protocol();
   return api.intent('api.v1.routes.delay.remind',api.path(`/api/v1/routes/${row.fanout.route_id}/delay-reminders`),{original_delay_event_id:row.fanout.original_event_id});
  },
  execute(intent:CommandIntent) {
   const body=JSON.parse(intent.bodyJson) as Record<string,unknown>;
   if(intent.operation==='api.v1.whatsapp.outbound.redrive')return api.execute(intent,value=>{
    const result=object({id:uuid,version:integer(1),state:choice('queued')})(value);
    if(!intent.path.includes(`/outbound/${result.id}/redrive?`)||result.version!==Number(body.expected_version)+1)return protocol();return result.id;
   });
   if(intent.operation==='api.v1.routes.delay.remind')return api.execute(intent,value=>{
    const result=object({id:uuid,event_type:choice('route.delay_reminder.requested'),route_id:uuid,original_event_id:uuid,fanout_id:uuid,created_at:instant})(value);
    if(!intent.path.includes(`/routes/${result.route_id}/delay-reminders?`)||result.original_event_id!==body.original_delay_event_id)return protocol();return result.id;
   });
   return protocol();
  },
 };
}
export type MessagingSource=ReturnType<typeof messaging>;
