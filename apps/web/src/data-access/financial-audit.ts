import {financialAuditKinds,financialAuditStatuses,reportLimits,type FinancialAuditFilter,type FinancialAuditRow,type FinancialAuditSnapshot,type FinancialAuditPage,type FinancialAuditExport} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const paise:Decoder<string>=value=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:protocol();
const day:Decoder<string>=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:protocol();
const rowId:Decoder<string>=value=>{if(typeof value!=='string'||! /^(request|change|quote|payment|receipt_command|denial):/.test(value))return protocol();uuid(value.slice(value.indexOf(':')+1));return value;};
const counts:Decoder<FinancialAuditSnapshot['counts']>=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return protocol();
 const record=value as Record<string,unknown>;return Object.fromEntries(financialAuditKinds.filter(kind=>record[kind]!==undefined).map(kind=>[kind,integer()(record[kind])]));
};
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('financial_audit_v1'),organization_id:uuid,franchise_id:uuid,timezone:choice('Asia/Kolkata'),as_of:instant,expires_at:instant,
 filter:object({from_day:day,to_day:day,sort:choice('confirmed_asc','confirmed_desc'),kind:nullable(choice(...financialAuditKinds)),status:nullable(choice(...financialAuditStatuses)),actor_id:nullable(uuid),booking_id:nullable(uuid)}),count:integer(),counts});
const row=object({id:rowId,kind:choice(...financialAuditKinds),change_kind:text,status:choice(...financialAuditStatuses),source_type:choice('financial_request','financial_change','pricing_quote','payment_entry','money_receipt_command','financial_deletion_denial'),source_id:uuid,booking_id:nullable(uuid),receipt_id:nullable(uuid),actor_id:uuid,recorded_at:instant,reason:text,version:integer(),correction_of:nullable(uuid),policy_id:nullable(uuid),approval_threshold_paise:nullable(paise),additional_review_required:nullable(choice(true,false)),
 approval_basis:choice('financial_policy','unconfigured_policy','quote_tolerance','legacy_manual_reference','administrator_command','not_applicable'),approved_actor_id:nullable(uuid),amount_basis:choice('charge_gross','net_recorded_refunds','freight','recorded_collection','allocated_collection','none'),before_paise:nullable(paise),proposed_paise:nullable(paise),
 decisions:array(object({id:uuid,actor_id:uuid,outcome:choice('approved','rejected','applied','superseded'),version:integer(1),financial_change_id:nullable(uuid),recorded_at:instant}),2),
 document_links:array(object({kind:choice('issued_receipt','external_invoice','external_credit_note'),receipt_id:nullable(uuid),external_ref:nullable(text),qualification:choice('issued_source','unverified_external_reference')}),10)});
const page:Decoder<FinancialAuditPage>=object({snapshot,rows:array(row,reportLimits.page),next_offset:nullable(integer())});
const exported:Decoder<FinancialAuditExport>=object({snapshot,columns:array(text,40),csv:value=>typeof value==='string'&&new TextEncoder().encode(value).byteLength<=reportLimits.bytes?value:protocol()});
const detail=object({snapshot,row});
const prefixes:Record<FinancialAuditRow['source_type'],string>={financial_request:'request',financial_change:'change',pricing_quote:'quote',payment_entry:'payment',money_receipt_command:'receipt_command',financial_deletion_denial:'denial'};
export function financialAudit(api:ScopedApi) {
 const path='/api/v1/finance/audit';
 const checkSnapshot=(value:FinancialAuditSnapshot)=>{
  if(value.organization_id!==api.organization||value.franchise_id!==api.franchise||value.count>reportLimits.rows||Object.values(value.counts).reduce((sum,count)=>sum+count,0)!==value.count)return protocol();return value;
 };
 const checkRow=(value:FinancialAuditRow)=>{
  if(value.id!==prefixes[value.source_type]+':'+value.source_id||(value.before_paise===null)!==(value.proposed_paise===null)||(value.amount_basis==='none')!==(value.before_paise===null))return protocol();
  for(const link of value.document_links)if(link.kind==='issued_receipt'?(link.receipt_id===null||link.external_ref!==null||link.qualification!=='issued_source'):(link.receipt_id!==null||link.external_ref===null||link.qualification!=='unverified_external_reference'))return protocol();return value;
 };
 const checkPage=(value:FinancialAuditPage,id?:string,offset=0)=>{
  checkSnapshot(value.snapshot);if((id!==undefined&&value.snapshot.id!==id)||value.rows.length>value.snapshot.count||new Set(value.rows.map(r=>r.id)).size!==value.rows.length||value.next_offset!==(offset+value.rows.length<value.snapshot.count?offset+value.rows.length:null))return protocol();
  value.rows.forEach(checkRow);return value;
 };
 return {
  intent:(filter:FinancialAuditFilter)=>api.intent('financial.audit.capture',api.path(path),filter),
  execute:async(intent:CommandIntent)=>{const value=checkPage(await api.execute(intent,page,['$','Idempotency-Key'])),filter=JSON.parse(intent.bodyJson) as FinancialAuditFilter;if(intent.operation!=='financial.audit.capture'||Object.keys(value.snapshot.filter).some(key=>value.snapshot.filter[key as keyof FinancialAuditFilter]!==filter[key as keyof FinancialAuditFilter]))return protocol();return value;},
  page:async(id:string,offset=0,signal?:AbortSignal)=>checkPage(await api.read(api.path(path+'/'+uuid(id))+'&offset='+offset,page,signal),id,offset),
  detail:async(id:string,rowInput:string,signal?:AbortSignal)=>{const value=await api.read(api.path(path+'/'+uuid(id)+'/rows/'+encodeURIComponent(rowId(rowInput))),detail,signal);checkSnapshot(value.snapshot);checkRow(value.row);if(value.snapshot.id!==id||value.row.id!==rowInput)return protocol();return value;},
  export:async(id:string)=>{const value=await api.read(api.path(path+'/'+uuid(id)+'/export'),exported);checkSnapshot(value.snapshot);if(value.snapshot.id!==id)return protocol();return value;},
 };
}
export type FinancialAuditSource=ReturnType<typeof financialAudit>;
