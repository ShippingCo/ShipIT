import type { TenantAccess } from '../security/scope.ts';

export type OutboxAction = 'outbox.read' | 'outbox.redrive' | 'outbox.work';
export type Ordering = 'M' | 'P' | 'H' | 'R';
export type Failure = 'retryable_failure' | 'permanent_failure' | 'schema_mismatch' | 'ordering_gap' | 'version_conflict';
export interface Event {
  event_id: string; event_type: string; schema_version: number; organization_id: string; franchise_id: string;
  aggregate_type: string; aggregate_id: string; aggregate_version: number; occurred_at: string;
  actor: { type: string; id: string }; correlation_id: string; causation_id: string; command_id: string;
  payload: Record<string, unknown>;
}
export interface Job {
  id: string; organization_id: string; franchise_id: string; event_id: string; consumer_id: string;
  state: 'pending' | 'leased' | 'retry_wait' | 'completed' | 'quarantined'; version: number;
  attempts: number; cycle_attempts: number; available_at: Date; created_at: Date;
  lease_token: string | null; lease_until: Date | null; reason_code: string | null;
}
/** Trusted code only. Handlers perform database-owned effects through reviewed capabilities.
 * No HTTP/provider calls, raw executor, client-selected actions or installation authority. */
export interface Consumer {
  readonly id: string;
  readonly subscriptions: Readonly<Record<string, readonly number[]>>;
  readonly ordering: Ordering;
  readonly validate: (event: Event) => boolean;
  readonly reconcileGap?: (scope: TenantAccess, event: Event, highWater: number) => Promise<boolean>;
  readonly apply: (scope: TenantAccess, event: Event, historical: boolean) => Promise<void>;
}
export function jobDto(job: Job) {
  return { id: job.id, event_id: job.event_id, consumer_id: job.consumer_id, state: job.state,
    version: job.version, attempts: job.attempts, cycle_attempts: job.cycle_attempts,
    available_at: job.available_at.toISOString(), created_at: job.created_at.toISOString(), reason_code: job.reason_code };
}
