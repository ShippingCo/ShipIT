import type { TaxIntentInput } from '@shippingco/shared';
import { FieldValidationError,HttpError } from '../../plugins/errors.ts';
import { createInput } from '../customers/validation.ts';
import { intent, integer, object, uuid } from '../tax/validation.ts';
import type { ParcelFilter,ParcelSort,ParcelStatus } from './types.ts';
export { idempotencyKey, selection } from '../tax/validation.ts';
export const MAX_PARCELS = 50;
export interface ParcelInput { weight_grams: number; docket: string|null; recipient: ReturnType<typeof createInput> }
export interface BookingInput { customer_id: string; expected_customer_version: number; tax_calculation_id: string; tax_intent: TaxIntentInput; parcels: ParcelInput[] }
export function docket(value: unknown): string {
  if (typeof value !== 'string') throw new FieldValidationError('docket','INVALID_TYPE');
  const normalized = value.replace(/^[ \t]+|[ \t]+$/g,'').replace(/[a-z]/g,c => c.toUpperCase());
  if (normalized.length > 32 || !/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/.test(normalized)) throw new FieldValidationError('docket','INVALID_FORMAT');
  return normalized;
}
export function create(value: unknown): BookingInput {
  const b = object(value,['customer_id','expected_customer_version','tax_calculation_id','tax_intent','parcels']);
  if (!Array.isArray(b.parcels) || b.parcels.length < 1 || b.parcels.length > MAX_PARCELS) throw new FieldValidationError('parcels','OUT_OF_RANGE');
  const parcels = b.parcels.map(value => {
    const p = object(value,['weight_grams','docket','recipient']);
    return { weight_grams: integer(p.weight_grams,'weight_grams',1),docket: p.docket === undefined ? null : docket(p.docket),recipient: createInput(p.recipient) };
  });
  const tax = intent(b.tax_intent);
  if (parcels.reduce((sum,p) => sum+BigInt(p.weight_grams),0n) !== BigInt(tax.pricing_input.weight_grams)) throw new FieldValidationError('weight_grams','OUT_OF_RANGE');
  return { customer_id: uuid(b.customer_id,'customer_id'),expected_customer_version: integer(b.expected_customer_version,'expected_customer_version',1,2147483647),
    tax_calculation_id: uuid(b.tax_calculation_id,'tax_calculation_id'),tax_intent: tax,parcels };
}

const statuses:readonly ParcelStatus[]=['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto'];
const sorts:readonly ParcelSort[]=['created_at_desc','created_at_asc','docket_asc','docket_desc'];
const fail=(field:'$'|'organization_id'|'franchise_id'|'status'|'from'|'to'|'sort'|'limit'|'cursor'|'customer_id'|'parcel_id',code:'REQUIRED'|'INVALID_TYPE'|'INVALID_FORMAT'|'OUT_OF_RANGE'|'UNKNOWN_FIELD'='INVALID_FORMAT'):never=>{throw new FieldValidationError(field,code);};
function queryUuid(value:unknown,field:'organization_id'|'franchise_id'|'customer_id') {
  if(value===undefined)return field==='organization_id'?fail(field,'REQUIRED'):null;
  try{return uuid(value,field);}catch{return fail(field,typeof value==='string'?'INVALID_FORMAT':'INVALID_TYPE');}
}
function date(value:unknown,field:'from'|'to') {
  if(value===undefined)return null;
  if(typeof value!=='string')return fail(field,'INVALID_TYPE');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))return fail(field);
  const parsed=new Date(value);
  if(value.startsWith('0000-')||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,19)!==value.slice(0,19))return fail(field);
  return parsed.toISOString();
}
export function parcelList(value:unknown):ParcelFilter {
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('organization_id','REQUIRED');
  const input=value as Record<string,unknown>,allowed=['organization_id','franchise_id','docket','status','customer_id','from','to','sort','limit','cursor'];
  if(Reflect.ownKeys(input).some(key=>typeof key!=='string'||!allowed.includes(key)))return fail('$','UNKNOWN_FIELD');
  const organizationId=queryUuid(input.organization_id,'organization_id')!,franchiseId=queryUuid(input.franchise_id,'franchise_id');
  let docketValue:string|null=null;
  if(input.docket!==undefined)docketValue=docket(input.docket);
  if(input.status!==undefined&&(typeof input.status!=='string'||!statuses.includes(input.status as ParcelStatus)))return fail('status',typeof input.status==='string'?'INVALID_FORMAT':'INVALID_TYPE');
  if(input.sort!==undefined&&(typeof input.sort!=='string'||!sorts.includes(input.sort as ParcelSort)))return fail('sort',typeof input.sort==='string'?'INVALID_FORMAT':'INVALID_TYPE');
  const limit=input.limit===undefined?50:Number(input.limit);
  if(input.limit!==undefined&&(typeof input.limit!=='string'||!/^[1-9][0-9]*$/.test(input.limit))||!Number.isSafeInteger(limit)||limit<1||limit>100)return fail('limit','OUT_OF_RANGE');
  if(input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length>4096))return fail('cursor',typeof input.cursor==='string'?'OUT_OF_RANGE':'INVALID_TYPE');
  if(input.cursor==='')throw new HttpError('CURSOR_INVALID');
  const from=date(input.from,'from'),to=date(input.to,'to');if(from&&to&&from>=to)return fail('to','OUT_OF_RANGE');
  return {organizationId,franchiseId,docket:docketValue,status:input.status as ParcelStatus??null,
    customerId:queryUuid(input.customer_id,'customer_id'),from,to,sort:input.sort as ParcelSort??'created_at_desc',limit,cursor:input.cursor as string??null};
}
export function parcelSelection(value:unknown) {
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('organization_id','REQUIRED');
  const input=value as Record<string,unknown>;
  if(Reflect.ownKeys(input).some(key=>typeof key!=='string'||!['organization_id','franchise_id'].includes(key)))return fail('$','UNKNOWN_FIELD');
  return {organizationId:queryUuid(input.organization_id,'organization_id')!,franchiseId:queryUuid(input.franchise_id,'franchise_id')};
}
export function parcelId(value:unknown) {try{return uuid(value,'parcel_id');}catch{return fail('parcel_id',typeof value==='string'?'INVALID_FORMAT':'INVALID_TYPE');}}
