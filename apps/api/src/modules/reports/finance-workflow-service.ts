import {createHash,randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {withFinancialScope,withReportScope} from '../memberships/service.ts';
import {assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,timestamp,idempotencyKey} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {previewFinancialChange,previewRefundCorrection,financialPosition,type FinancialSource,type FinancialChangeAmounts} from './finance-rules.ts';
import * as finance from './finance-repository.ts';
import * as workflow from './finance-workflow-repository.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface DocumentLink {kind:'issued_receipt'|'external_invoice'|'external_credit_note';receipt_id:string|null;external_ref:string|null}
function documentLinks(value:unknown):DocumentLink[] {
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>10)throw new FieldValidationError('$','OUT_OF_RANGE');
 const links=value.map((item):DocumentLink=>{
  const b=object(item,['kind','receipt_id','external_ref']);
  if(b.kind==='issued_receipt'){
   if(b.external_ref!==undefined&&b.external_ref!==null)throw new FieldValidationError('$','INVALID_FORMAT');
   return {kind:b.kind,receipt_id:uuid(b.receipt_id,'receipt_id'),external_ref:null};
  }
  if(b.kind!=='external_invoice'&&b.kind!=='external_credit_note')throw new FieldValidationError('$','INVALID_FORMAT');
  if(b.receipt_id!==undefined&&b.receipt_id!==null)throw new FieldValidationError('$','INVALID_FORMAT');
  return {kind:b.kind,receipt_id:null,external_ref:reference(b.external_ref)};
 }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 if(new Set(links.map(link=>JSON.stringify(link))).size!==links.length)throw new FieldValidationError('$','INVALID_FORMAT');return links;
}
export function proposalInput(value:unknown) {
 const b=object(value,['booking_id','expected_version','payment_version','kind','reason','pre_tax','taxable','cgst','sgst','igst','rounding','refund','document_links','refund_correction_of']);
 if(typeof b.kind!=='string'||!['discount','cancellation','correction','refund','refund_correction'].includes(b.kind)||typeof b.reason!=='string'||!['customer_agreement','service_recovery','booking_cancelled','incorrect_charge','customer_refund','incorrect_refund_recording'].includes(b.reason))throw new FieldValidationError('$','INVALID_FORMAT');
 if((b.kind==='refund_correction')!==(b.reason==='incorrect_refund_recording')||(b.kind!=='refund_correction'&&b.refund_correction_of!==undefined&&b.refund_correction_of!==null))throw new FieldValidationError('$','INVALID_FORMAT');
 return {booking_id:uuid(b.booking_id,'booking_id'),expected_version:integer(b.expected_version,'expected_version',0,99),payment_version:integer(b.payment_version,'expected_version',0,2147483647),kind:b.kind,reason:b.reason,
 pre_tax:integer(b.pre_tax??0,'$'),taxable:integer(b.taxable??0,'$'),cgst:integer(b.cgst??0,'$'),sgst:integer(b.sgst??0,'$'),igst:integer(b.igst??0,'$'),rounding:integer(b.rounding??0,'$',-99,99),refund:integer(b.refund??0,'$'),document_links:documentLinks(b.document_links),refund_correction_of:b.kind==='refund_correction'?uuid(b.refund_correction_of,'$'):null};
}
function reference(value:unknown):string {
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value))throw new FieldValidationError('$','INVALID_FORMAT');return value;
}
export function refundEvidence(value:unknown) {
 if(value===null||value===undefined)return null;
 const b=object(value,['account_id','expected_account_version','method','occurred_at','returned_to_ref','transfer_ref','cash_location_id','cash_location_revision_id']);
 if(typeof b.method!=='string'||!['cash','upi','bank_transfer','card','other'].includes(b.method))throw new FieldValidationError('$','INVALID_FORMAT');
 const hasLocation=b.cash_location_id!==undefined&&b.cash_location_id!==null,hasRevision=b.cash_location_revision_id!==undefined&&b.cash_location_revision_id!==null;
 if(hasLocation!==hasRevision||(hasLocation&&b.method!=='cash'))throw new FieldValidationError('$','INVALID_FORMAT');
 return {account_id:uuid(b.account_id,'account_id'),expected_account_version:integer(b.expected_account_version,'expected_account_version',1,2147483647),method:b.method,
 occurred_at:timestamp(b.occurred_at,'occurred_at'),returned_to_ref:reference(b.returned_to_ref),transfer_ref:reference(b.transfer_ref),...(hasLocation?{cash_location_id:uuid(b.cash_location_id,'$'),cash_location_revision_id:uuid(b.cash_location_revision_id,'$')}:{})};
}
async function previewChange(scope:TenantAccess,source:FinancialSource,input:FinancialChangeAmounts&{booking_id:string;refund_correction_of?:string|null},prefix:number|null=null) {
 if(input.kind!=='refund_correction')return previewFinancialChange(source,input);
 if(!input.refund_correction_of||['pre_tax','taxable','cgst','sgst','igst','rounding'].some(field=>input[field as keyof FinancialChangeAmounts]!==0))throw new HttpError('FINANCIAL_CONFLICT');
 const target=await workflow.refundTarget(scope,input.booking_id,input.refund_correction_of,prefix);
 return previewRefundCorrection(source,BigInt(target.refund),BigInt(target.corrected),input.refund);
}
export function createFinancialWorkflowService(database:DatabasePool,writesEnabled=false,cashbookWritesEnabled=false) {
 return {
  async readPolicy(session:string,query:unknown,correlation:string) {
   const q=selection(query);return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.policy.configure',correlation,async scope=>{
    await finance.lock(scope);return {policy:await workflow.policy(scope),writes_enabled:writesEnabled};
   });
  },
  async configurePolicy(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),b=object(body,['expected_version','enabled','discount_review_threshold_paise','allow_self_approval']),expected=integer(b.expected_version,'expected_version',0,2147483646);
   if(typeof b.enabled!=='boolean'||b.discount_review_threshold_paise!==null||b.allow_self_approval!==false)throw new FieldValidationError('$','INVALID_FORMAT');
   const enabled=b.enabled,key=hash('financial.policy.configure:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify({expected,enabled,discount_review_threshold_paise:null,allow_self_approval:false}));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.policy.configure',correlation,async scope=>{
    await finance.lock(scope);const previous=await workflow.policyReplay(scope,key);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id,version:previous.version,discount_review_threshold_paise:previous.discount_review_threshold_paise,allow_self_approval:previous.allow_self_approval,enabled:previous.enabled};}
    const current=await workflow.policy(scope);if((current?.version??0)!==expected)throw new HttpError('VERSION_CONFLICT');
    // Prepare policy while the separately configured workflow feature flag is disabled.
    return workflow.appendPolicy(scope,key,fingerprint,expected,enabled);
   });
  },
  async denyDeletion(session:string,query:unknown,idInput:unknown,correlation:string):Promise<never> {
   const q=selection(query),id=uuid(idInput,'$');
   // Commit verified owned denial evidence before returning the forbidden response.
   await withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    await workflow.request(scope,id);await workflow.recordDeniedDeletion(scope,id);
   });
   throw new HttpError('ACTION_FORBIDDEN');
  },
  async proposalContext(session:string,query:unknown,bookingInput:unknown,correlation:string):Promise<import('@shippingco/shared').FinancialProposalContext> {
   const q=selection(query),id=uuid(bookingInput,'$');
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.request',correlation,async scope=>{
    // Same monetary lock order as commands; all displayed choices use this retained source version.
    await finance.lock(scope);const current=await finance.current(scope,id,true),position=financialPosition(BigInt(current.gross),BigInt(current.collections),BigInt(current.refunds));
    await workflow.requestAccess(scope,id);
    return {booking_id:id,expected_version:current.version,payment_version:current.payment_version,
     components:{pre_tax:current.pre_tax,taxable:current.taxable,cgst:current.cgst,sgst:current.sgst,igst:current.igst,rounding:current.rounding},
     position:{gross:position.gross.toString(),held:position.held.toString(),outstanding:position.outstanding.toString(),refundable_credit:position.refundable_credit.toString()},refund_targets:await workflow.refundTargets(scope,id,current.version)};
   });
  },
  async ownRequest(session:string,query:unknown,idInput:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.request',correlation,async scope=>{
    const request=await workflow.request(scope,id);
    if(request.actor_id!==assertTenantAccess(scope,['finance.request']).actor.id)throw new HttpError('RESOURCE_NOT_FOUND');
    await workflow.requestAccess(scope,request.booking_id);
    return {request,document_links:await workflow.documentLinks(scope,id)};
   });
  },
  async requestDetail(session:string,query:unknown,idInput:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');
   return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
    const request=await workflow.request(scope,id),source=await workflow.requestObservation(scope,request);
    const preview=await previewChange(scope,source,{booking_id:request.booking_id,refund_correction_of:request.refund_correction_of,kind:request.kind,pre_tax:Number(request.pre_tax),taxable:Number(request.taxable),cgst:Number(request.cgst),sgst:Number(request.sgst),igst:Number(request.igst),rounding:Number(request.rounding),refund:Number(request.refund)},request.expected_version);
    const amounts=(position:typeof preview.before)=>Object.fromEntries(Object.entries(position).map(([field,value])=>[field,value.toString()]));
    await finance.access(scope,request.booking_id,'financial.read');
    return {request,document_links:await workflow.documentLinks(scope,id),decisions:await workflow.decisionHistory(scope,id),source:{booking_id:request.booking_id,financial_version:request.expected_version,payment_version:request.payment_version,components:source},before:amounts(preview.before),proposed:amounts(preview.after)};
   });
  },
  async amend(session:string,query:unknown,idInput:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$'),b=object(body,['expected_request_version','proposal']),expected=integer(b.expected_request_version,'expected_version',0,0),input=proposalInput(b.proposal);
   const key=hash('financial.amend:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify({id,expected,input}));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.request',correlation,async scope=>{
    await finance.lock(scope);const previous=await workflow.replay(scope,key,false);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id};}
    if(!writesEnabled)throw new HttpError('FINANCIAL_WORKFLOW_DISABLED');
    const original=await workflow.request(scope,id);
    if(original.actor_id!==assertTenantAccess(scope,['finance.request']).actor.id||original.booking_id!==input.booking_id)throw new HttpError('RESOURCE_NOT_FOUND');
    if(original.version!==expected||original.outcome!=='pending')throw new HttpError('VERSION_CONFLICT');
    const current=await finance.current(scope,input.booking_id,true);
    if(current.version!==input.expected_version||current.payment_version!==input.payment_version)throw new HttpError('VERSION_CONFLICT');
    await previewChange(scope,current,input);const policy=await workflow.policy(scope);
    const result=await workflow.appendRequest(scope,key,fingerprint,input,policy?.id??null,id);
    await workflow.appendSuperseded(scope,id,key,fingerprint);return result;
   });
  },
  async request(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),input=proposalInput(body),key=hash('financial.request:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify(input));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.request',correlation,async scope=>{
    await finance.lock(scope);const previous=await workflow.replay(scope,key,false);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id};}
    if(!writesEnabled)throw new HttpError('FINANCIAL_WORKFLOW_DISABLED');
    const current=await finance.current(scope,input.booking_id,true);
    if(current.version!==input.expected_version||current.payment_version!==input.payment_version)throw new HttpError('VERSION_CONFLICT');
    await previewChange(scope,current,input);const policy=await workflow.policy(scope);
    return workflow.appendRequest(scope,key,fingerprint,input,policy?.id??null);
   });
  },
  async apply(session:string,query:unknown,idInput:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$'),b=object(body,['expected_version','refund_evidence']),expected=integer(b.expected_version,'expected_version',1,1),evidence=refundEvidence(b.refund_evidence);
   const key=hash('financial.apply:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify({id,expected,evidence}));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.apply',correlation,async scope=>{
    await finance.lock(scope);const previous=await workflow.replay(scope,key,true);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id};}
    if(!writesEnabled)throw new HttpError('FINANCIAL_WORKFLOW_DISABLED');
    const request=await workflow.request(scope,id);if(request.version!==expected||request.outcome!=='approved')throw new HttpError('VERSION_CONFLICT');
    const policy=await workflow.policy(scope);if(!policy?.enabled||policy.id!==request.policy_id)throw new HttpError('FINANCIAL_APPROVAL_REQUIRED');
    if((request.kind==='refund')!==(evidence!==null))throw new FieldValidationError('$','INVALID_FORMAT');
    const current=await finance.current(scope,request.booking_id,true);
    if(current.version!==request.expected_version||current.payment_version!==request.payment_version)throw new HttpError('VERSION_CONFLICT');
    const input={booking_id:request.booking_id,expected_version:request.expected_version,payment_version:request.payment_version,kind:request.kind,reason:request.reason,
     pre_tax:Number(request.pre_tax),taxable:Number(request.taxable),cgst:Number(request.cgst),sgst:Number(request.sgst),igst:Number(request.igst),rounding:Number(request.rounding),refund:Number(request.refund),refund_correction_of:request.refund_correction_of,approval_ref:id,returned_to_ref:evidence?.returned_to_ref??null};
    await previewChange(scope,current,input);
    const account=evidence?await workflow.refundAccount(scope,evidence.account_id):null;
    if(evidence&&account){
     if(evidence.method==='cash'&&cashbookWritesEnabled&&!evidence.cash_location_id)throw new FieldValidationError('$','REQUIRED');
     if(evidence.cash_location_id)await workflow.refundCashLocation(scope,evidence.cash_location_id,evidence.cash_location_revision_id!,evidence.account_id,account.id);
     if(!account.active||account.version!==evidence.expected_account_version)throw new HttpError('VERSION_CONFLICT');
     if(await workflow.refundReferenceExists(scope,evidence.account_id,evidence.method,evidence.transfer_ref))throw new HttpError('FINANCIAL_REFUND_REFERENCE_CONFLICT');
     if(!account.methods.includes(evidence.method)||new Date(evidence.occurred_at)>(await workflow.serverTime(scope)))throw new FieldValidationError('$','INVALID_FORMAT');
    }
    const change=randomUUID();await finance.append(scope,change,key,fingerprint,input,request.refund_correction_of);
    if(evidence&&account)await workflow.appendRefundEvidence(scope,change,id,account.id,evidence);
    return workflow.appendApplied(scope,key,fingerprint,id,change);
   });
  },
  async decide(session:string,query:unknown,idInput:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$'),b=object(body,['expected_version','outcome']);
   const expected=integer(b.expected_version,'expected_version',0,1);
   if(b.outcome!=='approved'&&b.outcome!=='rejected')throw new FieldValidationError('$','INVALID_FORMAT');
   const outcome=b.outcome,key=hash('financial.decide:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify({id,expected,outcome}));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.approve',correlation,async scope=>{
    await finance.lock(scope);const previous=await workflow.replay(scope,key,true);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id};}
    if(!writesEnabled)throw new HttpError('FINANCIAL_WORKFLOW_DISABLED');
    const request=await workflow.request(scope,id);if(request.version!==expected||request.outcome!=='pending')throw new HttpError('VERSION_CONFLICT');
    if(outcome==='approved'){
     const policy=await workflow.policy(scope);
     if(!policy?.enabled||policy.id!==request.policy_id)throw new HttpError('FINANCIAL_APPROVAL_REQUIRED');
     if(!policy.allow_self_approval&&request.actor_id===assertTenantAccess(scope,['finance.approve']).actor.id)throw new HttpError('ACTION_FORBIDDEN');
     const current=await finance.current(scope,request.booking_id,true);
     if(current.version!==request.expected_version||current.payment_version!==request.payment_version)throw new HttpError('VERSION_CONFLICT');
    }
    return workflow.appendDecision(scope,key,fingerprint,id,outcome);
   });
  },
 };
}
