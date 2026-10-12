import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {object,selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {scopedQuery} from '../security/scope.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import * as snapshots from '../reports/repository.ts';
import {readStatementDetail} from './statement-service.ts';
import {statementExportRows,statementExportCsv,statementExportColumns,type StatementExportMetadata,type StatementExportRow} from './export-rules.ts';
export function createAgentStatementExportService(database:DatabasePool){return {
 async capture(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
  object(body,[]);const q=selection(query),id=uuid(idInput,'$'),key=keyDigest('agent.statement.export:'+idempotencyKey(keyInput,headers)),fingerprint=digest({definition:'agent_statement_v1',statement_id:id});
  return withReportScope(database,token,q.organizationId,q.franchiseId,true,correlation,async scope=>{
   await snapshots.lock(scope);const previous=await snapshots.replay<StatementExportMetadata,StatementExportRow>(scope,key);
   if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired||!previous.metadata||!previous.rows)throw new HttpError('REPORT_EXPIRED');if(previous.metadata.definition!=='agent_statement_v1')throw new HttpError('RESOURCE_NOT_FOUND');await snapshots.audit(scope,previous.id,'report.capture');return previous.metadata;}
   const statement=await readStatementDetail(scope,id,'reports.capture',false,false,false),captured=statementExportRows(statement),cutoff=(await scopedQuery<{at:Date}>(scope,['reports.capture'],'SELECT statement_timestamp() AS at FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}')).rows[0]!.at.toISOString();
   const metadata:StatementExportMetadata={timezone:'Asia/Kolkata',currency:'INR',id:randomUUID(),definition:'agent_statement_v1',schema_version:1,organization_id:q.organizationId,franchise_id:q.franchiseId,as_of:cutoff,expires_at:new Date(Date.parse(cutoff)+reportLimits.lifetimeSeconds*1000).toISOString(),count:captured.source_count,source_count:captured.source_count,statement_id:statement.id,agent_id:statement.agent_id,day:statement.day,revision:statement.revision,status:statement.status,counted_at:statement.counted_at,source_as_of:statement.capture_recorded_at,summaries:captured.rows.slice(0,4)};
   statementExportCsv(metadata,captured.rows);await snapshots.save(scope,key,fingerprint,metadata,captured.rows.slice(4));await snapshots.audit(scope,metadata.id,'report.capture');return metadata;
  });
 },
 async read(token:string,idInput:unknown,query:unknown,correlation:string,download=false){
  const b=object(query,['organization_id','franchise_id',...(download?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
  const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
  if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
  return withReportScope(database,token,q.organizationId,q.franchiseId,true,correlation,async scope=>{
   const saved=await snapshots.get<StatementExportMetadata,StatementExportRow>(scope,id);if(!saved.metadata||!saved.rows||saved.metadata.definition!=='agent_statement_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');
   await snapshots.audit(scope,id,download?'report.export':'report.read');return download?{snapshot:saved.metadata,columns:statementExportColumns,csv:statementExportCsv(saved.metadata,[...saved.metadata.summaries,...saved.rows])}:{snapshot:saved.metadata,rows:saved.rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<saved.rows.length?offset+reportLimits.page:null};
  });
 }
};}
