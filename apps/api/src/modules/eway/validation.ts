import { HttpError } from '../../plugins/errors.ts';
import { object,integer,uuid,timestamp } from '../pricing/validation.ts';
import { idempotencyKey } from '../customers/validation.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import type { Capture,Correction,Declaration,External } from './types.ts';
export { uuid,object,keyDigest,idempotencyKey };
const fail=():never=>{throw new HttpError('VALIDATION_FAILED');};
export function reference(value:unknown,max=128):string {
  if(typeof value!=='string')return fail();
  const text=value.replace(/^[ \t]+|[ \t]+$/g,'');
  if(text.length<1||text.length>max||text.includes("://")||/[^A-Za-z0-9.:_/-]/.test(text)||!/^[A-Za-z0-9]/.test(text))return fail();return text;
}
export function external(value:unknown):External|null {
  if(value===null)return null;
  const b=object(value,['issuer','reference','source_ref','issued_at','official_valid_until','validity_evidence_ref']);
  const result={issuer:reference(b.issuer,64),reference:reference(b.reference),source_ref:b.source_ref==null?null:reference(b.source_ref),
    issued_at:b.issued_at==null?null:timestamp(b.issued_at,'$'),official_valid_until:b.official_valid_until==null?null:timestamp(b.official_valid_until,'$'),
    validity_evidence_ref:b.validity_evidence_ref==null?null:reference(b.validity_evidence_ref)};
  if((result.official_valid_until!==null)!==(result.validity_evidence_ref!==null)||
    (result.official_valid_until&&(!result.source_ref||(result.issued_at&&Date.parse(result.official_valid_until)<=Date.parse(result.issued_at)))))fail();
  return result;
}
function declaration(value:unknown):Declaration|null {
  if(value===null)return null;const b=object(value,['value_paise','source_ref']);
  return {value_paise:integer(b.value_paise,'$'),source_ref:reference(b.source_ref)};
}
function vehicle(value:unknown):string|null {
  if(value===null)return null;if(typeof value!=='string')return fail();
  const text=value.replace(/^[ \t]+|[ \t]+$/g,'').replace(/[a-z]/g,c=>c.toUpperCase());
  if(text.length<1||text.length>32||/[^A-Z0-9 -]/.test(text)||!/^[A-Z0-9]/.test(text)||!/[A-Z0-9]$/.test(text))fail();return text;
}
const fields=['declaration','external','vehicle_number','distance_km'] as const;
function editable(b:Record<string,unknown>):Partial<Capture> {
  return {...(Object.hasOwn(b,'declaration')?{declaration:declaration(b.declaration)}:{}),
    ...(Object.hasOwn(b,'external')?{external:external(b.external)}:{}),
    ...(Object.hasOwn(b,'vehicle_number')?{vehicle_number:vehicle(b.vehicle_number)}:{}),
    ...(Object.hasOwn(b,'distance_km')?{distance_km:b.distance_km===null?null:integer(b.distance_km,'$',1,100000)}:{})};
}
export function create(value:unknown):Capture {
  const b=object(value,fields),c={declaration:null,external:null,vehicle_number:null,distance_km:null,...editable(b)};
  if(Object.values(c).every(v=>v===null))fail();return c;
}
export function correction(value:unknown):Correction {
  const b=object(value,[...fields,'expected_version','reason_code','reason_ref']);
  if(!fields.some(f=>Object.hasOwn(b,f))||!['metadata_correction','source_extension','declaration_correction'].includes(String(b.reason_code)))fail();
  return {...editable(b),expected_version:integer(b.expected_version,'expected_version',1,2147483646),reason_code:b.reason_code as Correction['reason_code'],reason_ref:reference(b.reason_ref)};
}
export function recalculate(value:unknown) {
  const b=object(value,['expected_version','reason_ref','starts_at']);
  return {expected_version:integer(b.expected_version,'expected_version',1,2147483646),reason_ref:reference(b.reason_ref),starts_at:timestamp(b.starts_at,'$')};
}
export function selection(value:unknown,paged=false) {
  const q=object(value,['organization_id','franchise_id',...(paged?['limit','cursor']:[])]);
  if(q.limit!==undefined&&(typeof q.limit!=='string'||!/^[1-9][0-9]{0,2}$/.test(q.limit)||Number(q.limit)>100))fail();
  if(q.cursor!==undefined&&(typeof q.cursor!=='string'||!q.cursor.length||q.cursor.length>4096))throw new HttpError('CURSOR_INVALID');
  return {organizationId:uuid(q.organization_id,'organization_id'),franchiseId:uuid(q.franchise_id,'franchise_id'),limit:q.limit===undefined?50:Number(q.limit),cursor:q.cursor as string|undefined};
}
export const fingerprint=(operation:string,booking:string,body:unknown)=>digest({operation_id:`api.v1.eway.${operation}`,resource_ids:{booking_id:booking},content_type:'application/json',query:{},body});
