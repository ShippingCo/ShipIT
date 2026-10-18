import type {OwnerSummaryWorkspace,OwnerSummarySchedule,OwnerSummaryScheduleInput,OwnerSummarySnapshot,OwnerSummaryRun} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
import {dailyMetricsDecoder,dailyRowDecoder} from './daily-dashboard';
const bool=choice(true,false),money:Decoder<string>=v=>typeof v==='string'&&/^-?\d{1,24}$/.test(v)?v:protocol();
const period=object({frequency:choice('daily','weekly','monthly'),timezone:text,from:instant,to:instant,label:text});
const timing=object({frequency:choice('daily','weekly','monthly'),timezone:text,minute:integer(),weekday:integer()});
const alertPolicy=object({enabled:bool,notify:bool,minimum_paise:money,minimum_overdue_days:integer(),repeat_hours:nullable(integer())});
const schedule:Decoder<OwnerSummarySchedule>=object({id:uuid,actor_id:uuid,organization_id:uuid,franchise_id:uuid,version:integer(),expected_version:integer(),name:text,timing,enabled:bool,whatsapp:bool,corrections:bool,alerts:alertPolicy,franchise_ids:array(uuid,50),recipient_ids:array(uuid,20),updated_at:instant,last_state:choice('pending','completed','suppressed','failed'),last_reason:nullable(text),last_check:nullable(instant)});
const delivery=object({id:uuid,recipient_id:uuid,channel:choice('in_app','whatsapp'),state:choice('pending','sending','sent','failed','uncertain','suppressed'),reason:text,attempts:integer(),updated_at:instant});
const run:Decoder<OwnerSummaryRun>=object({id:uuid,schedule_id:uuid,schedule_name:text,kind:choice('summary','alert','preview'),version:integer(),period,created_at:instant,expires_at:instant,state:choice('ready','failed'),reason:nullable(text),corrected_from:nullable(uuid),deliveries:array(delivery,40)});
export const ownerWorkspace:Decoder<OwnerSummaryWorkspace>=object({enabled:bool,can_configure:bool,schedules:array(schedule,20),runs:array(run,100),alerts:array(object({id:uuid,schedule_id:uuid,source_id:uuid,franchise_id:uuid,amount_paise:money,overdue_days:integer(),state:choice('open','acknowledged','resolved'),version:integer(),updated_at:instant}),100),recipients:array(object({id:uuid}),100),consent:object({enabled:bool,has_verified_number:bool,version:integer()})});
const snapshot:Decoder<OwnerSummarySnapshot>=object({definition:choice('owner_period_v1'),period,as_of:instant,expires_at:instant,franchise_ids:array(uuid,50),metrics:dailyMetricsDecoder,
 expenses_paise:money,overdue_paise:money,unknown_due_count:integer(),agent_held_known_paise:money,unknown_custody_count:integer(),cash_differences_paise:money,reconciliation_exceptions:integer(),reconciliation_state:choice('available','disabled','partially_disabled'),
 evidence:array(object({id:text,franchise_id:uuid,kind:text,occurred_at:nullable(instant),amount_paise:nullable(money),state:text}),5000),sales_rows:array(dailyRowDecoder,5000)});
export function ownerSummaries(api:ScopedApi){
 const base='/api/v1/owner-reports';return {franchise:api.franchise,user:api.scope.authority!.userId,
  workspace:(signal?:AbortSignal)=>api.read(api.path(base),ownerWorkspace,signal),
  saveIntent:(body:OwnerSummaryScheduleInput,id?:string)=>api.intent('owner.schedule',api.path(base+'/schedules'+(id?'/'+uuid(id):'')),body),
  consentIntent:(enabled:boolean,version:number)=>api.intent('owner.consent',api.path(base+'/consent'),{enabled,expected_version:version}),
  actionIntent:(kind:'schedules'|'alerts'|'runs'|'deliveries',id:string,operation:'acknowledge'|'correct'|'retry'|'preview',version:number)=>api.intent('owner.'+operation,api.path(`${base}/${kind}/${uuid(id)}/${operation}`),{expected_version:version}),
  async execute(intent:CommandIntent):Promise<unknown>{
   if(intent.operation==='owner.schedule')return api.execute(intent,schedule,['$','Idempotency-Key']);
   if(intent.operation==='owner.consent')return api.execute(intent,object({enabled:bool,has_verified_number:bool,version:integer()}),['$','Idempotency-Key']);
   return api.execute(intent,object({id:uuid}),['$','Idempotency-Key']);
  },
  async report(id:string,signal?:AbortSignal){const result=await api.read(api.path(base+'/runs/'+uuid(id)),object({run_id:uuid,snapshot}),signal);if(result.run_id!==id||!result.snapshot.franchise_ids.includes(api.franchise))protocol();return result;},
  export:(id:string)=>api.read(api.path(base+'/runs/'+uuid(id)+'/export'),object({columns:array(text,20),csv:v=>typeof v==='string'&&v.length<=8*1024*1024?v:protocol()})),
 };
}
export type OwnerSummarySource=ReturnType<typeof ownerSummaries>;
