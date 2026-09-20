import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { Event, Failure, Job } from './types.ts';

export async function relay(scope: TenantAccess, consumer: string, types: readonly string[]) {
  const c = assertTenantAccess(scope,['outbox.work']);
  return (await scopedQuery<{count:number}>(scope,['outbox.work'],
    `SELECT shipit.outbox_relay($1,$2,$3,$4) AS count WHERE {{franchise:$1:$2}}`,
    [c.organizationId,c.permittedFranchiseIds[0],consumer,types])).rows[0]!.count;
}
export async function claim(scope: TenantAccess, consumer: string, now: Date|null) {
  const c = assertTenantAccess(scope,['outbox.work']);
  return (await scopedQuery<Job>(scope,['outbox.work'],
    `SELECT j.* FROM shipit.outbox_claim($1,$2,$3,$4) j WHERE {{franchise:j.organization_id:j.franchise_id}}`,
    [c.organizationId,c.permittedFranchiseIds[0],consumer,now])).rows[0] ?? null;
}
export async function databaseNow(scope:TenantAccess) {
  return (await scopedQuery<{now:Date}>(scope,['outbox.work'],`SELECT clock_timestamp() AS now WHERE {{franchise:$1:$2}}`,
    [scope.context.organizationId,scope.context.permittedFranchiseIds[0]])).rows[0]!.now;
}
export async function lockJob(scope: TenantAccess, id: string) {
  return (await scopedQuery<Job>(scope,['outbox.work','outbox.redrive'],
    `SELECT j.* FROM shipit.outbox_jobs j WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.id=$1 FOR UPDATE`,[id])).rows[0] ?? null;
}
export async function source(scope: TenantAccess, event: string) {
  return (await scopedQuery<{envelope:unknown;aggregate_sequence:number;event_type:string;aggregate_id:string}>(scope,['outbox.work'],
    `SELECT e.envelope,e.aggregate_sequence::integer AS aggregate_sequence,e.event_type,e.aggregate_id FROM shipit.domain_events e
     WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.event_id=$1`,[event])).rows[0];
}
export async function hasReceipt(scope: TenantAccess, job: string) {
  return (await scopedQuery(scope,['outbox.work'],`SELECT r.job_id FROM shipit.outbox_receipts r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.job_id=$1`,[job])).rows.length > 0;
}
export async function stream(scope: TenantAccess, consumer: string, event: Event) {
  const c = assertTenantAccess(scope,['outbox.work']);
  await scopedQuery(scope,['outbox.work'],`INSERT INTO shipit.outbox_streams(organization_id,franchise_id,consumer_id,aggregate_type,aggregate_id)
    SELECT $1::uuid,$2::uuid,$3::text,$4::text,$5::uuid WHERE {{franchise:$1:$2}} ON CONFLICT DO NOTHING`,
    [c.organizationId,c.permittedFranchiseIds[0],consumer,event.aggregate_type,event.aggregate_id]);
  return (await scopedQuery<{high_water:number}>(scope,['outbox.work'],`SELECT high_water FROM shipit.outbox_streams s
    WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.consumer_id=$1 AND s.aggregate_type=$2 AND s.aggregate_id=$3 FOR UPDATE`,
    [consumer,event.aggregate_type,event.aggregate_id])).rows[0]!.high_water;
}
export async function versionConflict(scope: TenantAccess, consumer: string, event: Event) {
  return (await scopedQuery(scope,['outbox.work'],`SELECT r.job_id FROM shipit.outbox_receipts r
    JOIN shipit.outbox_jobs j ON j.organization_id=r.organization_id AND j.franchise_id=r.franchise_id AND j.id=r.job_id
    JOIN shipit.domain_events e ON e.organization_id=j.organization_id AND e.franchise_id=j.franchise_id AND e.event_id=j.event_id
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND j.consumer_id=$1 AND e.aggregate_id=$2
    AND e.envelope->>'aggregate_type'=$3 AND e.aggregate_sequence=$4 AND e.event_id<>$5 LIMIT 1`,
    [consumer,event.aggregate_id,event.aggregate_type,event.aggregate_version,event.event_id])).rows.length > 0;
}
export async function recordEffect(scope: TenantAccess, job: Job, event: Event, outcome: string, now: Date|null) {
  const c = assertTenantAccess(scope,['outbox.work']);
  const saved = (await scopedQuery<{saved:boolean}>(scope,['outbox.work'],
    `SELECT shipit.outbox_receipt($1,$2,$3,$4,$5,$6) AS saved WHERE {{franchise:$1:$2}}`,
    [c.organizationId,c.permittedFranchiseIds[0],job.id,job.lease_token,outcome,now])).rows[0]!.saved;
  if (!saved) throw new Error('OUTBOX_LEASE_LOST');
  await scopedQuery(scope,['outbox.work'],`UPDATE shipit.outbox_streams s SET high_water=greatest(high_water,$1)
    WHERE {{franchise:s.organization_id:s.franchise_id}} AND consumer_id=$2 AND aggregate_type=$3 AND aggregate_id=$4`,
    [event.aggregate_version,job.consumer_id,event.aggregate_type,event.aggregate_id]);
}
export async function finish(scope: TenantAccess, id: string, token: string, code: Failure | null, delay: number, now: Date|null) {
  const c = assertTenantAccess(scope,['outbox.work']);
  return (await scopedQuery<{saved:boolean}>(scope,['outbox.work'],
    `SELECT shipit.outbox_finish($1,$2,$3,$4,$5,$6,$7) AS saved WHERE {{franchise:$1:$2}}`,
    [c.organizationId,c.permittedFranchiseIds[0],id,token,code,delay,now])).rows[0]!.saved;
}
