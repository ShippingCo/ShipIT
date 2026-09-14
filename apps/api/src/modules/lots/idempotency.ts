import { digest } from '../pricing/idempotency.ts';
import type { LotInput,LotOperation } from './types.ts';
export { keyDigest } from '../pricing/idempotency.ts';
export function fingerprint(operation:LotOperation,lotId:string|null,parcelId:string|null,body:LotInput) {
  return digest({operation_id:`api.v1.${operation}`,resource_ids:{lot_id:lotId,parcel_id:parcelId},content_type:'application/json',query:{},body});
}
