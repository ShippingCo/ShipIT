import type { PricingDraftInput, PricingRuleInput, PricingService } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import * as p from '../pricing/validation.ts';
import { code, object } from './validation.ts';
import { CsvError, decodeCsv } from './csv.ts';

export const rateFields=['service_code','origin_code','destination_code','min_weight','max_weight','weight_unit','freight','packing','currency','amount_unit'] as const;
export interface RateBinding { mapping_id:string; target:string }
export interface RateConfig {
  purpose:'customer_selling'|'courier_purchase_estimate';origin_mapping_id:string;
  services:RateBinding[];locations:RateBinding[];expected_lanes:{destination_key:string;service:PricingService}[];
  weight_unit:'g'|'kg';amount_unit:'paise'|'rupees';policy:Omit<PricingDraftInput,'rules'|'source_ref'>;
}
export interface RateRow {row:number;error:string|null;source:{service:string;origin:string;destination:string}|null;
  rule:PricingRuleInput|null;mapping_ids?:string[];canonical_ids?:{service:string;origin:string;destination:string}}
function fail():never {throw new HttpError('VALIDATION_FAILED');}
function service(value:unknown):PricingService {if(!['standard','express','same_city'].includes(String(value)))fail();return value as PricingService;}
function destination(value:unknown) {if(typeof value!=='string'||!/^[A-Z][A-Z0-9_]{0,31}$/.test(value)||value.includes('\n'))fail();return value;}
export function exactUnit(value:string,places:number):number {
  if(!new RegExp(`^(0|[1-9][0-9]*)(?:\\.([0-9]{1,${Math.max(1,places)}}))?$`).test(value)||(!places&&value.includes('.')))fail();
  const [whole,fraction='']=value.split('.');
  const result=BigInt(whole!)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0')||'0');
  if(result>BigInt(Number.MAX_SAFE_INTEGER))fail();return Number(result);
}
export function rateUpload(value:unknown) {
  const b=object(value,['purpose','origin_mapping_id','services','locations','expected_lanes','weight_unit','amount_unit','policy','content_base64']);
  if(!['customer_selling','courier_purchase_estimate'].includes(String(b.purpose))||!['g','kg'].includes(String(b.weight_unit))||!['paise','rupees'].includes(String(b.amount_unit)))fail();
  function bindings(value:unknown,kind:'service'|'location'):RateBinding[] {
    if(!Array.isArray(value)||value.length>100)fail();
    const result=value.map(item=>{const v=object(item,['mapping_id','target']);return {mapping_id:p.uuid(v.mapping_id,'$'),target:kind==='service'?service(v.target):destination(v.target)};});
    if(new Set(result.map(r=>r.mapping_id)).size!==result.length)fail();return result;
  }
  if(!Array.isArray(b.expected_lanes)||!b.expected_lanes.length||b.expected_lanes.length>100)fail();
  const lanes=b.expected_lanes.map(item=>{const v=object(item,['destination_key','service']);return {destination_key:destination(v.destination_key),service:service(v.service)};});
  if(new Set(lanes.map(l=>JSON.stringify(l))).size!==lanes.length)fail();
  const policy=object(b.policy,['effective_from','effective_to','quote_validity_seconds','override_tolerance_paise','approval_ref']);
  const validated=p.draft({...policy,source_ref:'carrier-import',rules:[{destination_key:'VALIDATE',service:'standard',min_weight_grams:1,max_weight_grams:null,freight_paise:0,packing_paise:0}]});
  const config:RateConfig={purpose:b.purpose as RateConfig['purpose'],origin_mapping_id:p.uuid(b.origin_mapping_id,'$'),
    services:bindings(b.services,'service'),locations:bindings(b.locations,'location'),expected_lanes:lanes,
    weight_unit:b.weight_unit as RateConfig['weight_unit'],amount_unit:b.amount_unit as RateConfig['amount_unit'],
    policy:{effective_from:validated.effective_from,effective_to:validated.effective_to,quote_validity_seconds:validated.quote_validity_seconds,
      override_tolerance_paise:validated.override_tolerance_paise,approval_ref:validated.approval_ref}};
  const csv=decodeCsv(b.content_base64);
  if(csv.headers.length!==rateFields.length||rateFields.some((field,i)=>csv.headers[i]!==field))throw new CsvError('RATE_HEADERS',1);
  if(csv.records.length>100)throw new CsvError('TOO_MANY_RATE_ROWS');
  const rows:RateRow[]=csv.records.map((cells,i)=>{
    const row:RateRow={row:i+2,error:null,source:null,rule:null};
    if(cells.length!==rateFields.length)return {...row,error:'COLUMN_COUNT'};
    const [svc,origin,dest,min,max,weight,freight,packing,currency,amount]=cells as [string,string,string,string,string,string,string,string,string,string];
    if(currency!=='INR'||weight!==config.weight_unit||amount!==config.amount_unit)return {...row,error:'UNIT_MISMATCH'};
    try {
      row.source={service:code(svc),origin:code(origin),destination:code(dest)};
      const rule={destination_key:'UNMAPPED',service:'standard' as const,min_weight_grams:exactUnit(min,weight==='kg'?3:0),
        max_weight_grams:max===''?null:exactUnit(max,weight==='kg'?3:0),freight_paise:exactUnit(freight,amount==='rupees'?2:0),packing_paise:exactUnit(packing,amount==='rupees'?2:0)};
      row.rule=p.draft({...config.policy,source_ref:'carrier-import',rules:[rule]}).rules[0]!;
      return row;
    }catch {return {...row,source:null,error:'INVALID_RATE'};}
  });
  return {config,rows,file_sha256:csv.file_sha256};
}
