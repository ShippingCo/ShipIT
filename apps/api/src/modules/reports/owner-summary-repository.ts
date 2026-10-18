import {ownerSummaryIdentity} from './owner-summary-rules.ts';
import {digest} from '../pricing/idempotency.ts';
import type {OwnerSummaryPeriod,OwnerSummaryTiming,OwnerSummarySchedule,OwnerSummaryScheduleInput,OwnerSummarySnapshot,OwnerSummaryRun,OwnerDeliveryState} from '@shippingco/shared';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {randomUUID} from 'node:crypto';

/** Most recent due complete calendar period; no moving 24-hour approximation in DST zones.
 * The optional instant is an internal fake-clock seam, never a request-body field.
 * Weekly reports cover Monday–Sunday and become due on the selected ISO weekday.
 * Monthly reports cover the preceding month and become due on day one.
 */
export async function ownerSummaryPeriod(scope:TenantAccess,timing:OwnerSummaryTiming,instant?:Date):Promise<OwnerSummaryPeriod> {
 const result=(await scopedQuery<{period:OwnerSummaryPeriod}>(scope,['reports.capture'],`
 SELECT jsonb_build_object('frequency',$1::text,'timezone',$2::text,
  'from',to_char((boundary-span) AT TIME ZONE $2 AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'to',to_char(boundary AT TIME ZONE $2 AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'label',to_char(boundary-span,'YYYY-MM-DD')||' / '||to_char(boundary-interval '1 day','YYYY-MM-DD')) period
 FROM shipit.franchises f CROSS JOIN LATERAL (
  SELECT CASE $1 WHEN 'daily' THEN date_trunc('day',local_time)
   WHEN 'weekly' THEN date_trunc('week',local_time-make_interval(days=>$4::int-1))
   ELSE date_trunc('month',local_time) END boundary,
   CASE $1 WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END span
  FROM (SELECT (COALESCE($5::timestamptz,statement_timestamp()) AT TIME ZONE $2)-make_interval(mins=>$3::int) local_time) clock
 ) boundaries
 WHERE {{franchise:f.organization_id:f.id}} AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$2) LIMIT 1`,
 [timing.frequency,timing.timezone,timing.minute,timing.weekday,instant??null])).rows[0];
 if(!result)throw new FieldValidationError('$','INVALID_FORMAT');
 return result.period;
}

export async function lockOwner(scope:TenantAccess) {
 await scopedQuery(scope,['reports.capture'],`SELECT o.id FROM shipit.organizations o WHERE {{organization:o.id}} FOR UPDATE`);
}
export async function permitted(scope:TenantAccess,user:string,ids:readonly string[]=scope.context.permittedFranchiseIds,admin=false) {
 const result=(await scopedQuery<{allowed:boolean}>(scope,['reports.capture'],`SELECT NOT EXISTS(SELECT 1 FROM unnest($2::uuid[]) f(id)
  WHERE NOT EXISTS(SELECT 1 FROM shipit.franchises sf JOIN shipit.organizations o ON o.id=sf.organization_id
   WHERE {{franchise:sf.organization_id:sf.id}} AND sf.id=f.id AND sf.lifecycle='active' AND o.lifecycle='active')
  OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE {{organization:m.organization_id}} AND m.user_id=$1 AND m.lifecycle='active' AND
    ((NOT $3::boolean AND m.role='org_admin') OR m.role=ANY(CASE WHEN $3 THEN ARRAY['franchise_admin'] ELSE ARRAY['franchise_admin','accountant'] END)
     AND EXISTS(SELECT 1 FROM shipit.membership_franchise_scopes s WHERE s.organization_id=m.organization_id AND s.membership_id=m.id AND s.franchise_id=f.id)))) allowed`,[user,ids,admin])).rows[0]!;
 return ids.length>0&&result.allowed;
}
export async function requireAdmin(scope:TenantAccess) {
 if(!await permitted(scope,scope.context.actor.id,scope.context.permittedFranchiseIds,true))throw new HttpError('ACTION_FORBIDDEN');
}
export async function candidates(scope:TenantAccess) {
 const rows=(await scopedQuery<{id:string}>(scope,['reports.capture'],`SELECT DISTINCT m.user_id id FROM shipit.memberships m WHERE {{organization:m.organization_id}}
  AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin','accountant') ORDER BY id LIMIT 101`)).rows;
 const result=[];for(const row of rows)if(await permitted(scope,row.id))result.push(row);return result.slice(0,100);
}
export async function schedules(scope:TenantAccess,id:string|null=null):Promise<OwnerSummarySchedule[]> {
 return (await scopedQuery<OwnerSummarySchedule>(scope,['reports.capture'],`SELECT s.id,s.actor_id,s.organization_id,s.franchise_id,s.name,s.version,s.version expected_version,s.timing,s.enabled,s.whatsapp,s.corrections,s.alerts,s.last_state,s.last_reason,s.last_check,
  to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') updated_at,
  ARRAY(SELECT selected_id FROM shipit.owner_report_franchises f WHERE f.organization_id=s.organization_id AND f.franchise_id=s.franchise_id AND f.schedule_id=s.id ORDER BY selected_id) franchise_ids,
  ARRAY(SELECT user_id FROM shipit.owner_report_recipients r WHERE r.organization_id=s.organization_id AND r.franchise_id=s.franchise_id AND r.schedule_id=s.id ORDER BY user_id) recipient_ids
 FROM shipit.owner_report_schedules s WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.franchise_id=$1 AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.updated_at DESC,s.id LIMIT 21`,[scope.context.permittedFranchiseIds[0],id])).rows;
}
export async function schedule(scope:TenantAccess,id:string) {const s=(await schedules(scope,id))[0];if(!s)throw new HttpError('RESOURCE_NOT_FOUND');return s;}
export async function replay<T>(scope:TenantAccess,operation:string,key:string,fingerprint:string):Promise<T|null> {
 const row=(await scopedQuery<{fingerprint:string;result:T}>(scope,['reports.capture'],`SELECT fingerprint,result FROM shipit.owner_report_commands WHERE {{franchise:organization_id:franchise_id}} AND franchise_id=$1 AND actor_id=$2 AND operation=$3 AND key_digest=$4`,[scope.context.permittedFranchiseIds[0],scope.context.actor.id,operation,key])).rows[0];
 if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row?.result??null;
}
export async function command(scope:TenantAccess,operation:string,key:string,fingerprint:string,result:unknown) {
 const c=assertTenantAccess(scope,['reports.capture']);await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_commands(id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,result,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.id,operation,key,fingerprint,result,c.correlationId,c.organizationId]);
}
export async function saveSchedule(scope:TenantAccess,id:string,input:OwnerSummaryScheduleInput) {
 const c=assertTenantAccess(scope,['reports.capture']);
 const zone=(await scopedQuery(scope,['reports.capture'],`SELECT f.id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1) LIMIT 1`,[input.timing.timezone])).rows;
 if(!zone.length)throw new FieldValidationError('$','INVALID_FORMAT');
 if(input.expected_version===0){
  if((await schedules(scope)).length>=20)throw new HttpError('REPORT_QUOTA_EXCEEDED');
  await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_schedules(id,organization_id,franchise_id,actor_id,name,version,timing,enabled,whatsapp,corrections,alerts)
   SELECT $1,{{organization}},$2,$3,$4,1,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[id,c.permittedFranchiseIds[0],c.actor.id,input.name,input.timing,input.enabled,input.whatsapp,input.corrections,input.alerts,c.organizationId]);
 }else{
  const changed=await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_schedules SET name=$2,timing=$3,enabled=$4,whatsapp=$5,corrections=$6,alerts=$7,version=version+1,last_period_to=CASE WHEN timing IS DISTINCT FROM $3 THEN NULL ELSE last_period_to END,actor_id=$8,updated_at=clock_timestamp(),next_check=clock_timestamp()
   WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$9`,[id,input.name,input.timing,input.enabled,input.whatsapp,input.corrections,input.alerts,c.actor.id,input.expected_version]);
  if(!changed.rowCount)throw new HttpError('IDEMPOTENCY_CONFLICT');
 }
 await scopedQuery(scope,['reports.capture'],`DELETE FROM shipit.owner_report_franchises WHERE {{franchise:organization_id:franchise_id}} AND schedule_id=$1`,[id]);
 await scopedQuery(scope,['reports.capture'],`DELETE FROM shipit.owner_report_recipients WHERE {{franchise:organization_id:franchise_id}} AND schedule_id=$1`,[id]);
 for(const selected of input.franchise_ids)await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_franchises(organization_id,franchise_id,schedule_id,selected_id)
  SELECT {{organization}},$1,$2,$3 WHERE {{franchise:$4:$1}}`,[c.permittedFranchiseIds[0],id,selected,c.organizationId]);
 for(const user of input.recipient_ids)await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_recipients(organization_id,franchise_id,schedule_id,user_id)
  SELECT {{organization}},$1,$2,$3 WHERE {{franchise:$4:$1}}`,[c.permittedFranchiseIds[0],id,user,c.organizationId]);
 return schedule(scope,id);
}
export async function ownConsent(scope:TenantAccess,user=scope.context.actor.id) {
 const row=(await scopedQuery<{enabled:boolean;version:number;identifier_id:string|null;has_verified_number:boolean}>(scope,['reports.capture'],`SELECT COALESCE(c.enabled,false) enabled,COALESCE(c.version,0) version,c.identifier_id,
 EXISTS(SELECT 1 FROM shipit.auth_identifiers i WHERE i.user_id=m.user_id AND i.channel='whatsapp') has_verified_number
 FROM shipit.memberships m LEFT JOIN shipit.owner_report_consents c ON c.organization_id=m.organization_id AND c.franchise_id=$2 AND c.user_id=m.user_id
 WHERE {{organization:m.organization_id}} AND m.user_id=$1 AND m.lifecycle='active' LIMIT 1`,[user,scope.context.permittedFranchiseIds[0]])).rows[0];
 return row??{enabled:false,version:0,identifier_id:null,has_verified_number:false};
}
export async function consent(scope:TenantAccess,enabled:boolean,version:number) {
 const c=scope.context,old=await ownConsent(scope);if(old.version!==version)throw new HttpError('IDEMPOTENCY_CONFLICT');
 const identifier=(await scopedQuery<{id:string}>(scope,['reports.capture'],`SELECT i.id FROM shipit.auth_identifiers i WHERE i.user_id=$1 AND i.channel='whatsapp'
  AND EXISTS(SELECT 1 FROM shipit.memberships m WHERE {{organization:m.organization_id}} AND m.user_id=i.user_id AND m.lifecycle='active') ORDER BY i.verified_at DESC,i.id LIMIT 1`,[c.actor.id])).rows[0];
 if(enabled&&!identifier)throw new FieldValidationError('$','INVALID_FORMAT');
 await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_consents(organization_id,franchise_id,user_id,enabled,identifier_id,version)
  SELECT {{organization}},$1,$2,$3,$4,1 WHERE {{franchise:$5:$1}} ON CONFLICT(organization_id,franchise_id,user_id) DO UPDATE SET enabled=EXCLUDED.enabled,identifier_id=EXCLUDED.identifier_id,version=shipit.owner_report_consents.version+1,updated_at=clock_timestamp()`,[c.permittedFranchiseIds[0],c.actor.id,enabled,identifier?.id??null,c.organizationId]);
 const current=await ownConsent(scope);return {enabled:current.enabled,has_verified_number:current.has_verified_number,version:current.version};
}
export async function audit(scope:TenantAccess,id:string,action:'read'|'export'|'generate'|'suppressed'|'failed') {
 const c=scope.context;await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_access_events(id,organization_id,franchise_id,actor_id,resource_id,action,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.type==='user'?c.actor.id:null,id,action,c.correlationId,c.organizationId]);
}
export async function run(scope:TenantAccess,id:string) {
 const row=(await scopedQuery<OwnerSummaryRun&{payload:OwnerSummarySnapshot|null;payload_digest:string|null;kind:'summary'|'alert'|'preview';franchise_ids:string[];expired:boolean}>(scope,['reports.capture'],`SELECT r.id,r.schedule_id,r.schedule_name,r.version,r.period,r.state,r.reason,r.corrected_from,r.payload,r.payload_digest,r.kind,r.franchise_ids,
  to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') created_at,to_char(r.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') expires_at,r.expires_at<=clock_timestamp() expired,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'recipient_id',d.recipient_id,'channel',d.channel,'state',d.state,'reason',d.reason,'attempts',d.attempts,'updated_at',to_char(d.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY d.id) FROM shipit.owner_report_deliveries d WHERE d.organization_id=r.organization_id AND d.franchise_id=r.franchise_id AND d.run_id=r.id),'[]'::jsonb) deliveries
 FROM shipit.owner_report_runs r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function history(scope:TenantAccess) {
 return (await scopedQuery<{id:string}>(scope,['reports.capture'],`SELECT id FROM shipit.owner_report_runs WHERE {{franchise:organization_id:franchise_id}} AND franchise_id=$1 AND created_at>clock_timestamp()-interval '90 days' ORDER BY created_at DESC,id LIMIT 100`,[scope.context.permittedFranchiseIds[0]])).rows;
}
export async function insertRun(scope:TenantAccess,s:OwnerSummarySchedule,period:OwnerSummaryPeriod,payload:OwnerSummarySnapshot|null,version=1,previous:string|null=null,reason:string|null=null,kind:'summary'|'alert'|'preview'='summary') {
 const c=scope.context,id=randomUUID(),now=payload?.as_of??new Date().toISOString();
 const r=await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_runs(id,organization_id,franchise_id,schedule_id,schedule_version,schedule_name,version,period,period_from,period_to,created_at,expires_at,state,reason,corrected_from,payload,franchise_ids,kind,payload_digest)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$18,$19 WHERE {{franchise:$17:$2}}
 ON CONFLICT(organization_id,franchise_id,schedule_id,kind,period_from,period_to,version) DO NOTHING RETURNING id`,[id,c.permittedFranchiseIds[0],s.id,s.version,s.name,version,period,period.from,period.to,now,new Date(Date.parse(now)+86400000).toISOString(),payload?'ready':'failed',reason,previous,payload,s.franchise_ids,c.organizationId,kind,payload?digest({...payload,as_of:null,expires_at:null}):null]);
 return r.rowCount?id:null;
}
export async function priorRun(scope:TenantAccess,scheduleId:string,period:OwnerSummaryPeriod,kind:'summary'|'alert'|'preview'='summary') {
 return (await scopedQuery<{id:string;version:number}>(scope,['reports.capture'],`SELECT id,version FROM shipit.owner_report_runs WHERE {{franchise:organization_id:franchise_id}} AND kind=$4 AND schedule_id=$1 AND period_from=$2 AND period_to=$3 ORDER BY version DESC LIMIT 1`,[scheduleId,period.from,period.to,kind])).rows[0];
}
export async function enqueue(scope:TenantAccess,runId:string,recipient:string,channel:'in_app'|'whatsapp',identity:{schedule:string;period:OwnerSummaryPeriod;version:number},state:OwnerDeliveryState='pending',reason='queued') {
 const c=scope.context,logicalKey=digest({owner:[c.organizationId,c.permittedFranchiseIds[0]],channel,intent:ownerSummaryIdentity(identity.schedule,identity.period,recipient,identity.version)});await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.owner_report_deliveries(id,organization_id,franchise_id,run_id,recipient_id,channel,state,reason,notification_key)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$9 WHERE {{franchise:$8:$2}} ON CONFLICT(organization_id,franchise_id,notification_key) DO NOTHING`,[randomUUID(),c.permittedFranchiseIds[0],runId,recipient,channel,state,reason,c.organizationId,logicalKey]);
}
export async function delaySchedule(scope:TenantAccess,id:string) {
 await scopedQuery(scope,['reports.capture'],`UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp()+interval '5 minutes',last_check=clock_timestamp() WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id]);
 await scopedQuery(scope,['reports.capture'],`SELECT shipit.owner_report_purge({{organization}},$1) WHERE {{franchise:$2:$1}}`,[scope.context.permittedFranchiseIds[0],scope.context.organizationId]);
}
