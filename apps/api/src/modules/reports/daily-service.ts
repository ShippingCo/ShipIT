import {createHash,randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type DailyFilter,type DailySnapshot,type DailyRow,type DailyPage} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {selection,uuid,idempotencyKey,object} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {salesFilter} from './sales-service.ts';
import {dailyMetrics,dailyComparison,dailyCsv,dailyColumns,dailyEvidence} from './daily-rules.ts';
import {captureDaily} from './daily-repository.ts';
import * as repository from './repository.ts';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const page=(snapshot:DailySnapshot,rows:DailyRow[],offset=0):DailyPage=>({snapshot,rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
export function dailyFilter(body:unknown,franchise:string):DailyFilter {
 const b=object(body,['day','mode','franchise_ids']),day=b.day??null,mode=b.mode??'same_elapsed';
 // Reuse the existing real-calendar date and scope validators without adding a date parser.
 const checked=salesFilter({from_day:day??'2000-01-01',to_day:day??'2000-01-01',franchise_ids:b.franchise_ids},franchise);
 if(mode!=='same_elapsed'&&mode!=='complete_day')throw new FieldValidationError('$','INVALID_FORMAT');
 return {day:day===null?null:checked.from_day,mode,franchise_ids:checked.franchise_ids};
}
export function createDailyService(database:DatabasePool) {
 return {
  async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),filter=dailyFilter(body,q.franchiseId),key=digest('daily:'+idempotencyKey(keyInput,headers)),fingerprint=digest(JSON.stringify(filter));
   return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    await repository.lock(scope);const previous=await repository.replay<DailySnapshot,DailyRow>(scope,key);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,dailyEvidence(previous.rows,'today',undefined));}
    const captured=await captureDaily(scope,filter),today=dailyMetrics(captured.rows.filter(r=>r.period==='today')),yesterday=dailyMetrics(captured.rows.filter(r=>r.period==='yesterday'));
    const snapshot:DailySnapshot={id:randomUUID(),schema_version:1,definition:'owner_daily_v1',timezone:'Asia/Kolkata',organization_id:q.organizationId,franchise_id:q.franchiseId,filter,
     as_of:captured.as_of,expires_at:new Date(Date.parse(captured.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),windows:captured.windows,count:captured.rows.length,today,yesterday,comparison:dailyComparison(today,yesterday)};
    dailyCsv(snapshot,captured.rows);await repository.save(scope,key,fingerprint,snapshot,captured.rows);await repository.audit(scope,snapshot.id,'report.capture');return page(snapshot,dailyEvidence(captured.rows,'today',undefined));
   },filter.franchise_ids);
  },
  async read(session:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
   const b=object(query,['organization_id','franchise_id','period','metric','method',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
   if(b.period!==undefined&&typeof b.period!=='string'||b.metric!==undefined&&typeof b.metric!=='string'||b.method!==undefined&&typeof b.method!=='string')throw new FieldValidationError('$','INVALID_FORMAT');
   const period=b.period as string|undefined,metric=b.metric as string|undefined,method=b.method as string|undefined;dailyEvidence([],period,metric,method);
   const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
   if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
   const ids=await withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const saved=await repository.get<DailySnapshot,DailyRow>(scope,id);if(saved.metadata.definition!=='owner_daily_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');return saved.metadata.filter.franchise_ids;
   });
   return withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const saved=await repository.get<DailySnapshot,DailyRow>(scope,id);await repository.audit(scope,id,exporting?'report.export':'report.read');
    const rows=dailyEvidence(saved.rows,period,metric,method);
    return exporting?{snapshot:saved.metadata,columns:dailyColumns,csv:dailyCsv(saved.metadata,rows)}:page(saved.metadata,rows,offset);
   },ids);
  },
 };
}
