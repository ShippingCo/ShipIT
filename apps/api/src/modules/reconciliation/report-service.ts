import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type ReconciliationReportFilter,type ReconciliationReportSnapshot,type ReconciliationReportRow,type ReconciliationReportPage} from '@shippingco/shared';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withReportScope} from '../memberships/service.ts';
import {object,selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {scopedQuery} from '../security/scope.ts';
import * as snapshots from '../reports/repository.ts';
import {reportFilter,csvCell} from '../reports/rules.ts';
import {capture} from './report-repository.ts';
export const reconciliationColumns=['id','kind','business_date','direction','amount_paise','matched_paise','remaining_paise','status','classification','external_reference'] as const;
const page=(snapshot:ReconciliationReportSnapshot,rows:ReconciliationReportRow[],offset=0):ReconciliationReportPage=>({snapshot,rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
export function createReconciliationReportService(database:DatabasePool) {
 return {
  async capture(token:string,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const q=selection(query),b=object(value,['account_id','from_day','to_day']),base=reportFilter({from_day:b.from_day,to_day:b.to_day}),filter:ReconciliationReportFilter={account_id:uuid(b.account_id,'account_id'),from_day:base.from_day,to_day:base.to_day},key=keyDigest('reconciliation.report:'+idempotencyKey(keyInput,headers)),fingerprint=digest(filter);
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    await snapshots.lock(scope);const old=await snapshots.replay<ReconciliationReportSnapshot,ReconciliationReportRow>(scope,key);
    if(old){if(old.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(old.expired)throw new HttpError('REPORT_EXPIRED');return page(old.metadata,old.rows);}
    if(!(await scopedQuery(scope,['reports.capture'],`SELECT id FROM shipit.receiving_accounts WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[filter.account_id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
    const result=await capture(scope,filter),status_counts:ReconciliationReportSnapshot['status_counts']={recorded:0,verified:0,pending:0,different:0,unassigned:0};
    for(const row of result.rows)status_counts[row.status]++;
    const snapshot:ReconciliationReportSnapshot={id:randomUUID(),schema_version:1,definition:'manual_reconciliation_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,timezone:'Asia/Kolkata',filter,as_of:result.as_of,expires_at:new Date(Date.parse(result.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),count:result.rows.length,controls:result.controls,status_counts};
    await snapshots.save(scope,key,fingerprint,snapshot,result.rows);await snapshots.audit(scope,snapshot.id,'report.capture');return page(snapshot,result.rows);
   });
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
   const b=object(query,['organization_id','franchise_id',...(exporting?['columns']:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
   const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
   if(offset<0||offset>reportLimits.rows||offset%reportLimits.page)throw new FieldValidationError('$','OUT_OF_RANGE');
   const columns=b.columns===undefined?reconciliationColumns.filter(c=>c!=='external_reference'):typeof b.columns==='string'?b.columns.split(','):[];
   if(exporting&&(!columns.length||new Set(columns).size!==columns.length||columns.some(c=>!reconciliationColumns.includes(c as typeof reconciliationColumns[number]))))throw new FieldValidationError('$','INVALID_FORMAT');
   return withReportScope(database,token,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const saved=await snapshots.get<ReconciliationReportSnapshot,ReconciliationReportRow>(scope,id);
    if(saved.metadata.definition!=='manual_reconciliation_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');
    await snapshots.audit(scope,id,exporting?'report.export':'report.read');
    if(!exporting)return page(saved.metadata,saved.rows,offset);
    const csv=[['snapshot_id','as_of',...columns],...saved.rows.map(row=>[id,saved.metadata.as_of,...columns.map(c=>String(row[c as typeof reconciliationColumns[number]]??''))])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
    if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return {snapshot:saved.metadata,columns,csv};
   });
  },
 };
}
