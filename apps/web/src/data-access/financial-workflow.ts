import {financialChangeKinds,financialChangeReasons,financialComponentKeys,type FinancialComponentsDto,type FinancialProposalContext,type FinancialRequestDto,type FinancialRequestDetail,type FinancialOwnRequest,type FinancialProposalInput,type FinancialApplyInput,type FinancialPolicyInput} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const paise:Decoder<string>=value=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:protocol();
const rounding:Decoder<string>=value=>typeof value==='string'&&/^-?\d{1,2}$/.test(value)?value:protocol();
const components=Object.fromEntries(financialComponentKeys.map(key=>[key,key==='rounding'?rounding:paise])) as Record<typeof financialComponentKeys[number],Decoder<string>>;
const position=object({gross:paise,held:paise,outstanding:paise,refundable_credit:paise});
const document=object({kind:choice('issued_receipt','external_invoice','external_credit_note'),receipt_id:nullable(uuid),external_ref:nullable(text),qualification:choice('issued_source','unverified_external_reference')});
const request:Decoder<FinancialRequestDto>=object({id:uuid,actor_id:uuid,recorded_at:instant,policy_id:nullable(uuid),supersedes_id:nullable(uuid),refund_correction_of:nullable(uuid),booking_id:uuid,expected_version:integer(),payment_version:integer(),kind:choice(...financialChangeKinds),reason:choice(...financialChangeReasons),...components,refund:paise,version:integer(),outcome:choice('pending','approved','rejected','applied','superseded')});
const own:Decoder<FinancialOwnRequest>=object({request,document_links:array(document,10)});
const detailed:Decoder<FinancialRequestDetail>=object({request,document_links:array(document,10),decisions:array(object({id:uuid,actor_id:uuid,outcome:choice('approved','rejected','applied','superseded'),version:integer(1),financial_change_id:nullable(uuid),recorded_at:instant}),2),source:object({booking_id:uuid,financial_version:integer(),payment_version:integer(),components:object({...components,gross:paise,collections:paise,refunds:paise})}),before:position,proposed:position});
const policy=object({id:uuid,version:integer(1),discount_review_threshold_paise:nullable(paise),allow_self_approval:choice(true,false),enabled:choice(true,false)});
const context:Decoder<FinancialProposalContext>=object({booking_id:uuid,expected_version:integer(),payment_version:integer(),components:object(components),position,refund_targets:array(object({id:uuid,original_paise:paise,remaining_paise:paise}),100)});
function checkDocuments(links:FinancialOwnRequest['document_links']) {
 for(const link of links)if(link.kind==='issued_receipt'?link.receipt_id===null||link.external_ref!==null||link.qualification!=='issued_source':link.receipt_id!==null||link.external_ref===null||link.qualification!=='unverified_external_reference')return protocol();
}
function checkRequest(value:FinancialRequestDto) {
 if(value.version!==(value.outcome==='pending'?0:value.outcome==='applied'?2:1)||(value.kind==='refund_correction')!==(value.refund_correction_of!==null)||value.kind==='refund_correction'&&value.reason!=='incorrect_refund_recording')return protocol();
}
function checkPosition(value:ReturnType<typeof position>) {
 const gross=BigInt(value.gross),held=BigInt(value.held);
 if(BigInt(value.outstanding)!==(gross>held?gross-held:0n)||BigInt(value.refundable_credit)!==(held>gross?held-gross:0n))return protocol();
}
function checkComponents(value:FinancialComponentsDto,gross:string) {
 if(BigInt(value.pre_tax)+BigInt(value.cgst)+BigInt(value.sgst)+BigInt(value.igst)+BigInt(value.rounding)!==BigInt(gross)||BigInt(value.taxable)>BigInt(value.pre_tax))return protocol();
}
export function financialWorkflow(api:ScopedApi) {
 const path='/api/v1/finance/requests';
 return {
  policy:(signal?:AbortSignal)=>api.read(api.path('/api/v1/finance/policy'),object({policy:nullable(policy),writes_enabled:choice(true,false)}),signal),
  configurePolicy:(input:FinancialPolicyInput)=>api.intent('financial.policy.configure',api.path('/api/v1/finance/policy/revisions'),input),
  async context(id:string,signal?:AbortSignal){const result=await api.read(api.path('/api/v1/finance/bookings/'+uuid(id)+'/proposal'),context,signal);if(result.booking_id!==id||new Set(result.refund_targets.map(r=>r.id)).size!==result.refund_targets.length||result.refund_targets.some(r=>BigInt(r.original_paise)===0n||BigInt(r.remaining_paise)===0n||BigInt(r.remaining_paise)>BigInt(r.original_paise)))return protocol();checkPosition(result.position);checkComponents(result.components,result.position.gross);return result;},
  async own(id:string,signal?:AbortSignal){const result=await api.read(api.path('/api/v1/finance/my-requests/'+uuid(id)),own,signal);if(result.request.id!==id||result.request.actor_id!==api.scope.authority?.userId)return protocol();checkRequest(result.request);checkDocuments(result.document_links);return result;},
  async detail(id:string,signal?:AbortSignal){const result=await api.read(api.path(path+'/'+uuid(id)),detailed,signal);if(result.request.id!==id||result.source.booking_id!==result.request.booking_id||result.source.financial_version!==result.request.expected_version||result.source.payment_version!==result.request.payment_version)return protocol();checkRequest(result.request);checkDocuments(result.document_links);checkPosition(result.before);checkPosition(result.proposed);checkComponents(result.source.components,result.before.gross);
   const r=result.request,refunding=r.kind==='refund'||r.kind==='refund_correction',reduction=BigInt(r.pre_tax)+BigInt(r.cgst)+BigInt(r.sgst)+BigInt(r.igst)+BigInt(r.rounding);
   const gross=BigInt(result.before.gross)-(refunding?0n:reduction),held=BigInt(result.before.held)+(r.kind==='refund_correction'?BigInt(r.refund):r.kind==='refund'?-BigInt(r.refund):0n);
   if(BigInt(result.proposed.gross)!==gross||BigInt(result.proposed.held)!==held||BigInt(result.source.components.collections)-BigInt(result.source.components.refunds)!==BigInt(result.before.held))return protocol();return result;},
  request:(input:FinancialProposalInput)=>api.intent('financial.request',api.path(path),input),
  amend:(id:string,input:FinancialProposalInput)=>api.intent('financial.amend',api.path(path+'/'+uuid(id)+'/amend'),{expected_request_version:0,proposal:input}),
  decide:(id:string,outcome:'approved'|'rejected')=>api.intent('financial.decide',api.path(path+'/'+uuid(id)+'/decisions'),{expected_version:0,outcome}),
  apply:(id:string,input:FinancialApplyInput)=>api.intent('financial.apply',api.path(path+'/'+uuid(id)+'/apply'),input),
  execute:(intent:CommandIntent)=>api.execute(intent,object({id:uuid}),['$','Idempotency-Key','expected_version','occurred_at','receipt_id']),
 };
}
export type FinancialWorkflowSource=ReturnType<typeof financialWorkflow>;
