import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type CashbookReportSnapshot,type CashbookSourceRow,type CashbookReportPage} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {object,selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import * as snapshots from '../reports/repository.ts';
import {cashbookReportFilter,cashbookSourceCsv,cashbookSourceColumns,cashbookSourceKinds} from './report-rules.ts';
import {captureCashbookSources} from './report-repository.ts';
const page=(snapshot:CashbookReportSnapshot,rows:CashbookSourceRow[],offset=0):CashbookReportPage=>({snapshot,rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
async function saved(scope:TenantAccess,id:string,franchise:string) {
 const result=await snapshots.get<CashbookReportSnapshot,CashbookSourceRow>(scope,id);if(result.metadata.definition!=='cashbook_sources_v1'||result.metadata.franchise_id!==franchise)throw new HttpError('RESOURCE_NOT_FOUND');return result;
}
export function createCashbookReportService(database:DatabasePool) {
 return {
  async capture(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),filter=cashbookReportFilter(body),key=keyDigest('cashbook.report:'+idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.report.capture',filter});
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    await snapshots.lock(scope);const previous=await snapshots.replay<CashbookReportSnapshot,CashbookSourceRow>(scope,key);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,previous.rows);}
    if(filter.location_id&&!(await scopedQuery(scope,['reports.capture'],`SELECT id FROM shipit.cash_locations WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[filter.location_id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
    const result=await captureCashbookSources(scope,filter),as_of=result.position.as_of;
    const metadata:CashbookReportSnapshot={id:randomUUID(),schema_version:1,definition:'cashbook_sources_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,timezone:'Asia/Kolkata',filter,as_of,expires_at:new Date(Date.parse(as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),count:result.rows.length,totals:result.totals,position:result.position};
    if(Buffer.byteLength(JSON.stringify({metadata,rows:result.rows}))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
    cashbookSourceCsv(metadata,result.rows);await snapshots.save(scope,key,fingerprint,metadata,result.rows);await snapshots.audit(scope,metadata.id,'report.capture');return page(metadata,result.rows);
   });
  },
  async read(token:string,query:unknown,idInput:unknown,correlation:string,exporting=false) {
   const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
   const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
   return withReportScope(database,token,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{const result=await saved(scope,id,q.franchiseId);await snapshots.audit(scope,id,exporting?'report.export':'report.read');return exporting?{snapshot:result.metadata,columns:cashbookSourceColumns,csv:cashbookSourceCsv(result.metadata,result.rows)}:page(result.metadata,result.rows,offset);});
  },
  async detail(token:string,query:unknown,idInput:unknown,rowInput:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');if(typeof rowInput!=='string')throw new FieldValidationError('$','INVALID_FORMAT');const parts=rowInput.split(':');if(parts.length!==3||!cashbookSourceKinds.includes(parts[0] as CashbookSourceRow['source_kind']))throw new FieldValidationError('$','INVALID_FORMAT');uuid(parts[1],'$');if(parts[2]!=='unknown')uuid(parts[2],'$');
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async scope=>{const result=await saved(scope,id,q.franchiseId),row=result.rows.find(r=>r.id===rowInput);if(!row)throw new HttpError('RESOURCE_NOT_FOUND');await snapshots.audit(scope,id,'report.read');return {snapshot:result.metadata,row};});
  }
 };
}
