import type { PricingService } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import { object,integer,uuid } from '../pricing/validation.ts';

export interface QuoteInput {origin_key:string;destination_key:string;weight_grams:number;dimensions_mm:[number,number,number];service:PricingService}
export type QuoteDraft=Partial<QuoteInput>;
export interface QuotePolicy {
 enabled:boolean;origin_key:string;rate_version_id:string;heavy_weight_grams:number;large_dimension_mm:number;manual_review:boolean;
 lanes:{destination_key:string;service:PricingService;weight_only:boolean}[];
}
export const exclusions=['tax','final_payable_rounding','pickup','insurance','special_handling'] as const;
export const quoteReference=/^(?:quote|confirm quote)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function location(value:unknown) {
 if(typeof value!=='string'||!/^[A-Z][A-Z0-9_]{0,31}$/.test(value))throw new HttpError('VALIDATION_FAILED');return value;
}
function service(value:unknown):PricingService {
 if(value!=='standard'&&value!=='express'&&value!=='same_city')throw new HttpError('VALIDATION_FAILED');return value;
}
function boolean(value:unknown):boolean {if(typeof value!=='boolean')throw new HttpError('VALIDATION_FAILED');return value;}
export function policyInput(value:unknown):QuotePolicy&{expected_version:number} {
 const b=object(value,['enabled','origin_key','rate_version_id','heavy_weight_grams','large_dimension_mm','manual_review','lanes','expected_version']);
 if(!Array.isArray(b.lanes)||b.lanes.length<1||b.lanes.length>100)throw new HttpError('VALIDATION_FAILED');
 const lanes=b.lanes.map(value=>{const r=object(value,['destination_key','service','weight_only']);return {destination_key:location(r.destination_key),service:service(r.service),weight_only:boolean(r.weight_only)};});
 if(new Set(lanes.map(l=>l.destination_key+':'+l.service)).size!==lanes.length)throw new HttpError('VALIDATION_FAILED');
 return {enabled:boolean(b.enabled),origin_key:location(b.origin_key),rate_version_id:uuid(b.rate_version_id,'$'),
  heavy_weight_grams:integer(b.heavy_weight_grams,'$',1,1000000000),large_dimension_mm:integer(b.large_dimension_mm,'$',1,100000),
  manual_review:boolean(b.manual_review),lanes,expected_version:integer(b.expected_version,'$',0,2147483646)};
}
export function validatedInput(value:unknown):QuoteInput {
 const b=object(value,['origin_key','destination_key','weight_grams','dimensions_mm','service']);
 if(!Array.isArray(b.dimensions_mm)||b.dimensions_mm.length!==3)throw new HttpError('VALIDATION_FAILED');
 return {origin_key:location(b.origin_key),destination_key:location(b.destination_key),weight_grams:integer(b.weight_grams,'$',1,1000000000),
  dimensions_mm:b.dimensions_mm.map(v=>integer(v,'$',1,100000)) as [number,number,number],service:service(b.service)};
}
export function referral(policy:QuotePolicy,input:QuoteInput):string|null {
 if(!policy.enabled)return 'policy_unavailable';
 if(input.origin_key!==policy.origin_key)return 'unsupported_origin';
 if(policy.manual_review)return 'manual_review';
 if(input.weight_grams>=policy.heavy_weight_grams)return 'heavy';
 if(input.dimensions_mm.some(v=>v>=policy.large_dimension_mm))return 'large';
 const lane=policy.lanes.find(l=>l.destination_key===input.destination_key&&l.service===input.service);
 if(!lane)return 'unsupported_lane';
 return lane.weight_only?null:'dimensional_review';
}
const prompts={origin_key:'Send the origin location key supplied by the franchise (for example AHMEDABAD).',destination_key:'Send the destination location key supplied by the franchise.',
 weight_grams:'Send the actual weight in whole grams (for example 1500).',dimensions_mm:'Send length x width x height in whole millimetres (for example 100 x 200 x 300). Dimensions are required to check large shipments.',
 service:'Send the service: standard, express or same_city.'};
const fields=['origin_key','destination_key','weight_grams','dimensions_mm','service'] as const;
export function dialogue(draft:QuoteDraft,text:string):{draft:QuoteDraft;prompt:string|null;complete:QuoteInput|null} {
 const next=fields.find(f=>draft[f]===undefined);
 if(!next)return {draft,prompt:null,complete:validatedInput(draft)};
 const result={...draft};
 try {
  const input=text.trim();
  if(next==='origin_key'||next==='destination_key')result[next]=location(input.toUpperCase());
  else if(next==='weight_grams') {if(!/^\d{1,10}$/.test(input))throw new Error();result.weight_grams=integer(Number(input),'$',1,1000000000);}
  else if(next==='dimensions_mm') {
   const m=input.match(/^(\d{1,6})\s*x\s*(\d{1,6})\s*x\s*(\d{1,6})(?:\s*mm)?$/i);if(!m)throw new Error();
   result.dimensions_mm=m.slice(1,4).map(v=>integer(Number(v),'$',1,100000)) as [number,number,number];
  } else result.service=service(input.toLowerCase());
 }catch{return {draft,prompt:'That value is invalid. '+prompts[next],complete:null};}
 const missing=fields.find(f=>result[f]===undefined);
 return {draft:result,prompt:missing?prompts[missing]:null,complete:missing?null:validatedInput(result)};
}
export const firstPrompt='This is a non-binding shipping estimate for one package, not a booking or invoice. '+prompts.origin_key;
