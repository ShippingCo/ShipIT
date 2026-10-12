import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {cashCloseExportColumns,reportLimits,type CashCloseExportMetadata,type CashCloseSource,type CashCloseHandover} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {object,selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {scopedQuery} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {csvCell} from '../reports/rules.ts';
import * as snapshots from '../reports/repository.ts';
import {closeSession,closeCapture} from './close-service.ts';
type ExportRow={record_kind:'source';source:CashCloseSource}|{record_kind:'pending_handover';handover:CashCloseHandover};
export function closeExportCsv(meta:CashCloseExportMetadata,rows:ExportRow[]){
 const summary={record_kind:'physical_count',...meta},records:Record<string,string|number|null>[]=[summary,...rows.map(row=>row.record_kind==='source'?{...meta,record_kind:row.record_kind,...row.source}:{...meta,record_kind:row.record_kind,source_id:row.handover.id,location_id:row.handover.source_location_id,amount_paise:row.handover.remaining_paise})];
 const csv=[cashCloseExportColumns,...records.map(row=>cashCloseExportColumns.map(key=>String(row[key]??'')))].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('CASH_CLOSE_LIMIT_EXCEEDED');return csv;
}
export function createCashCloseExportService(database:DatabasePool){return {
 async capture(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
  const b=object(body,['capture_id']),q=selection(query),id=uuid(idInput,'$'),capture=uuid(b.capture_id,'$'),key=keyDigest('cash.close.export:'+idempotencyKey(keyInput,headers)),fingerprint=digest({definition:'cash_close_v1',id,capture});
  return withReportScope(database,token,q.organizationId,q.franchiseId,true,correlation,async scope=>{
   await snapshots.lock(scope);const previous=await snapshots.replay<CashCloseExportMetadata,ExportRow>(scope,key);
   if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired||!previous.metadata||!previous.rows)throw new HttpError('REPORT_EXPIRED');if(previous.metadata.definition!=='cash_close_v1')throw new HttpError('RESOURCE_NOT_FOUND');await snapshots.audit(scope,previous.id,'report.capture');return previous.metadata;}
   await closeSession(scope,id);const saved=await closeCapture(scope,id,capture),count=saved.count,frame=saved.source_frame;
   const review=(await scopedQuery<{opening_review_id:string|null;submission_id:string;decision_kind:'approve'|'reject'|null;review_mode:'independent'|'sole_admin_self'|null}>(scope,['reports.capture'],`SELECT d.result->'decision'->>'opening_review_id' opening_review_id,s.id submission_id,d.result->'decision'->>'kind' decision_kind,d.result->'decision'->>'mode' review_mode FROM shipit.cash_close_commands s LEFT JOIN shipit.cash_close_commands d ON d.organization_id=s.organization_id AND d.franchise_id=s.franchise_id AND d.session_id=s.session_id AND d.submission_id=s.id AND d.operation='decide' WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.session_id=$1 AND s.count_id=$2 AND s.operation='submit' ORDER BY s.version DESC LIMIT 1`,[id,capture])).rows[0];
   const at=(await scopedQuery<{at:Date}>(scope,['reports.capture'],'SELECT statement_timestamp() at FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}')).rows[0]!.at.toISOString();
   const meta:CashCloseExportMetadata={opening_revision_id:count.opening.initial_revision_id,opening_review_id:review?.opening_review_id??null,id:randomUUID(),definition:'cash_close_v1',schema_version:1,organization_id:q.organizationId,franchise_id:q.franchiseId,as_of:at,expires_at:new Date(Date.parse(at)+reportLimits.lifetimeSeconds*1000).toISOString(),count:frame.source_count,session_id:id,capture_id:capture,opening_at:count.opening.opening_at,opening_paise:count.opening.counted_paise,counted_at:count.counted_at,counted_paise:count.counted_paise,expected_paise:count.expected_paise,variance_paise:count.variance_paise,coverage:frame.coverage,source_as_of:frame.as_of,submission_id:review?.submission_id??null,decision_kind:review?.decision_kind??null,review_mode:review?.review_mode??null};
   const rows:ExportRow[]=[...frame.rows.map(source=>({record_kind:'source' as const,source})),...frame.pending_handovers.map(handover=>({record_kind:'pending_handover' as const,handover}))];
   closeExportCsv(meta,rows);await snapshots.save(scope,key,fingerprint,meta,rows);await snapshots.audit(scope,meta.id,'report.capture');return meta;
  });
 },
 async download(token:string,idInput:unknown,query:unknown,correlation:string){
  const q=selection(query),id=uuid(idInput,'$');return withReportScope(database,token,q.organizationId,q.franchiseId,true,correlation,async scope=>{
   const saved=await snapshots.get<CashCloseExportMetadata,ExportRow>(scope,id);if(!saved.metadata||!saved.rows||saved.metadata.definition!=='cash_close_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');
   await snapshots.audit(scope,id,'report.export');return {snapshot:saved.metadata,columns:cashCloseExportColumns,csv:closeExportCsv(saved.metadata,saved.rows)};
  });
 }
};}
