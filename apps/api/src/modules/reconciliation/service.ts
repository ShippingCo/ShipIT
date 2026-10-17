import {randomUUID} from 'node:crypto';
import type {ReconciliationMatchInput,ReconciliationClassification} from '@shippingco/shared';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {withReconciliationScope} from '../memberships/service.ts';
import {selection,uuid,object,integer,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {receiptPage} from '../payments/receipt-validation.ts';
import type {TenantAccess} from '../security/scope.ts';
import type {ReconciliationAction} from './types.ts';
import {allocations,businessDate,mappingInput,text} from './validation.ts';
import {statementPreview} from './csv.ts';
import * as r from './repository.ts';
import * as imports from './imports.ts';
import * as matching from './matching.ts';
import * as review from './review.ts';
import * as queries from './queries.ts';
import * as catalog from './catalog.ts';
import {decodeCsv} from '../imports/csv.ts';
export function createReconciliationService(database:DatabasePool,writesEnabled=false) {
 async function command(token:string,query:unknown,action:ReconciliationAction,operation:r.CommandAction,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string,work:(scope:TenantAccess,commandId:string)=>Promise<{resource:string;result:Record<string,unknown>}>) {
  const q=selection(query),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation,body});
  try {return await withReconciliationScope(database,token,q.organizationId,q.franchiseId,action,correlation,async scope=>{
   await r.lock(scope);const prior=await r.replay(scope,operation,key,fingerprint);if(prior)return prior;
   if(!writesEnabled||operation!=='configure'&&!(await r.config(scope,writesEnabled)).enabled)throw new HttpError('RECONCILIATION_DISABLED');
   const id=randomUUID(),result=await work(scope,id);await r.record(scope,id,operation,key,fingerprint,result.resource,result.result);return result.result;
  });}catch(error){if(error instanceof DatabaseError&&['23505','23514','23503'].includes(error.sqlState??''))throw new HttpError('RECONCILIATION_CONFLICT');throw error;}
 }
 return {
  command,
  async catalog(token:string,kind:'accounts'|'imports'|'sources'|'transactions'|'batches',query:unknown,correlation:string) {
   const b=object(query,['organization_id','franchise_id','account_id','cursor','limit']),q=receiptPage({organization_id:b.organization_id,franchise_id:b.franchise_id,...(b.limit===undefined?{}:{limit:b.limit})});
   const accountId=kind==='accounts'?null:uuid(b.account_id,'account_id'),cursor=b.cursor===undefined?null:kind==='sources'?text(b.cursor):uuid(b.cursor,'cursor');
   return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.read',correlation,async(scope,audit)=>{
    if(accountId)await r.account(scope,accountId,true);
    const rows=kind==='accounts'?await catalog.accounts(scope,cursor,q.limit+1):kind==='imports'?await catalog.imports(scope,accountId!,cursor,q.limit+1):kind==='sources'?await catalog.sources(scope,accountId!,cursor,q.limit+1):kind==='transactions'?await catalog.transactions(scope,accountId!,cursor,q.limit+1):await catalog.batches(scope,accountId!,cursor,q.limit+1);
    await r.auditRead(audit,accountId??q.franchiseId);const last=rows[q.limit-1];
    return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit&&last?('batch_id' in last?last.batch_id:last.id):null};
   });
  },
  async history(token:string,idInput:unknown,query:unknown,correlation:string) {
   const id=uuid(idInput,'$'),q=receiptPage(query);return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.read',correlation,async(scope,audit)=>{
    const rows=await queries.history(scope,id,q.cursor,q.limit+1);await r.auditRead(audit,id);return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
   });
  },
  async config(token:string,query:unknown,correlation:string) {const q=selection(query);return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.read',correlation,s=>r.config(s,writesEnabled));},
  async configure(token:string,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const b=object(value,['expected_version','enabled','reason']),version=integer(b.expected_version,'expected_version',0,2147483645),reason=text(b.reason,500,3);
   if(typeof b.enabled!=='boolean')throw new FieldValidationError('$','INVALID_TYPE');const enabled=b.enabled;
   return command(token,query,'reconciliation.configure','configure',key,headers,{version,enabled,reason},correlation,async(scope,id)=>{
    if((await r.config(scope,writesEnabled)).version!==version)throw new HttpError('VERSION_CONFLICT');
    const resource=await r.appendConfig(scope,id,version+1,enabled,reason);return {resource,result:{id:resource,version:version+1,enabled}};
   });
  },
  async publishMapping(token:string,profileInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const profile=profileInput===null?null:uuid(profileInput,'$'),input=mappingInput(value);
   if((profile===null)!==(input.expected_version===0))throw new FieldValidationError('$','INVALID_FORMAT');
   return command(token,query,'reconciliation.configure','mapping',key,headers,{profile,input},correlation,async(scope,id)=>{
    if(profile){const version=await r.mappingVersion(scope,profile);if(!version)throw new HttpError('RESOURCE_NOT_FOUND');if(version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');}
    const selected=profile??randomUUID(),resource=await r.appendMapping(scope,id,selected,input);return {resource,result:{id:resource,profile_id:selected,version:input.expected_version+1,mapping:input}};
   });
  },
  async mappings(token:string,query:unknown,correlation:string) {
   const q=receiptPage(query);return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.read',correlation,async (scope,audit)=>{
    await r.auditRead(audit,q.franchiseId);const rows=await r.mappings(scope,q.cursor,q.limit+1);return {items:rows.slice(0,q.limit).map(v=>({...v,recorded_at:v.recorded_at.toISOString()})),next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
   });
  },
  async preview(token:string,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const b=object(value,['account_id','mapping_id','period_from','period_to','content_base64']),accountId=uuid(b.account_id,'account_id'),mappingId=uuid(b.mapping_id,'$'),from=businessDate(b.period_from),to=businessDate(b.period_to);
   if(from>to)throw new FieldValidationError('$','INVALID_FORMAT');
   // Raw file bytes are hashed for command identity but parsed only after current authorization; never retained in a command or log.
   return command(token,query,'reconciliation.import','preview',key,headers,b,correlation,async(scope,id)=>{
    const account=await r.account(scope,accountId),mapping=await r.mapping(scope,mappingId),parsed=statementPreview(b.content_base64,mapping.mapping,from,to);
    const resource=await r.appendImport(scope,id,accountId,account.id,mappingId,from,to,parsed.file_sha256,parsed.rows);
    return {resource,result:{id:resource,account_id:accountId,mapping_id:mappingId,period_from:from,period_to:to,...parsed}};
   });
  },
  async columns(token:string,query:unknown,value:unknown,correlation:string) {
   const q=selection(query),b=object(value,['content_base64']);return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.import',correlation,async (scope,audit)=>{
    if(!writesEnabled||!(await r.config(scope,writesEnabled)).enabled)throw new HttpError('RECONCILIATION_DISABLED');
    const parsed=decodeCsv(b.content_base64);await r.auditRead(audit,q.franchiseId,'reconciliation.preview_columns');return {headers:parsed.headers,row_count:parsed.records.length};
   });
  },
  async suggestions(token:string,idInput:unknown,query:unknown,correlation:string) {
   const id=uuid(idInput,'$'),b=object(query,['organization_id','franchise_id','cursor','limit']),cursor=b.cursor===undefined?null:text(b.cursor),q=receiptPage({organization_id:b.organization_id,franchise_id:b.franchise_id,...(b.limit===undefined?{}:{limit:b.limit})});
   return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.read',correlation,async (scope,audit)=>{
    const rows=await queries.suggestions(scope,id,cursor,q.limit+1);await r.auditRead(audit,id);return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.source_id:null};
   });
  },
  async classify(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const id=uuid(idInput,'$'),b=object(value,['expected_version','classification','reason']),version=integer(b.expected_version,'expected_version',0,2147483645),reason=text(b.reason,500,3);
   if(!['unassigned','customer_payment','advance','owner_funds','transfer','fee','other'].includes(String(b.classification)))throw new FieldValidationError('$','INVALID_FORMAT');const classification=b.classification as ReconciliationClassification;
   return command(token,query,'reconciliation.reconcile','classify',key,headers,{id,version,classification,reason},correlation,async(scope,commandId)=>({resource:id,result:await review.classify(scope,commandId,id,version,classification,reason)}));
  },
  async reviewCase(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const id=idInput===null?null:uuid(idInput,'$'),b=object(value,['expected_version','source_id','transaction_id','import_id','row_number','state','kind','reason']);
   if(b.state!=='open'&&b.state!=='resolved'||!['missing_payment','unexplained_credit','wrong_amount','identity_conflict','changed_source','other'].includes(String(b.kind)))throw new FieldValidationError('$','INVALID_FORMAT');
   const input:review.ReviewInput={expected_version:integer(b.expected_version,'expected_version',0,2147483645),source_id:b.source_id===null?null:text(b.source_id),transaction_id:b.transaction_id===null?null:uuid(b.transaction_id,'$'),import_id:b.import_id===null?null:uuid(b.import_id,'$'),row_number:b.row_number===null?null:integer(b.row_number,'$',2,201),state:b.state,kind:b.kind as review.ReviewInput['kind'],reason:text(b.reason,500,3)};
   if(!input.source_id&&!input.transaction_id&&!input.import_id||(input.import_id===null)!==(input.row_number===null))throw new FieldValidationError('$','INVALID_FORMAT');
   return command(token,query,'reconciliation.reconcile','review',key,headers,{id,input},correlation,async(scope,commandId)=>{const result=await review.review(scope,commandId,id,input);return {resource:result.case_id,result};});
  },
  async saveBatch(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const id=idInput===null?null:uuid(idInput,'$'),b=object(value,['expected_version','account_id','expected_date','reference','reason','receipts','fees']);
   const input={expected_version:integer(b.expected_version,'expected_version',0,2147483645),account_id:uuid(b.account_id,'account_id'),expected_date:businessDate(b.expected_date),reference:text(b.reference),reason:text(b.reason,500,3),receipts:allocations(b.receipts,1),fees:allocations(b.fees)};
   if((id===null)!==(input.expected_version===0))throw new FieldValidationError('$','INVALID_FORMAT');
   return command(token,query,'reconciliation.reconcile','batch',key,headers,{id,input},correlation,async(scope,commandId)=>{const result=await matching.saveBatch(scope,commandId,id,input);return {resource:result.id,result};});
  },
  async confirmMatch(token:string,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const b=object(value,['account_id','method','reason','batch_id','transactions','sources','fees']);
   if(b.method!=='exact'&&b.method!=='manual')throw new FieldValidationError('$','INVALID_FORMAT');
   if(!Array.isArray(b.transactions)||b.transactions.length<1||b.transactions.length>100)throw new FieldValidationError('$','OUT_OF_RANGE');
   const transactions=b.transactions.map(v=>{const row=object(v,['transaction_id','amount_paise']);return {transaction_id:uuid(row.transaction_id,'$'),amount_paise:integer(row.amount_paise,'$',1)};}),sources=allocations(b.sources,1),fees=allocations(b.fees);
   if(new Set(transactions.map(v=>v.transaction_id)).size!==transactions.length||new Set([...sources,...fees].map(v=>v.source_id)).size!==sources.length+fees.length)throw new FieldValidationError('$','INVALID_FORMAT');
   const input:ReconciliationMatchInput={account_id:uuid(b.account_id,'account_id'),method:b.method,reason:text(b.reason,500,3),batch_id:b.batch_id===null?null:uuid(b.batch_id,'$'),transactions,sources,fees};
   return command(token,query,'reconciliation.reconcile','match',key,headers,input,correlation,async(scope,commandId)=>{const result=await matching.confirm(scope,commandId,input);return {resource:result.id,result};});
  },
  async unmatch(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const id=uuid(idInput,'$'),b=object(value,['reason']),reason=text(b.reason,500,3);
   return command(token,query,'reconciliation.unmatch','unmatch',key,headers,{id,reason},correlation,async(scope,commandId)=>({resource:id,result:await matching.unmatch(scope,commandId,id,reason)}));
  },
  async commitImport(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const id=uuid(idInput,'$'),b=object(value,['rows']);
   if(!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>20)throw new FieldValidationError('$','OUT_OF_RANGE');
   const rows=b.rows.map(v=>integer(v,'$',2,201)).sort((a,b)=>a-b);if(new Set(rows).size!==rows.length)throw new FieldValidationError('$','INVALID_FORMAT');
   return command(token,query,'reconciliation.import','import',key,headers,{id,rows},correlation,async(scope,commandId)=>({resource:id,result:await imports.commit(scope,commandId,id,rows)}));
  },
  async resolveImportRow(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const id=uuid(idInput,'$'),b=object(value,['row','expected_version','decision','transaction_id','reason']),row=integer(b.row,'$',2,201),version=integer(b.expected_version,'expected_version',1,2147483645),reason=text(b.reason,500,3),target=b.transaction_id===null?null:uuid(b.transaction_id,'$');
   if(b.decision!=='distinct'&&b.decision!=='duplicate'&&b.decision!=='reject')throw new FieldValidationError('$','INVALID_FORMAT');const decision=b.decision;
   if((decision==='duplicate')!==(target!==null))throw new FieldValidationError('$','INVALID_FORMAT');
   return command(token,query,'reconciliation.import','resolve_row',key,headers,{id,row,version,decision,target,reason},correlation,async(scope,commandId)=>({resource:id,result:await imports.resolve(scope,commandId,id,row,version,decision,target,reason)}));
  },
  async readImport(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');return withReconciliationScope(database,token,q.organizationId,q.franchiseId,'reconciliation.read',correlation,async (scope,audit)=>{const result={...(await r.importRun(scope,id)),outcomes:await r.outcomes(scope,id)};await r.auditRead(audit,id);return result;});
  }
 };
}
