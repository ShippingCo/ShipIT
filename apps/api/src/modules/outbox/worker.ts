import type { DatabasePool } from '@shippingco/db';
import { withNextOutboxScope, withOutboxJobScope } from '../security/jobs.ts';
import { disposition, eventEnvelope, registry, retryDelay } from './rules.ts';
import type { Consumer, Failure, Job } from './types.ts';
import * as repository from './repository.ts';

export class PermanentJobFailure extends Error {
  constructor() { super('OUTBOX_PERMANENT_FAILURE'); }
}
export interface WorkerTelemetry {
  emit(event: 'outbox_quarantined' | 'outbox_cycle_failed', code: string): void;
}
export function createOutboxWorker(database: DatabasePool, input: readonly Consumer[], options: {
  clock?: () => Date; random?: () => number; telemetry?: WorkerTelemetry;
} = {}) {
  const consumers = registry(input), clock = () => options.clock?.() ?? null;
  const consumerById = new Map(consumers.map(c => [c.id,c]));
  function consumer(id: string) {
    const value = consumerById.get(id);
    if (!value) throw new Error('OUTBOX_CONSUMER_UNKNOWN');
    return value;
  }
  async function relay(id: string) {
    const c = consumer(id);
    return await withNextOutboxScope(database,id,Object.keys(c.subscriptions),'relay',clock(),s => repository.relay(s,id,Object.keys(c.subscriptions))) ?? 0;
  }
  async function claim(id: string) {
    const c = consumer(id);
    return await withNextOutboxScope(database,id,Object.keys(c.subscriptions),'claim',clock(),s => repository.claim(s,id,clock())) ?? null;
  }
  async function effect(identity: Pick<Job,'id'|'lease_token'>): Promise<Failure | 'lease_lost' | null> {
    if (!identity.lease_token) return 'lease_lost';
    let failure: Failure = 'retryable_failure';
    try {
      return await withOutboxJobScope(database,identity.id,async scope => {
        const job = await repository.lockJob(scope,identity.id);
        if (!job || job.state !== 'leased' || job.lease_token !== identity.lease_token || job.lease_until! <= (clock() ?? await repository.databaseNow(scope))) return 'lease_lost' as const;
        if (await repository.hasReceipt(scope,job.id)) return null;
        const c = consumer(job.consumer_id), source = await repository.source(scope,job.event_id);
        const event = eventEnvelope(source?.envelope,job);
        if (!event || source?.aggregate_sequence !== event.aggregate_version || source.aggregate_id !== event.aggregate_id || source.event_type !== event.event_type ||
          !c.subscriptions[event.event_type]?.includes(event.schema_version)) return 'schema_mismatch' as const;
        let valid = false;
        try { valid = c.validate(event); } catch { /* Schema rejection never exposes a payload. */ }
        if (!valid) return 'schema_mismatch' as const;
        const highWater = await repository.stream(scope,c.id,event);
        if (await repository.versionConflict(scope,c.id,event)) return 'version_conflict' as const;
        if (event.aggregate_version > highWater + 1 && (!c.reconcileGap || !await c.reconcileGap(scope,event,highWater))) return 'ordering_gap' as const;
        const outcome = disposition(c.ordering,event.aggregate_version,highWater);
        if (outcome !== 'skipped_stale') {
          try { await c.apply(scope,event,outcome === 'historical'); }
          catch(error) { if (error instanceof PermanentJobFailure) failure = 'permanent_failure'; throw error; }
        }
        await repository.recordEffect(scope,job,event,outcome,clock());
        return null;
      });
    } catch { return failure; } // A lost COMMIT is reconciled through the durable receipt at ack/reclaim.
  }
  async function acknowledge(job: Pick<Job,'id'|'lease_token'|'attempts'>, result: Failure | 'lease_lost' | null) {
    if (!job.lease_token || result === 'lease_lost') return false;
    const saved = await withOutboxJobScope(database,job.id,s => repository.finish(s,job.id,job.lease_token!,result,retryDelay(job.attempts,options.random),clock()));
    return saved ?? false;
  }
  async function tick(signal?: AbortSignal) {
    for (const c of consumers) {
      if (signal?.aborted) return;
      await relay(c.id);
      if (signal?.aborted) return;
      const job = await claim(c.id);
      if (job) await acknowledge(job,await effect(job));
      // Persisted quarantine remains alertable after a process crash or restart,
      // including when no runnable job remains. No external alert recipient here.
      const quarantined=await withNextOutboxScope(database,c.id,Object.keys(c.subscriptions),'alert',clock(),async()=>true);
      if(quarantined)options.telemetry?.emit('outbox_quarantined','MANUAL_REVIEW_REQUIRED');
    }
  }
  return { relay, claim, effect, acknowledge, tick };
}
