import type {CashbookRequestInput,CashMovementKind} from '@shippingco/shared';
import type {TenantAccess} from '../security/scope.ts';
import {scopedQuery} from '../security/scope.ts';
import {uuid,integer} from '../pricing/validation.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
const actions=['cashbook.request','cashbook.approve','cashbook.apply'] as const;
export function feeInput(b:Record<string,unknown>,kind:CashMovementKind,correction:string|null){
 if(b.fee_earning_id==null){
  if(kind==='agent_fee_payment'||[b.fee_cash_paise,b.fee_advance_paise,b.fee_advance_request_id].some(v=>v!=null))throw new FieldValidationError('$','INVALID_FORMAT');
  return {};
 }
 if(!['expense','agent_fee_payment'].includes(kind))throw new FieldValidationError('$','INVALID_FORMAT');
 const fee_earning_id=uuid(b.fee_earning_id,'$'),fee_cash_paise=integer(b.fee_cash_paise,'amount_paise'),fee_advance_paise=integer(b.fee_advance_paise,'amount_paise'),fee_advance_request_id=b.fee_advance_request_id==null?null:uuid(b.fee_advance_request_id,'$');
 if(fee_advance_paise>0&&!fee_advance_request_id||fee_advance_paise===0&&fee_advance_request_id&&!correction)throw new FieldValidationError('$','INVALID_FORMAT');
 const total=BigInt(fee_cash_paise)+BigInt(fee_advance_paise),gross=BigInt(integer(b.amount_paise,'amount_paise',correction?0:1));
 if(kind==='expense'?total>gross:total!==gross)throw new FieldValidationError('$','OUT_OF_RANGE');
 return {fee_earning_id,fee_cash_paise,fee_advance_paise,fee_advance_request_id};
}
/** Mirrors the locked SQL boundary for actionable failures before immutable writes. */
export async function validateFeeSources(scope:TenantAccess,input:CashbookRequestInput,previous:CashbookRequestInput|null){
 if(input.kind==='agent_advance'&&previous){
  const advance=(await scopedQuery<{applied:string}>(scope,[...actions],`SELECT applied_paise::text applied FROM shipit.agent_advance_positions WHERE {{franchise:organization_id:franchise_id}} AND head_id=$1`,[input.correction_of])).rows[0];
  if(!advance)throw new HttpError('RESOURCE_NOT_FOUND');if(BigInt(input.amount_paise)<BigInt(advance.applied))throw new HttpError('CASHBOOK_CONFLICT');
 }
 if(!input.fee_earning_id)return;
 const fee=(await scopedQuery<{agent_id:string;earned:string;recognized:string;paid:string}>(scope,[...actions],`SELECT agent_id,earned_paise::text earned,expense_paise::text recognized,(cash_paid_paise+advance_applied_paise)::text paid FROM shipit.agent_fee_positions
 WHERE {{franchise:organization_id:franchise_id}} AND earning_id=$1`,[input.fee_earning_id])).rows[0];
 if(!fee||fee.agent_id!==input.agent_payee_id)throw new HttpError('RESOURCE_NOT_FOUND');
 let paid=BigInt(fee.paid),recognized=BigInt(fee.recognized);
 if(previous){paid-=BigInt(previous.fee_cash_paise!)+BigInt(previous.fee_advance_paise!);if(previous.kind==='expense')recognized-=BigInt(previous.amount_paise);}
 const total=BigInt(input.fee_cash_paise!)+BigInt(input.fee_advance_paise!);
 if(input.kind==='expense'?(recognized!==0n||BigInt(input.amount_paise)!==BigInt(fee.earned)):recognized!==BigInt(fee.earned))throw new HttpError('CASHBOOK_CONFLICT');
 if(paid+total>BigInt(fee.earned))throw new HttpError('CASHBOOK_CONFLICT');
 if(input.fee_advance_request_id){
  const advance=(await scopedQuery<{agent_id:string;remaining:string;occurred_at:Date}>(scope,[...actions],`SELECT p.agent_id,p.remaining_paise::text remaining,r.occurred_at FROM shipit.agent_advance_positions p
   JOIN shipit.cashbook_requests r ON r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id AND r.id=p.head_id
   WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.origin_id=$1`,[input.fee_advance_request_id])).rows[0];
  if(!advance||advance.agent_id!==input.agent_payee_id)throw new HttpError('RESOURCE_NOT_FOUND');
  if(input.fee_advance_paise!>0&&advance.occurred_at.getTime()>Date.parse(input.occurred_at))throw new HttpError('CASHBOOK_CONFLICT');
  const released=previous?.fee_advance_request_id===input.fee_advance_request_id?BigInt(previous.fee_advance_paise!):0n;
  if(BigInt(input.fee_advance_paise!)>BigInt(advance.remaining)+released)throw new HttpError('CASHBOOK_CONFLICT');
 }
}
