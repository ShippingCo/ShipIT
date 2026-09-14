import { MAX_BULK_PARCELS, bulkParcelFailureCodes, type BulkParcelRequest, type BulkParcelResult,
  type BulkParcelItemResult, type ParcelTransitionDto } from '@shippingco/shared';
import { browserConfig } from '../config';
import { createApiClient } from './api-client';
import { createCommandIntent, executeIntent, type CommandIntent } from './command-intent';
import { ApiFailure } from './errors';
import type { ScopeTicket } from './scope-runtime';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const protocol = (): never => { throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{ kind:'protocol',dispatched:true }); };
/** Validate correlation/completeness before publishing any success; discard extra fields. */
export function parcelBulkResult(value: unknown, request: BulkParcelRequest): BulkParcelResult {
  const b = record(value), summary = record(b.summary);
  const expected = new Map(request.items.map(item => [item.parcel_id,item]));
  if (b.action !== request.action || !Array.isArray(b.items) || b.items.length !== expected.size) return protocol();
  const seen = new Set<string>();
  const items: BulkParcelItemResult[] = b.items.map(value => {
    const item = record(value), id = item.parcel_id;
    if (typeof id !== 'string' || !expected.has(id) || seen.has(id)) return protocol();
    seen.add(id);
    if (item.outcome === 'failed') {
      const code = record(item.error).code;
      if (!bulkParcelFailureCodes.includes(code as never)) return protocol();
      return { parcel_id:id,outcome:'failed',error:{ code:code as typeof bulkParcelFailureCodes[number] } };
    }
    const r = record(item.result);
    if (item.outcome !== 'succeeded' || r.id !== id || typeof r.booking_id !== 'string' || !uuid.test(r.booking_id) ||
      typeof r.event_id !== 'string' || !uuid.test(r.event_id) || typeof r.docket !== 'string' || !/^[A-Z0-9-]{1,32}$/.test(r.docket) ||
      r.version !== expected.get(id)!.command.expected_version+1 || r.status !== (request.action === 'check_in' ? 'checked_in' : 'dispatched') ||
      r.custody !== (request.action === 'check_in' ? 'franchise_office' : 'route_dispatch') || r.attempts_started !== 0 || r.failed_attempt_count !== 0 ||
      typeof r.transitioned_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(r.transitioned_at) || !Number.isFinite(Date.parse(r.transitioned_at))) return protocol();
    const result: ParcelTransitionDto = { id,booking_id:r.booking_id,docket:r.docket,version:r.version as number,
      status:request.action==='check_in'?'checked_in':'dispatched',custody:request.action==='check_in'?'franchise_office':'route_dispatch',attempts_started:0,failed_attempt_count:0,event_id:r.event_id,transitioned_at:r.transitioned_at };
    return { parcel_id:id,outcome:'succeeded',result };
  });
  const succeeded = items.filter(item => item.outcome === 'succeeded').length;
  if (summary.succeeded !== succeeded || summary.failed !== items.length-succeeded) return protocol();
  return { action:request.action,items,summary:{ succeeded,failed:items.length-succeeded } };
}
export function createParcelBulkSource(client = createApiClient()) {
  return {
    intent(body: BulkParcelRequest, scope: ScopeTicket, key?: string) {
      if (browserConfig.dataMode !== 'production') throw new ApiFailure('ACTION_FORBIDDEN');
      const a = scope.authority;
      if (!a?.organizationId || !a.franchiseId) throw new ApiFailure('SCOPE_CHANGED',{kind:'scope'});
      if (!['check_in','dispatch'].includes(body.action) || body.items.length < 1 || body.items.length > MAX_BULK_PARCELS) throw new ApiFailure('VALIDATION_FAILED');
      return createCommandIntent({ operation:'api.v1.parcels.bulk',path:'/api/v1/parcels/bulk?'+new URLSearchParams({
        organization_id:a.organizationId,franchise_id:a.franchiseId }),body,scope,key });
    },
    async execute(intent: CommandIntent, current: () => ScopeTicket) {
      if (browserConfig.dataMode !== 'production') throw new ApiFailure('ACTION_FORBIDDEN');
      const value = await executeIntent<unknown>(intent,current,(path,options) => client.request(path,{...options,
        validationFields:['$','items','action','parcel_id','expected_version','idempotency_key','evidence_ref','location_ref','manifest_id'] }));
      return parcelBulkResult(value,JSON.parse(intent.bodyJson) as BulkParcelRequest);
    },
  };
}
export type ParcelBulkSource = ReturnType<typeof createParcelBulkSource>;
