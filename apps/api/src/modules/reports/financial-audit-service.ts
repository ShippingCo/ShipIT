import {createHash,randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type FinancialAuditSnapshot,type FinancialAuditRow,type FinancialAuditPage} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {object,selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {captureFinancialAudit} from './financial-audit-repository.ts';
import {financialAuditFilter,financialAuditCsv,financialAuditColumns} from './financial-audit-rules.ts';
import * as snapshots from './repository.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const page=(snapshot:FinancialAuditSnapshot,rows:FinancialAuditRow[],offset=0):FinancialAuditPage=>({snapshot,rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
async function saved(scope:TenantAccess,id:string,franchise:string) {
 const result=await snapshots.get<FinancialAuditSnapshot,FinancialAuditRow>(scope,id);
 if(result.metadata.definition!=='financial_audit_v1'||result.metadata.franchise_id!==franchise)throw new HttpError('RESOURCE_NOT_FOUND');return result;
}
export function createFinancialAuditService(database:DatabasePool) {
 return {
  async captureAudit(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),filter=financialAuditFilter(body),key=hash('financial.audit:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify(filter));
   return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    await snapshots.lock(scope);const previous=await snapshots.replay<FinancialAuditSnapshot,FinancialAuditRow>(scope,key);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,previous.rows);}
    if(filter.booking_id!==null&&!(await scopedQuery(scope,['reports.capture'],`SELECT id FROM shipit.bookings WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[filter.booking_id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
    const captured=await captureFinancialAudit(scope,filter),counts:FinancialAuditSnapshot['counts']={};
    for(const row of captured.rows)counts[row.kind]=(counts[row.kind]??0)+1;
    const metadata:FinancialAuditSnapshot={id:randomUUID(),schema_version:1,definition:'financial_audit_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,timezone:'Asia/Kolkata',filter,as_of:captured.as_of,expires_at:new Date(Date.parse(captured.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),count:captured.rows.length,counts};
    financialAuditCsv(metadata,captured.rows);await snapshots.save(scope,key,fingerprint,metadata,captured.rows);await snapshots.audit(scope,metadata.id,'report.capture');return page(metadata,captured.rows);
   });
  },
  async readAudit(session:string,query:unknown,idInput:unknown,correlation:string,exporting=false) {
   const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
   const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
   if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
   return withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const result=await saved(scope,id,q.franchiseId);await snapshots.audit(scope,id,exporting?'report.export':'report.read');
    return exporting?{snapshot:result.metadata,columns:financialAuditColumns,csv:financialAuditCsv(result.metadata,result.rows)}:page(result.metadata,result.rows,offset);
   });
  },
  async auditDetail(session:string,query:unknown,idInput:unknown,rowInput:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');
   if(typeof rowInput!=='string'||! /^(request|change|quote|payment|receipt_command|denial):/.test(rowInput))throw new FieldValidationError('$','INVALID_FORMAT');
   uuid(rowInput.slice(rowInput.indexOf(':')+1),'$');
   return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    const result=await saved(scope,id,q.franchiseId),row=result.rows.find(r=>r.id===rowInput);if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
    await snapshots.audit(scope,id,'report.read');return {snapshot:result.metadata,row};
   });
  },
 };
}
