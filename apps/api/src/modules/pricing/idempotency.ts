import { createHash } from 'node:crypto';
import type { PricingOperation } from './types.ts';
export { keyDigest } from '../customers/idempotency.ts';
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function digest(value:unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function fingerprint(operation:PricingOperation,id:string|null,body:unknown) {
  return digest({body,content_type:'application/json',operation_id:operation,query:{},resource_ids:id?{version_id:id}:{}});
}
