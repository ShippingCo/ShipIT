import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {OwnerSummaryWorkspace,OwnerOverdueAlert,OwnerSummaryRun} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {selection,uuid,object,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {ownerScheduleInput} from './owner-summary-rules.ts';
import {captureOwnerSummary} from './owner-summary-sources.ts';
import * as r from './owner-summary-repository.ts';
import {csvCell} from './rules.ts';

export async function visibleRun(scope:TenantAccess,id:string,allowExpired=false) {
 const saved=await r.run(scope,id),s=await r.schedule(scope,saved.schedule_id),actor=scope.context.actor.id;
 if(!await r.permitted(scope,actor,saved.franchise_ids)||!s.recipient_ids.includes(actor)&&!await r.permitted(scope,actor,saved.franchise_ids,true)||
  !allowExpired&&(saved.expired||!saved.payload))throw new HttpError('RESOURCE_NOT_FOUND');
 return saved;
}
export async function alerts(scope:TenantAccess):Promise<OwnerOverdueAlert[]> {
 return (await scopedQuery<OwnerOverdueAlert>(scope,['reports.capture'],`SELECT a.id,a.schedule_id,a.source_id,a.source_franchise_id franchise_id,a.amount_paise::text,a.overdue_days,a.state,a.version,a.updated_at
  FROM shipit.owner_report_alerts a WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.franchise_id=$1 AND a.state<>'resolved' ORDER BY a.updated_at DESC,a.id LIMIT 100`,[scope.context.permittedFranchiseIds[0]])).rows;
}
export function createOwnerSummaryService(database:DatabasePool,enabled=false) {
 const writes=()=>{if(!enabled)throw new HttpError('ACTION_FORBIDDEN');};
 return {
  async workspace(token:string,query:unknown,correlation:string):Promise<OwnerSummaryWorkspace> {
   const q=selection(query);
   const base=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    const consent=await r.ownConsent(scope);return {schedules:await r.schedules(scope),history:await r.history(scope),alerts:await alerts(scope),
     can_configure:await r.permitted(scope,scope.context.actor.id,undefined,true),recipients:await r.candidates(scope),
     consent:{enabled:consent.enabled,has_verified_number:consent.has_verified_number,version:consent.version}};
   });
   const visible:OwnerSummaryWorkspace['schedules']=[],runs:OwnerSummaryRun[]=[];
   for(const s of base.schedules)try{
    const permitted=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>s.recipient_ids.includes(scope.context.actor.id)||await r.permitted(scope,scope.context.actor.id,s.franchise_ids,true),s.franchise_ids);
    if(permitted)visible.push(s);
   }catch(error){if(!(error instanceof HttpError)||!['RESOURCE_NOT_FOUND','ACTION_FORBIDDEN'].includes(error.code))throw error;}
   for(const item of base.history)try{
    const ids=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>(await r.run(scope,item.id)).franchise_ids);
    const saved=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,scope=>visibleRun(scope,item.id,true),ids);
    runs.push({id:saved.id,schedule_id:saved.schedule_id,schedule_name:saved.schedule_name,kind:saved.kind,version:saved.version,period:saved.period,created_at:saved.created_at,expires_at:saved.expires_at,state:saved.state,reason:saved.reason,corrected_from:saved.corrected_from,deliveries:saved.deliveries});
   }catch(error){if(!(error instanceof HttpError)||!['RESOURCE_NOT_FOUND','ACTION_FORBIDDEN'].includes(error.code))throw error;}
   return {enabled,can_configure:base.can_configure,schedules:visible,runs,alerts:base.alerts.filter(a=>visible.some(s=>s.id===a.schedule_id&&s.alerts.enabled)),recipients:base.recipients,consent:base.consent};
  },
  async save(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const q=selection(query),input=ownerScheduleInput(value,q.franchiseId),id=idInput===null?randomUUID():uuid(idInput,'$');
   if((idInput===null)!==(input.expected_version===0))throw new FieldValidationError('$','INVALID_FORMAT');
   const key=keyDigest('owner.schedule:'+idempotencyKey(keyInput,headers)),fingerprint=digest({id:idInput,input});
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    await r.requireAdmin(scope);
    if(idInput!==null)await r.schedule(scope,id);
    for(const recipient of input.recipient_ids)if(!await r.permitted(scope,recipient))throw new HttpError('RESOURCE_NOT_FOUND');
    const previous=await r.replay<unknown>(scope,'schedule',key,fingerprint);if(previous)return previous;writes();
    const result=await r.saveSchedule(scope,id,input);await r.command(scope,'schedule',key,fingerprint,result);return result;
   },input.franchise_ids);
  },
  async consent(token:string,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const q=selection(query),b=object(value,['enabled','expected_version']);
   if(typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.expected_version)||Number(b.expected_version)<0)throw new FieldValidationError('$','INVALID_FORMAT');
   const key=keyDigest('owner.consent:'+idempotencyKey(keyInput,headers)),fingerprint=digest(b);
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    const previous=await r.replay<unknown>(scope,'consent',key,fingerprint);if(previous)return previous;writes();
    const result=await r.consent(scope,b.enabled as boolean,Number(b.expected_version));await r.command(scope,'consent',key,fingerprint,result);return result;
   });
  },
  async report(token:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
   const q=selection(query),id=uuid(idInput,'$');
   const ids=await withReportScope(database,token,q.organizationId,q.franchiseId,exporting,correlation,async scope=>(await r.run(scope,id)).franchise_ids);
   return withReportScope(database,token,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const saved=await visibleRun(scope,id);await r.audit(scope,id,exporting?'export':'read');
    if(!exporting)return {run_id:id,snapshot:saved.payload!};
    const columns=['report_id','cutoff','period_from','period_to','franchise_id','kind','source_id','state','amount_paise','customer_id','eligible','new_customer'];
    const p=saved.payload!,rows=p.evidence.map(e=>[id,p.as_of,p.period.from,p.period.to,e.franchise_id,e.kind,e.id,e.state,e.amount_paise??'','','','']);
    for(const row of p.sales_rows)for(const key of ['billed_gross','tax_exclusive_revenue','collections','refunds','outstanding'] as const)if(row[key]!=='0')rows.push([id,p.as_of,p.period.from,p.period.to,row.franchise_id,key,row.id,row.kind,row[key],row.customer_id??'',String(row.eligible),String(row.new_customer)]);
    const csv=[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';if(Buffer.byteLength(csv)>8*1024*1024)throw new HttpError('REPORT_LIMIT_EXCEEDED');return {columns,csv};
   },ids);
  },
  async action(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string,operation:'acknowledge'|'correct'|'retry'|'preview') {
   const q=selection(query),id=uuid(idInput,'$'),b=object(value,['expected_version']);
   if(!Number.isSafeInteger(b.expected_version)||Number(b.expected_version)<(operation==='retry'?0:1))throw new FieldValidationError('$','INVALID_FORMAT');
   const key=keyDigest('owner.'+operation+':'+idempotencyKey(keyInput,headers)),fingerprint=digest({id,b});
   let ids:string[]=[q.franchiseId];
   if(operation==='correct')ids=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>(await r.run(scope,id)).franchise_ids);
   if(operation==='preview')ids=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>(await r.schedule(scope,id)).franchise_ids);
   if(operation==='retry')ids=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    const d=(await scopedQuery<{run_id:string}>(scope,['reports.capture'],`SELECT run_id FROM shipit.owner_report_deliveries WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];if(!d)throw new HttpError('RESOURCE_NOT_FOUND');return (await r.run(scope,d.run_id)).franchise_ids;
   });
   if(operation==='acknowledge')ids=await withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{const a=(await alerts(scope)).find(a=>a.id===id);if(!a)throw new HttpError('RESOURCE_NOT_FOUND');return (await r.schedule(scope,a.schedule_id)).franchise_ids;});
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async (scope,cutoff)=>{
    if(operation!=='acknowledge')await r.requireAdmin(scope);
    const old=await r.replay<{id:string}>(scope,operation,key,fingerprint);if(old)return old;writes();
    let result:{id:string;version?:number;state?:string}={id};
    if(operation==='preview'){
     const s=await r.schedule(scope,id);if(s.version!==b.expected_version)throw new HttpError('IDEMPOTENCY_CONFLICT');
     const period=await r.ownerSummaryPeriod(scope,s.timing,new Date(cutoff!)),previous=await r.priorRun(scope,s.id,period,'preview'),snapshot=await captureOwnerSummary(scope,period,cutoff!);
     const run=await r.insertRun(scope,s,period,snapshot,(previous?.version??0)+1,previous?.id??null,'preview_only','preview');if(!run)throw new HttpError('IDEMPOTENCY_CONFLICT');
     result={id:run};await r.audit(scope,run,'generate');
    }else if(operation==='correct'){
     const previous=await visibleRun(scope,id,true),s=await r.schedule(scope,previous.schedule_id);
     if(Date.parse(previous.period.to)<Date.now()-90*86400000)throw new HttpError('RESOURCE_NOT_FOUND');
     if(!s.corrections||previous.version!==b.expected_version||digest(previous.franchise_ids)!==digest(s.franchise_ids))throw new HttpError('IDEMPOTENCY_CONFLICT');
     const latest=await r.priorRun(scope,s.id,previous.period);if(latest?.id!==id)throw new HttpError('IDEMPOTENCY_CONFLICT');
     const snapshot=await captureOwnerSummary(scope,previous.period,cutoff!),newId=await r.insertRun(scope,s,previous.period,snapshot,previous.version+1,id);
     if(!newId)throw new HttpError('IDEMPOTENCY_CONFLICT');result={id:newId};
     for(const recipient of s.recipient_ids){const allowed=await r.permitted(scope,recipient);await r.enqueue(scope,newId,recipient,'in_app',{schedule:s.id,period:previous.period,version:previous.version+1},allowed?'pending':'suppressed',allowed?'corrected_report':'recipient_revoked');if(s.whatsapp)await r.enqueue(scope,newId,recipient,'whatsapp',{schedule:s.id,period:previous.period,version:previous.version+1},allowed?'pending':'suppressed',allowed?'corrected_report':'recipient_revoked');}
     await r.audit(scope,newId,'generate');
    }else if(operation==='acknowledge'){
     const a=(await alerts(scope)).find(a=>a.id===id);if(!a)throw new HttpError('RESOURCE_NOT_FOUND');const s=await r.schedule(scope,a.schedule_id);
     if(!await r.permitted(scope,scope.context.actor.id,s.franchise_ids)||!s.recipient_ids.includes(scope.context.actor.id)&&!await r.permitted(scope,scope.context.actor.id,s.franchise_ids,true))throw new HttpError('RESOURCE_NOT_FOUND');
     const changed=await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_alerts SET state='acknowledged',version=version+1,updated_at=clock_timestamp() WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$2 AND state='open'`,[id,b.expected_version]);if(!changed.rowCount)throw new HttpError('IDEMPOTENCY_CONFLICT');
     result={id,version:Number(b.expected_version)+1,state:'acknowledged'};
    }else{
     const changed=await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_deliveries SET state='pending',reason='authorized_retry',available_at=clock_timestamp(),lease_token=NULL,lease_until=NULL
      WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='failed' AND attempts=$2 AND attempts<5`,[id,b.expected_version]);if(!changed.rowCount)throw new HttpError('IDEMPOTENCY_CONFLICT');
    }
    await r.command(scope,operation,key,fingerprint,result);return result;
   },ids,operation==='correct'||operation==='preview');
  },
 };
}
