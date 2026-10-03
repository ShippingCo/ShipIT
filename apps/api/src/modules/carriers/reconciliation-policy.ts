import type { ObservationStatus } from './contract.ts';

export interface TrackingFacts {
  status: ObservationStatus | null;
  occurred_at: Date | string | null;
  time_reason: string | null;
  duplicate_of: string | null;
  conflict: string | null;
}
/** Carrier facts never authorize proof, money, dispatch, assignment or return. */
export function reviewReason(record: TrackingFacts, parcel: {status:string;updated_at:Date|string;created_at:Date|string}, now:Date, currentReference:boolean) {
  if (record.conflict) return record.conflict;
  if (record.duplicate_of) return 'duplicate';
  if (!currentReference) return 'reference_conflict';
  if (!record.occurred_at) return record.time_reason ?? 'missing';
  if (!record.status) return 'unsupported_status';
  const at = new Date(record.occurred_at).getTime();
  if (at > now.getTime()) return 'future_time';
  if (at < new Date(parcel.created_at).getTime() || at < new Date(parcel.updated_at).getTime()) return 'stale';
  if (record.status === 'delivered_claim') return 'proof_required';
  if (record.status === 'in_transit_claim' && parcel.status === 'dispatched') return 'ready';
  return 'state_conflict';
}
