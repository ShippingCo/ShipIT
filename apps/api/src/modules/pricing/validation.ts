import type { PricingDraftInput, PricingQuoteInput, PricingService, PricingOverrideReason } from '@shippingco/shared';
import { FieldValidationError, type ValidationField, type ValidationCode } from '../../plugins/errors.ts';
import { instant } from './types.ts';
export { idempotencyKey, noQuery } from '../customers/validation.ts';
function fail(field:ValidationField,code:ValidationCode):never { throw new FieldValidationError(field,code); }
export function object(value:unknown,fields:readonly string[]) {
  if(!value || typeof value!=='object' || Array.isArray(value))fail('$','INVALID_TYPE');
  if(Reflect.ownKeys(value).some(k=>typeof k!=='string'||!fields.includes(k)))fail('$','UNKNOWN_FIELD');
  return value as Record<string,unknown>;
}
export function integer(value:unknown,field:ValidationField,min=0,max=Number.MAX_SAFE_INTEGER):number {
  if(value===undefined)fail(field,'REQUIRED');
  if(typeof value!=='number')fail(field,'INVALID_TYPE');
  if(!Number.isSafeInteger(value)||value<min||value>max)fail(field,'OUT_OF_RANGE');
  return Object.is(value,-0)?0:value;
}
export function uuid(value:unknown,field:ValidationField='version_id') {
  if(typeof value!=='string'||value.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))fail(field,'INVALID_FORMAT');
  return value;
}
function key(value:unknown,field:ValidationField):string {
  if(typeof value!=='string'||value.length>32||!/^[A-Z][A-Z0-9_]{0,31}$/.test(value)||value.includes('\n'))fail(field,'INVALID_FORMAT');
  return value;
}
function reference(value:unknown,field:ValidationField):string {
  if(typeof value!=='string'||value.length>128||!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)||value.includes('\n'))fail(field,'INVALID_FORMAT');
  return value;
}
function service(value:unknown):PricingService {
  if(value!=='standard'&&value!=='express'&&value!=='same_city')fail('service','INVALID_FORMAT');
  return value;
}
export function timestamp(value:unknown,field:ValidationField):string {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)||value.includes('\n'))fail(field,'INVALID_FORMAT');
  const local=value.slice(0,19),date=new Date(local+'Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==local||value.startsWith('0000'))fail(field,'INVALID_FORMAT');
  const result=new Date(value);
  if(!Number.isFinite(result.getTime())||result.getUTCFullYear()<1||result.getUTCFullYear()>9999)fail(field,'INVALID_FORMAT');
  return instant(result);
}
export function draft(value:unknown,replace=false):PricingDraftInput & {expected_version?:number} {
  const b=object(value,['effective_from','effective_to','quote_validity_seconds','override_tolerance_paise','approval_ref','source_ref','rules',...(replace?['expected_version']:[])]);
  const from=timestamp(b.effective_from,'effective_from'),to=timestamp(b.effective_to,'effective_to');
  if(Date.parse(from)>=Date.parse(to))fail('effective_to','OUT_OF_RANGE');
  if(!Array.isArray(b.rules)||b.rules.length<1||b.rules.length>100)fail('rules','OUT_OF_RANGE');
  return {effective_from:from,effective_to:to,quote_validity_seconds:integer(b.quote_validity_seconds,'quote_validity_seconds',1,86400),
    override_tolerance_paise:integer(b.override_tolerance_paise,'override_tolerance_paise'),approval_ref:reference(b.approval_ref,'approval_ref'),source_ref:reference(b.source_ref,'source_ref'),
    ...(replace?{expected_version:integer(b.expected_version,'expected_version',1,2147483646)}:{}),
    rules:b.rules.map(value=>{
      const r=object(value,['destination_key','service','min_weight_grams','max_weight_grams','freight_paise','packing_paise']);
      const min=integer(r.min_weight_grams,'min_weight_grams',1),max=r.max_weight_grams===null?null:integer(r.max_weight_grams,'max_weight_grams',1);
      if(max!==null&&max<=min)fail('max_weight_grams','OUT_OF_RANGE');
      const freight=integer(r.freight_paise,'freight_paise'),packing=integer(r.packing_paise,'packing_paise');
      if(BigInt(freight)+BigInt(packing)>BigInt(Number.MAX_SAFE_INTEGER))fail('freight_paise','OUT_OF_RANGE');
      return {destination_key:key(r.destination_key,'destination_key'),service:service(r.service),min_weight_grams:min,max_weight_grams:max,freight_paise:freight,packing_paise:packing};
    })};
}
export function publish(value:unknown) { const b=object(value,['expected_version']);return {expected_version:integer(b.expected_version,'expected_version',1,2147483646)}; }
export function quote(value:unknown):PricingQuoteInput {
  const b=object(value,['destination_key','service','weight_grams','override']);
  let override:PricingQuoteInput['override'];
  if(b.override!==undefined) {
    const o=object(b.override,['freight_paise','reason_code']);
    if(!['customer_agreement','service_recovery','commercial_exception'].includes(o.reason_code as string))fail('reason_code','REQUIRED');
    override={freight_paise:integer(o.freight_paise,'freight_paise'),reason_code:o.reason_code as PricingOverrideReason};
  }
  return {destination_key:key(b.destination_key,'destination_key'),service:service(b.service),weight_grams:integer(b.weight_grams,'weight_grams',1),...(override?{override}:{})};
}
export function selection(value:unknown) {
  const b=object(value,['organization_id','franchise_id']);
  return {organizationId:uuid(b.organization_id,'organization_id'),franchiseId:uuid(b.franchise_id,'franchise_id')};
}
