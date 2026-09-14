import { digest } from '../pricing/idempotency.ts';
import type { ParcelCommandInput,ParcelOperation } from './types.ts';
export { keyDigest } from '../pricing/idempotency.ts';
export function fingerprint(operation:ParcelOperation,parcelId:string,body:ParcelCommandInput) {
  return digest({operation_id:`api.v1.${operation}`,resource_ids:{parcel_id:parcelId},content_type:'application/json',query:{},body});
}
