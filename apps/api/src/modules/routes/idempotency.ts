import { digest } from '../pricing/idempotency.ts';
import type { RouteInput,RouteOperation } from './types.ts';
export { keyDigest } from '../pricing/idempotency.ts';
export function fingerprint(operation:RouteOperation,routeId:string|null,resourceId:string|null,body:RouteInput) {
  return digest({operation_id:`api.v1.${operation}`,resource_ids:{route_id:routeId,source_resource_id:resourceId},content_type:'application/json',query:{},body});
}
