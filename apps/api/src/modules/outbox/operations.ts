import { HttpError } from '../../plugins/errors.ts';
import { scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { Job } from './types.ts';

export async function active(scope:TenantAccess) {
  const row=(await scopedQuery<{lifecycle:string}>(scope,['outbox.redrive'],`SELECT f.lifecycle FROM shipit.franchises f
    WHERE {{franchise:f.organization_id:f.id}} FOR UPDATE`,[])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
export async function health(scope:TenantAccess) {
  return (await scopedQuery<{state:string;count:number;oldest_age_seconds:number}>(scope,['outbox.read','outbox.work'],
    `SELECT j.state,count(*)::integer AS count,greatest(0,extract(epoch FROM clock_timestamp()-min(j.created_at)))::float8 AS oldest_age_seconds
     FROM shipit.outbox_jobs j WHERE {{franchise:j.organization_id:j.franchise_id}} GROUP BY j.state ORDER BY j.state`)).rows;
}
export async function list(scope:TenantAccess,after:string|null,limit:number) {
  return (await scopedQuery<Job>(scope,['outbox.read'],`SELECT j.* FROM shipit.outbox_jobs j
    WHERE {{franchise:j.organization_id:j.franchise_id}} AND ($1::uuid IS NULL OR j.id>$1) ORDER BY j.id LIMIT $2`,[after,limit+1])).rows;
}
export async function detail(scope:TenantAccess,id:string) {
  const job=(await scopedQuery<Job>(scope,['outbox.read'],`SELECT j.* FROM shipit.outbox_jobs j
    WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.id=$1`,[id])).rows[0];
  if(!job)throw new HttpError('RESOURCE_NOT_FOUND');
  const attempts=(await scopedQuery<{attempt:number;kind:string;reason_code:string|null;occurred_at:Date}>(scope,['outbox.read'],
    `SELECT a.attempt,a.kind,a.reason_code,a.occurred_at FROM shipit.outbox_attempts a
     WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.job_id=$1 ORDER BY a.attempt DESC,a.occurred_at DESC,a.id DESC LIMIT 101`,[id])).rows;
  return {job,attempts:attempts.slice(0,100),history_truncated:attempts.length>100};
}
export async function replay(scope:TenantAccess,key:string,fingerprint:string) {
  const row=(await scopedQuery<{job_id:string;version:number;fingerprint:string}>(scope,['outbox.redrive'],
    `SELECT r.job_id,r.version,r.fingerprint FROM shipit.outbox_redrives r
     WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.actor_id=$1 AND r.key_hash=$2`,[scope.context.actor.id,key])).rows[0];
  if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
  return row?{id:row.job_id,version:row.version,state:'pending' as const}:null;
}
export async function redrive(scope:TenantAccess,id:string,key:string,fingerprint:string,version:number,reason:string) {
  const c=scope.context;
  const result=(await scopedQuery<{version:number|null}>(scope,['outbox.redrive'],
    `SELECT shipit.outbox_redrive($1,$2,$3,$4,$5,$6,$7,$8,$9) AS version WHERE {{franchise:$1:$2}}`,
    [c.organizationId,c.permittedFranchiseIds[0],id,c.actor.id,c.correlationId,key,fingerprint,version,reason])).rows[0]!.version;
  if(result===null)throw new HttpError('VERSION_CONFLICT');
  return {id,version:result,state:'pending' as const};
}
