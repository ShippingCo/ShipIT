import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import type {OwnerSummaryPeriod,OwnerSummarySchedule,OwnerSummarySnapshot,OwnerOverdueAlert} from '@shippingco/shared';
import type {WhatsappDependencies,Binding,Template,SendOutcome} from '../whatsapp/types.ts';
import {withNextOwnerReportScope,withOwnerReportDeliveryScope,withOwnerReportScheduleScope} from '../security/jobs.ts';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {captureOwnerSummary,dueSources} from './owner-summary-sources.ts';
import {templateReason} from '../whatsapp/rules.ts';
import {digest} from '../pricing/idempotency.ts';
import * as r from './owner-summary-repository.ts';

interface Delivery {id:string;run_id:string;recipient_id:string;channel:'in_app'|'whatsapp';state:string;attempts:number;lease_token:string|null;expired:boolean}
const contentDigest=(s:OwnerSummarySnapshot)=>digest({...s,as_of:null,expires_at:null});
async function currentPeriod(scope:TenantAccess,s:OwnerSummarySchedule,instant?:Date):Promise<OwnerSummaryPeriod> {
 const row=(await scopedQuery<{lo:Date;hi:Date}>(scope,['reports.capture'],`SELECT date_trunc('day',COALESCE($2::timestamptz,statement_timestamp()) AT TIME ZONE $1) AT TIME ZONE $1 lo,COALESCE($2::timestamptz,statement_timestamp()) hi
 FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} LIMIT 1`,[s.timing.timezone,instant??null])).rows[0]!;
 return {frequency:'daily',timezone:s.timing.timezone,from:row.lo.toISOString(),to:row.hi.toISOString(),label:'Current overdue conditions'};
}
async function queue(scope:TenantAccess,s:OwnerSummarySchedule,id:string,period:OwnerSummaryPeriod,version=1,reason='report_ready') {
 for(const recipient of s.recipient_ids){const allowed=await r.permitted(scope,recipient,s.franchise_ids);await r.enqueue(scope,id,recipient,'in_app',{schedule:s.id,period,version},allowed?'pending':'suppressed',allowed?reason:'recipient_revoked');if(s.whatsapp)await r.enqueue(scope,id,recipient,'whatsapp',{schedule:s.id,period,version},allowed?'pending':'suppressed',allowed?reason:'recipient_revoked');}
}
async function evaluateAlerts(scope:TenantAccess,s:OwnerSummarySchedule,instant:Date|undefined,cutoff:string) {
 if(!s.alerts.enabled)return;
 const period=await currentPeriod(scope,s,instant);if(period.to===period.from)return;
 const captured=await captureOwnerSummary(scope,period,cutoff),due=await dueSources(scope,captured.sales_rows.filter(row=>row.kind==='booking'),period.to);
 const active=due.filter(d=>d.overdue_days!==null&&d.overdue_days>=s.alerts.minimum_overdue_days&&BigInt(d.amount_paise)>=BigInt(s.alerts.minimum_paise));
 const existing=(await scopedQuery<OwnerOverdueAlert&{last_notified_at:Date|null;notice_seq:number}>(scope,['reports.capture'],`SELECT id,schedule_id,source_id,source_franchise_id franchise_id,amount_paise::text,overdue_days,state,version,updated_at,last_notified_at,notice_seq FROM shipit.owner_report_alerts WHERE {{franchise:organization_id:franchise_id}} AND schedule_id=$1`,[s.id])).rows;
 let notify=false;
 for(const source of active){
  const old=existing.find(a=>a.source_id===source.id),now=new Date(period.to),reopened=old?.state==='resolved';
  if(!old){const c=scope.context;await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_alerts(id,organization_id,franchise_id,schedule_id,source_franchise_id,source_id,amount_paise,overdue_days,state,version)
   SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,'open',1 WHERE {{franchise:$8:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],s.id,source.franchise_id,source.id,source.amount_paise,source.overdue_days,c.organizationId]);
  }else if(reopened||old.amount_paise!==source.amount_paise||old.overdue_days!==source.overdue_days){await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_alerts SET amount_paise=$2,overdue_days=$3,state=CASE WHEN state='resolved' THEN 'open' ELSE state END,version=version+1,updated_at=clock_timestamp() WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[old.id,source.amount_paise,source.overdue_days]);}
  const repeat=s.alerts.repeat_hours!==null&&old?.last_notified_at&&now.getTime()-old.last_notified_at.getTime()>=s.alerts.repeat_hours*3600000;
  if(s.alerts.notify&&old?.state!=='acknowledged'&&(!old||reopened||!old.last_notified_at||repeat)){
   notify=true;await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_alerts SET last_notified_at=$2,notice_seq=notice_seq+1 WHERE {{franchise:organization_id:franchise_id}} AND schedule_id=$1 AND source_id=$3`,[s.id,now,source.id]);
  }
 }
 for(const old of existing.filter(a=>a.state!=='resolved'&&!active.some(d=>d.id===a.source_id)))await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_alerts SET state='resolved',version=version+1,updated_at=clock_timestamp() WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[old.id]);
 if(notify){const id=await r.insertRun(scope,s,period,captured,1,null,null,'alert');if(id){await queue(scope,s,id,period,1,'overdue_alert');await r.audit(scope,id,'generate');}}
}
async function generate(scope:TenantAccess,id:string,instant:Date|undefined,cutoff:string) {
 await r.lockOwner(scope);const s=await r.schedule(scope,id);
 await r.delaySchedule(scope,id);
 if(!s.enabled)return;
 if(!await r.permitted(scope,s.actor_id??'',s.franchise_ids,true)){
  // Configuration belongs to the recorded administrator; revoked authority cannot continue generating private reports.
  await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_schedules SET last_state='suppressed',last_reason='configuring_administrator_revoked' WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id]);await r.audit(scope,id,'suppressed');return;
 }
 const period=await r.ownerSummaryPeriod(scope,s.timing,instant),prior=await r.priorRun(scope,id,period);
 const watermark=(await scopedQuery<{last_period_to:Date|null}>(scope,['reports.capture'],`SELECT last_period_to FROM shipit.owner_report_schedules WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0]!.last_period_to;
 if((!watermark||Date.parse(period.to)>=watermark.getTime())&&(!prior||s.corrections||(await r.run(scope,prior.id)).state==='failed')){
  const snapshot=await captureOwnerSummary(scope,period,cutoff);
  const previous=prior?await r.run(scope,prior.id):null;
  if(!previous||previous.payload_digest!==contentDigest(snapshot)){
   const next=await r.insertRun(scope,s,period,snapshot,(prior?.version??0)+1,prior?.id??null);
   if(next){await queue(scope,s,next,period,(prior?.version??0)+1,prior?'corrected_report':'report_ready');await r.audit(scope,next,'generate');}
  }
  await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_schedules SET last_period_to=GREATEST(last_period_to,$2::timestamptz) WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id,period.to]);
 }
 await evaluateAlerts(scope,s,instant,cutoff);
 await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_schedules SET last_state='completed',last_reason=NULL WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id]);
}
async function delivery(scope:TenantAccess,id:string):Promise<Delivery> {
 const d=(await scopedQuery<Delivery>(scope,['reports.capture'],`SELECT d.id,d.run_id,d.recipient_id,d.channel,d.state,d.attempts,d.lease_token,r.expires_at<=clock_timestamp() expired
 FROM shipit.owner_report_deliveries d JOIN shipit.owner_report_runs r ON r.organization_id=d.organization_id AND r.franchise_id=d.franchise_id AND r.id=d.run_id WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.id=$1 FOR UPDATE OF d`,[id])).rows[0];
 if(!d)throw new HttpError('RESOURCE_NOT_FOUND');return d;
}
async function state(scope:TenantAccess,id:string,value:string,reason:string,provider:string|null=null,delay=0) {
 await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_deliveries SET state=$2,reason=$3,provider_message_id=$4,lease_until=NULL,available_at=clock_timestamp()+make_interval(secs=>$5::int)
  WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id,value,reason,provider,delay]);
}
async function allowed(scope:TenantAccess,d:Delivery) {
 const saved=await r.run(scope,d.run_id),s=await r.schedule(scope,saved.schedule_id);
 return !d.expired&&s.enabled&&(d.channel!=='whatsapp'||s.whatsapp)&&(saved.kind!=='alert'||s.alerts.enabled&&s.alerts.notify)&&s.recipient_ids.includes(d.recipient_id)&&await r.permitted(scope,d.recipient_id,saved.franchise_ids);
}
interface Reservation {id:string;token:string;binding:Binding;template:Template;recipient:string;variables:string[]}
async function prepare(scope:TenantAccess,id:string,dependencies:WhatsappDependencies|undefined):Promise<Reservation|null> {
 await r.lockOwner(scope);const d=await delivery(scope,id);
 if(!['pending','sending'].includes(d.state))return null;
 if(d.state==='sending'){await state(scope,id,'uncertain','worker_interrupted_after_send_intent');return null;}
 if(!await allowed(scope,d)){await state(scope,id,'suppressed',d.expired?'report_expired':'recipient_or_scope_revoked');return null;}
 if(d.channel==='in_app'){await state(scope,id,'sent','available_in_app');return null;}
 if(d.attempts>=5){await state(scope,id,'failed','attempt_limit');return null;}
 const c=scope.context,configuration=dependencies?.configuration.owner_reports;
 if(!dependencies||!configuration||!dependencies.configuration.outbound_enabled){await state(scope,id,'failed','owner_channel_not_configured');return null;}
 const saved=(await scopedQuery<{address:string;installation_id:string;credential_revision:number;binding_key:string;credential_ref:string;waba_id:string;phone_number_id:string}>(scope,['reports.capture'],`SELECT a.address,i.id installation_id,i.credential_revision,i.binding_key,i.credential_ref,i.waba_id,i.phone_number_id FROM shipit.owner_report_consents oc
 JOIN shipit.auth_identifiers a ON a.id=oc.identifier_id AND a.user_id=oc.user_id AND a.channel='whatsapp'
 JOIN shipit.whatsapp_installations i ON i.organization_id=oc.organization_id AND i.franchise_id=oc.franchise_id AND i.state='validated'
 WHERE {{franchise:oc.organization_id:oc.franchise_id}} AND oc.franchise_id=$2 AND oc.user_id=$1 AND oc.enabled`,[d.recipient_id,c.permittedFranchiseIds[0]])).rows[0];
 if(!saved){await state(scope,id,'suppressed','owner_channel_permission_missing');return null;}
 const binding=dependencies.configuration.bindings.find(b=>b.organization_id===c.organizationId&&b.franchise_id===c.permittedFranchiseIds[0]&&b.key===saved.binding_key&&b.credential_ref===saved.credential_ref&&b.waba_id===saved.waba_id&&b.phone_number_id===saved.phone_number_id);
 if(!binding){await state(scope,id,'failed','owner_channel_not_configured');return null;}
 const template=(await scopedQuery<Template&{credential_revision:number}>(scope,['reports.capture'],`SELECT * FROM shipit.whatsapp_templates WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND name=$2 AND language=$3 ORDER BY version DESC LIMIT 1`,[saved.installation_id,configuration.template_name,configuration.template_language])).rows[0];
 if(!template||templateReason(template)||template.variables.length!==1||template.credential_revision!==saved.credential_revision){await state(scope,id,'failed','owner_template_unavailable');return null;}
 const url=new URL('/#/business/reports',configuration.app_origin);url.hash='/business/reports?owner_report='+d.run_id;
 const token=randomUUID();await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_deliveries SET state='sending',reason='durable_send_intent',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds'
  WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id,token]);
 return {id,token,binding,template,recipient:saved.address,variables:[url.href]};
}
async function finalize(scope:TenantAccess,pending:Reservation,outcome:SendOutcome) {
 await r.lockOwner(scope);const d=await delivery(scope,pending.id);if(d.state!=='sending'||d.lease_token!==pending.token)return;
 if(outcome.kind==='accepted')await state(scope,d.id,'sent','provider_accepted',outcome.provider_message_id);
 else if(outcome.kind==='uncertain')await state(scope,d.id,'uncertain','provider_acceptance_unknown');
 else if(outcome.kind==='retryable_not_accepted'&&d.attempts<5)await state(scope,d.id,'pending','provider_not_accepted',null,Math.min(86400,Math.max(60,outcome.retry_after_seconds??2**d.attempts*60)));
 else await state(scope,d.id,'failed',outcome.kind==='retryable_not_accepted'?'attempt_limit':outcome.kind);
}
export function createOwnerSummaryWorker(database:DatabasePool,dependencies?:WhatsappDependencies,options:{enabled:boolean;clock?:()=>Date;onFailure?:(code:string)=>void}={enabled:false}) {
 return {async tick(){
  if(!options.enabled)return;
  let attempted:string|undefined;
  try{await withNextOwnerReportScope(database,false,(scope,id,cutoff)=>{attempted=id;return generate(scope,id,options.clock?.()??new Date(cutoff),cutoff);});}catch(error){
   options.onFailure?.('owner_report_generation_failed:'+(error instanceof DatabaseError?error.sqlState??error.code:error instanceof HttpError?error.code:'unexpected'));
   if(attempted&&!(error instanceof DatabaseError&&['40001','40P01'].includes(error.sqlState??'')))try{await withOwnerReportScheduleScope(database,attempted,async scope=>{
    await r.lockOwner(scope);const s=await r.schedule(scope,attempted!);await r.delaySchedule(scope,s.id);
    const period=await r.ownerSummaryPeriod(scope,s.timing,options.clock?.()),prior=await r.priorRun(scope,s.id,period);
    if(!prior)await r.insertRun(scope,s,period,null,1,null,error instanceof HttpError?error.code:error instanceof DatabaseError&&error.sqlState==='42501'?'runtime_grants_missing':'source_capture_failed');await r.audit(scope,s.id,'failed');await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_schedules SET last_state='failed',last_reason='source_capture_failed' WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[s.id]);
   });}catch{options.onFailure?.('owner_report_failure_record_failed');}
  }
  for(let i=0;i<5;i++)try{
   const pending=await withNextOwnerReportScope(database,true,(scope,id)=>prepare(scope,id,dependencies));
   if(pending){
    // The reservation commit is the send-time authorization point. No database lock spans provider HTTP.
    // An ambiguous commit skips HTTP; lease recovery retains an actionable uncertain result.
    let outcome:SendOutcome;
    try{outcome=await dependencies!.provider.send(pending.binding,pending.template,pending.recipient,pending.variables,'updates');}catch{outcome={kind:'uncertain',reason:'acceptance_unknown'};}
    await withOwnerReportDeliveryScope(database,pending.id,pending.token,scope=>finalize(scope,pending,outcome));
   }
  }catch(error){options.onFailure?.('owner_report_delivery_failed:'+(error instanceof DatabaseError?error.sqlState??error.code:error instanceof HttpError?error.code:'unexpected'));}
 }};
}
