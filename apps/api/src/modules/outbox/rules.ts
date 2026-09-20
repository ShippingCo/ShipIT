import type { Consumer, Event, Job, Ordering } from './types.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reference = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const fields = ['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id',
  'aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function eventEnvelope(value: unknown, job: Job): Event | null {
  if (!object(value) || Object.keys(value).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(value,k))) return null;
  if (value.event_id !== job.event_id || value.organization_id !== job.organization_id || value.franchise_id !== job.franchise_id ||
    typeof value.event_type !== 'string' || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(value.event_type) ||
    !['booking','parcel','lot','route','payment_obligation'].includes(String(value.aggregate_type)) ||
    typeof value.aggregate_id !== 'string' || !uuid.test(value.aggregate_id) ||
    !Number.isSafeInteger(value.schema_version) || Number(value.schema_version) < 1 ||
    !Number.isInteger(value.aggregate_version) || Number(value.aggregate_version) < 1 || Number(value.aggregate_version) > 2147483647 ||
    typeof value.occurred_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value.occurred_at) || !Number.isFinite(Date.parse(value.occurred_at)) ||
    !object(value.actor) || Object.keys(value.actor).sort().join(',') !== 'id,type' ||
    !['user','service','integration'].includes(String(value.actor.type)) || typeof value.actor.id !== 'string' || !reference.test(value.actor.id) ||
    !['correlation_id','causation_id','command_id'].every(k => typeof value[k] === 'string' && reference.test(value[k])) || !object(value.payload)) return null;
  return value as unknown as Event;
}
export function registry(consumers: readonly Consumer[]): readonly Consumer[] {
  if (consumers.length > 32 || new Set(consumers.map(c => c.id)).size !== consumers.length) throw new Error('OUTBOX_REGISTRY_INVALID');
  return Object.freeze(consumers.map(c => {
    const entries = Object.entries(c.subscriptions);
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(c.id) || !['M','P','H','R'].includes(c.ordering) || entries.length < 1 || entries.length > 64 ||
      entries.some(([type,versions]) => !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(type) || !versions.length ||
        versions.some(v => !Number.isSafeInteger(v) || v < 1)) || typeof c.validate !== 'function' || typeof c.apply !== 'function') throw new Error('OUTBOX_REGISTRY_INVALID');
    return Object.freeze({ ...c, subscriptions: Object.freeze(Object.fromEntries(entries.map(([k,v]) => [k,Object.freeze([...v])]))) });
  }));
}
export function disposition(policy: Ordering, version: number, highWater: number) {
  if (version <= highWater) return policy === 'M' || policy === 'P' ? 'skipped_stale' : 'historical';
  return 'applied';
}
export function retryDelay(attempt: number, random = Math.random): number {
  const cap = Math.min(30000, 1000 * 2 ** Math.min(Math.max(attempt,1),5));
  return Math.floor(1000 + Math.min(1,Math.max(0,random())) * (cap - 1000));
}
