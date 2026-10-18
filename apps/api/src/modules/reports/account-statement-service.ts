import {randomUUID,createHash} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {statementMeasures,type AccountStatement} from '@shippingco/shared';
import {withCustomerAccountScope,withFinancialScope,withReportScope} from '../memberships/service.ts';
import {selection,object,uuid,integer,idempotencyKey} from '../pricing/validation.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import * as r from './account-statement-repository.ts';
import * as finance from './finance-repository.ts';
import * as reports from './repository.ts';
import {reportFilter,csvCell} from './rules.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function period(value:unknown,issuing=false){
 const b=object(value,['account_id','from_day','to_day',...(issuing?['expected_version','source_digest']:[])]),filter=reportFilter({from_day:b.from_day,to_day:b.to_day});
 if((Date.parse(filter.to_day)-Date.parse(filter.from_day))/86400000>30)throw new FieldValidationError('$','OUT_OF_RANGE');
 return {account_id:uuid(b.account_id),from_day:filter.from_day,to_day:filter.to_day,...(issuing?{expected_version:integer(b.expected_version,'expected_version',0,2147483646),source_digest:typeof b.source_digest==='string'&&/^[a-f0-9]{64}$/.test(b.source_digest)?b.source_digest:(()=>{throw new FieldValidationError('$','INVALID_FORMAT');})()}: {})};
}
export function statementCsv(s:AccountStatement){
 const columns=['statement_id','previous_statement_id','account_id','from_day','to_day','as_of','booking_id','due_date','source_statement_id','original_gross_paise','pre_tax_paise','cgst_paise','sgst_paise','igst_paise','rounding_paise',...statementMeasures.map(k=>k+'_paise'),'payment_ids','adjustment_ids',...statementMeasures.map(k=>'statement_'+k+'_paise'),'unallocated_advance_paise','payment_evidence_json','adjustment_evidence_json','advance_sources_json'];
 const rows=s.lines.map((l,index)=>[s.id??'',s.previous_statement_id??'',s.account_id,s.from_day,s.to_day,s.as_of,l.booking_id,l.due_date,l.source_statement_id??'',l.original_gross,l.pre_tax,l.cgst,l.sgst,l.igst,l.rounding,...statementMeasures.map(k=>l.amounts[k]),l.payment_ids.join('|'),l.adjustment_ids.join('|'),...statementMeasures.map(k=>s.totals[k]),s.unallocated_advance,JSON.stringify(l.payment_evidence),JSON.stringify(l.adjustment_evidence),index===0?JSON.stringify(s.advance_sources):'']);
 const csv=[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';if(Buffer.byteLength(csv)>8388608)throw new HttpError('REPORT_LIMIT_EXCEEDED');return {columns,csv};
}
export function createAccountStatementService(database:DatabasePool,writesEnabled=false){return {
 async previewStatement(token:string,query:unknown,body:unknown,correlation:string){const q=selection(query),b=period(body);
  return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.read',correlation,async scope=>{
   const result=await r.capture(scope,await r.account(scope,b.account_id),b.from_day,b.to_day);await r.access(scope,b.account_id);return result;
  },true);
 },
 async issueAccountStatement(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
  const q=selection(query),b=period(body,true),key=hash('account_statement:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify(b));
  return withFinancialScope(database,token,q.organizationId,q.franchiseId,'finance.statement',correlation,async scope=>{
   await finance.lock(scope);const existing=await finance.replay(scope,key,true);
   if(existing){if(existing.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return r.read(scope,existing.id);}
   if(!writesEnabled)throw new HttpError('CUSTOMER_ACCOUNTS_DISABLED');
   const s=await r.capture(scope,await r.account(scope,b.account_id),b.from_day,b.to_day);
   if(s.version!==(b.expected_version??-1)+1||s.source_digest!==b.source_digest)throw new HttpError('VERSION_CONFLICT');
   const previous=await r.latest(scope,b.account_id);if(!s.lines.length||previous?.source_digest===s.source_digest)throw new HttpError('STATEMENT_EMPTY');
   s.id=randomUUID();await r.issue(scope,key,fingerprint,s);return s;
  });
 },
 async statementHistory(token:string,idInput:unknown,query:unknown,correlation:string){
  const b=object(query,['organization_id','franchise_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput);
  const cursor=b.cursor===undefined?0:typeof b.cursor==='string'&&/^\d{1,9}$/.test(b.cursor)?Number(b.cursor):-1;if(cursor<0)throw new FieldValidationError('$','INVALID_FORMAT');
  return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.read',correlation,async scope=>{await r.account(scope,id);const rows=await r.history(scope,id,cursor);await r.access(scope,id);return {items:rows.slice(0,50),next_cursor:rows.length>50?String(rows[49]!.version):null};},true);
 },
 async accountStatement(token:string,idInput:unknown,query:unknown,correlation:string){const q=selection(query),id=uuid(idInput);return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.read',correlation,async scope=>{const s=await r.read(scope,id);await r.access(scope,id);return s;},true);},
 async captureStatementExport(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
  object(body,[]);
  const q=selection(query),id=uuid(idInput),key=hash('statement_export:'+idempotencyKey(keyInput,headers)),fingerprint=hash(id);
  return withReportScope(database,token,q.organizationId,q.franchiseId,true,correlation,async scope=>{
   await reports.lock(scope);const previous=await reports.replay<{id:string;statement:AccountStatement},never>(scope,key);
   if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return {id:previous.id};}
   const statement=await r.read(scope,id);statementCsv(statement);const as_of=new Date().toISOString(),metadata={id:randomUUID(),definition:'account_statement_export_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,count:0,as_of,expires_at:new Date(Date.parse(as_of)+86400000).toISOString(),statement};
   await reports.save(scope,key,fingerprint,metadata,[]);await reports.audit(scope,metadata.id,'report.capture');return {id:metadata.id};
  });
 },
 async statementExport(token:string,idInput:unknown,query:unknown,correlation:string){const q=selection(query),id=uuid(idInput);return withReportScope(database,token,q.organizationId,q.franchiseId,true,correlation,async scope=>{
  const saved=await reports.get<{definition:string;statement:AccountStatement}>(scope,id);if(saved.metadata.definition!=='account_statement_export_v1')throw new HttpError('RESOURCE_NOT_FOUND');await reports.audit(scope,id,'report.export');return {...statementCsv(saved.metadata.statement),statement:saved.metadata.statement};
 });},
};}
