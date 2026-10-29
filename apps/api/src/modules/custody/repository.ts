import {randomUUID} from 'node:crypto';
import type {ParcelCustodyCommandDto,ParcelHandoverDto} from '@shippingco/shared';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {custodyActions} from './types.ts';
import {HttpError} from '../../plugins/errors.ts';
const actions=[...custodyActions];
export interface ParcelRow {id:string;booking_id:string;version:number;status:string;active_attempt_id:string|null;assigned_agent_id:string|null;attempt_id:string|null;assignment_id:string|null;attempt_agent_id:string|null;attempt_state:string|null}
export interface ReceiptRow {id:string;parcel_id:string;booking_id:string;attempt_id:string;sequence:number;kind:'agent_received'|'office_received'|'recipient_received';agent_id:string|null;recorded_at:Date;proof_id:string|null}
export interface ItemRow {id:string;parcel_id:string;booking_id:string;attempt_id:string;assignment_id:string;agent_id:string;expected_parcel_version:number;previous_receipt_id:string|null;instruction_id:string|null;grant_id:string|null;receipt_id:string|null}
export interface ManifestRow {id:string;agent_id:string;recorded_at:Date;actor_id:string;item_count:number;cancelled:boolean}
export interface GrantRow {id:string;parcel_id:string;source_receipt_id:string;agent_id:string;destination_kind:'agent'|'office';destination_agent_id:string|null;revoked:boolean}
export async function parcel(scope:TenantAccess,id:string):Promise<ParcelRow>{
 const row=(await scopedQuery<ParcelRow>(scope,[...actions],`SELECT p.id,p.booking_id,p.version,p.status,p.active_attempt_id,p.assigned_agent_id,
 a.id attempt_id,a.assignment_id,a.agent_id attempt_agent_id,a.state attempt_state
 FROM shipit.parcels p LEFT JOIN LATERAL(SELECT id,assignment_id,agent_id,state FROM shipit.delivery_attempts a
  WHERE a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.parcel_id=p.id ORDER BY attempt_number DESC LIMIT 1) a ON true
 WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function latest(scope:TenantAccess,id:string){
 return (await scopedQuery<ReceiptRow>(scope,[...actions],`SELECT * FROM shipit.custody_receipts
 WHERE {{franchise:organization_id:franchise_id}} AND parcel_id=$1 ORDER BY sequence DESC LIMIT 1`,[id])).rows[0]??null;
}
export async function eligibleAgent(scope:TenantAccess,id:string){
 const row=(await scopedQuery(scope,[...actions],`SELECT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id
 JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
 WHERE {{franchise:f.organization_id:f.franchise_id}} AND u.id=$1 AND u.lifecycle='active' AND m.lifecycle='active' AND m.role='delivery_agent'`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function manifest(scope:TenantAccess,id:string,agentOnly:boolean){
 const c=assertTenantAccess(scope,actions),row=(await scopedQuery<ManifestRow>(scope,[...actions],`SELECT m.*,c.actor_id,
 EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations x WHERE x.organization_id=m.organization_id AND x.franchise_id=m.franchise_id AND x.manifest_id=m.id) cancelled
 FROM shipit.custody_manifests m JOIN shipit.custody_commands c ON c.organization_id=m.organization_id AND c.franchise_id=m.franchise_id AND c.id=m.command_id
 WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1 AND (NOT $2::boolean OR m.agent_id=$3)`,[id,agentOnly,c.actor.id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
 const items=(await scopedQuery<ItemRow>(scope,[...actions],`SELECT i.*,r.id receipt_id FROM shipit.custody_manifest_items i
 LEFT JOIN shipit.custody_receipts r ON r.organization_id=i.organization_id AND r.franchise_id=i.franchise_id AND r.manifest_item_id=i.id
 WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.manifest_id=$1 ORDER BY i.parcel_id`,[id])).rows;
 if(items.length!==row.item_count)throw new HttpError('CUSTODY_CONFLICT');return {row,items};
}
export function manifestDto(m:Awaited<ReturnType<typeof manifest>>):ParcelHandoverDto{
 const accepted=m.items.every(i=>i.receipt_id!==null);
 return {id:m.row.id,agent_id:m.row.agent_id,recorded_at:m.row.recorded_at.toISOString(),state:m.row.cancelled?'cancelled':accepted?'acknowledged':'prepared',version:m.row.cancelled||accepted?2:1,
  items:m.items.map(i=>({id:i.id,parcel_id:i.parcel_id,expected_parcel_version:i.expected_parcel_version,previous_receipt_id:i.previous_receipt_id,receipt_id:i.receipt_id}))};
}
export async function grant(scope:TenantAccess,id:string):Promise<GrantRow>{
 const row=(await scopedQuery<GrantRow>(scope,[...actions],`SELECT g.*,EXISTS(SELECT 1 FROM shipit.custody_grant_revocations r
 WHERE r.organization_id=g.organization_id AND r.franchise_id=g.franchise_id AND r.grant_id=g.id) revoked
 FROM shipit.custody_transfer_grants g WHERE {{franchise:g.organization_id:g.franchise_id}} AND g.id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function replay(scope:TenantAccess,operation:string,key:string,fingerprint:string){
 const c=assertTenantAccess(scope,actions),row=(await scopedQuery<{fingerprint:string;result:ParcelCustodyCommandDto}>(scope,[...actions],`SELECT fingerprint,result FROM shipit.custody_commands
 WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
 if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row?.result??null;
}
export async function command(scope:TenantAccess,id:string,operation:string,key:string,fingerprint:string,input:unknown,resource:string,receiptIds:string[]){
 const c=assertTenantAccess(scope,actions),time=(await scopedQuery<{time:Date}>(scope,[...actions],`SELECT transaction_timestamp() time WHERE {{franchise:$1:$2}}`,[c.organizationId,c.permittedFranchiseIds[0]])).rows[0]!.time;
 const result:ParcelCustodyCommandDto={command_id:id,resource_id:resource,receipt_ids:receiptIds,recorded_at:time.toISOString()};
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_commands(id,organization_id,franchise_id,actor_id,operation,correlation_id,key_digest,fingerprint,input,result)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb WHERE {{franchise:$10:$2}}`,[id,c.permittedFranchiseIds[0],c.actor.id,operation,c.correlationId,key,fingerprint,JSON.stringify(input),JSON.stringify(result),c.organizationId]);
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_events(id,organization_id,franchise_id,command_id,resource_id,receipt_ids)
 SELECT $1,{{organization}},$2,$3,$4,$5::uuid[] WHERE {{franchise:$6:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],id,resource,receiptIds,c.organizationId]);
 return result;
}
export async function receive(scope:TenantAccess,p:ParcelRow,source:ReceiptRow|null,item:ItemRow|null,command:string,kind:'agent_received'|'office_received',discrepancy:string){
 const c=assertTenantAccess(scope,actions),id=randomUUID(),attempt=item?.attempt_id??source?.attempt_id;
 if(!attempt)throw new HttpError('CUSTODY_CONFLICT');
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_receipts(id,organization_id,franchise_id,booking_id,parcel_id,attempt_id,sequence,previous_receipt_id,manifest_item_id,kind,agent_id,actor_id,discrepancy,command_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 WHERE {{franchise:$14:$2}}`,
 [id,c.permittedFranchiseIds[0],p.booking_id,p.id,attempt,(source?.sequence??0)+1,source?.id??null,item?.id??null,kind,item?.agent_id??null,c.actor.id,discrepancy,command,c.organizationId]);
 return id;
}

export async function eligibleStaff(scope:TenantAccess,id:string,role:'franchise_admin'|'delivery_agent'|'dispatcher'){
 return (await scopedQuery(scope,[...actions],`SELECT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id
 JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
 WHERE {{franchise:f.organization_id:f.franchise_id}} AND u.id=$1 AND u.lifecycle='active' AND m.lifecycle='active' AND (m.role=$2 OR m.role IN ('org_admin','franchise_admin') AND $2 IN ('franchise_admin','dispatcher'))`,[id,role])).rows.length>0;
}
export async function release(scope:TenantAccess,source:string,manifestId:string){
 return (await scopedQuery<{id:string;grant_id:string}>(scope,[...actions],`SELECT id,grant_id FROM shipit.custody_releases
 WHERE {{franchise:organization_id:franchise_id}} AND source_receipt_id=$1 AND manifest_id=$2`,[source,manifestId])).rows[0]??null;
}
export async function instruction(scope:TenantAccess,id:string){
 const row=(await scopedQuery<{id:string;parcel_id:string;attempt_id:string;assignment_id:string;from_agent_id:string;to_agent_id:string;expected_parcel_version:number;actor_id:string}>(scope,[...actions],`SELECT i.*,c.actor_id
 FROM shipit.custody_assignment_instructions i JOIN shipit.custody_commands c ON c.organization_id=i.organization_id AND c.franchise_id=i.franchise_id AND c.id=i.command_id
 WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}

/** Complete maximum-50-item cohort; latest receipt lookup does not page or truncate its history. */
export async function manifestReport(scope:TenantAccess,m:Awaited<ReturnType<typeof manifest>>,asOf:Date):Promise<import('@shippingco/shared').ParcelCustodyReportDto>{
 if(!Number.isFinite(asOf.getTime())||asOf<m.row.recorded_at)throw new HttpError('RESOURCE_NOT_FOUND');
 type Row={item_id:string;parcel_id:string;origin_receipt_id:string|null;current_receipt_id:string|null;kind:string|null;agent_id:string|null;proof_id:string|null;failure_ids:string[]};
 const rows=(await scopedQuery<Row>(scope,['custody.read','custody.export'],`SELECT i.id item_id,i.parcel_id,origin.id origin_receipt_id,
  current.id current_receipt_id,current.kind,current.agent_id,current.proof_id,COALESCE(failure.ids,'{}'::uuid[]) failure_ids
 FROM shipit.custody_manifest_items i
 LEFT JOIN shipit.custody_receipts origin ON origin.organization_id=i.organization_id AND origin.franchise_id=i.franchise_id
  AND origin.manifest_item_id=i.id AND origin.recorded_at<=$2
 LEFT JOIN LATERAL(
  SELECT r.id,r.kind,r.agent_id,r.proof_id,r.sequence FROM shipit.custody_receipts r
  LEFT JOIN shipit.delivery_proofs p ON p.organization_id=r.organization_id AND p.franchise_id=r.franchise_id AND p.parcel_id=r.parcel_id AND p.attempt_id=r.attempt_id AND p.id=r.proof_id
  WHERE r.organization_id=i.organization_id AND r.franchise_id=i.franchise_id AND r.parcel_id=i.parcel_id AND r.sequence>=origin.sequence AND r.recorded_at<=$2
   AND (r.kind<>'recipient_received' OR p.completed_at<=$2)
  ORDER BY r.sequence DESC LIMIT 1
 ) current ON true
 LEFT JOIN LATERAL(
  SELECT r.recorded_at FROM shipit.custody_receipts r
  LEFT JOIN shipit.delivery_proofs p ON p.organization_id=r.organization_id AND p.franchise_id=r.franchise_id AND p.parcel_id=r.parcel_id AND p.attempt_id=r.attempt_id AND p.id=r.proof_id
  WHERE r.organization_id=i.organization_id AND r.franchise_id=i.franchise_id AND r.parcel_id=i.parcel_id AND r.sequence>origin.sequence AND r.recorded_at<=$2
   AND (r.kind<>'agent_received' OR r.agent_id<>i.agent_id) AND (r.kind<>'recipient_received' OR p.completed_at<=$2)
  ORDER BY r.sequence LIMIT 1
 ) departure ON true
 LEFT JOIN LATERAL(
  SELECT array_agg(f.id ORDER BY f.id) ids FROM shipit.parcel_failed_attempts f JOIN shipit.delivery_attempts a
   ON a.organization_id=f.organization_id AND a.franchise_id=f.franchise_id AND a.parcel_id=f.parcel_id AND a.id=f.attempt_id
  WHERE f.organization_id=i.organization_id AND f.franchise_id=i.franchise_id AND f.parcel_id=i.parcel_id AND a.agent_id=i.agent_id
   AND f.occurred_at>=origin.recorded_at AND f.occurred_at<=$2 AND (departure.recorded_at IS NULL OR f.occurred_at<=departure.recorded_at)
 ) failure ON true
 WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.manifest_id=$1 ORDER BY i.parcel_id`,[m.row.id,asOf])).rows;
 if(rows.length!==m.row.item_count||rows.some(r=>r.origin_receipt_id!==null&&r.current_receipt_id===null))throw new HttpError('CUSTODY_CONFLICT');
 const totals={total:rows.length,delivered:0,returned:0,held:0,reassigned:0,pending:0,failed:0},sources=new Set<string>();
 const items=rows.map(r=>{
  const outcome:import('@shippingco/shared').ParcelCustodyOutcome=r.current_receipt_id===null?'pending':r.kind==='recipient_received'?'delivered':
   r.kind==='office_received'?'returned':r.agent_id===m.row.agent_id?'held':'reassigned';
  totals[outcome]++;if(r.failure_ids.length)totals.failed++;for(const id of r.failure_ids)sources.add(id);
  return {item_id:r.item_id,parcel_id:r.parcel_id,outcome,origin_receipt_id:r.origin_receipt_id,current_receipt_id:r.current_receipt_id,proof_id:r.proof_id,failure_ids:r.failure_ids};
 });
 return {manifest_id:m.row.id,agent_id:m.row.agent_id,as_of:asOf.toISOString(),totals,items,failure_count:sources.size};
}
export async function cutoff(scope:TenantAccess){
 return (await scopedQuery<{instant:Date}>(scope,['custody.read','custody.export'],`SELECT date_trunc('milliseconds',clock_timestamp()) instant
 FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}`)).rows[0]!.instant;
}

export async function worklist(scope:TenantAccess,agentOnly:boolean,cursor:string|null,asOf:Date):Promise<import('@shippingco/shared').ParcelCustodyWorklistDto>{
 const c=assertTenantAccess(scope,['custody.read']);
 type Row={parcel_id:string;docket:string;parcel_version:number;status:string;assigned_agent_id:string|null;attempt_id:string|null;receipt_id:string|null;kind:string|null;proof_id:string|null};
 const rows=(await scopedQuery<Row>(scope,['custody.read'],`SELECT p.id parcel_id,p.docket,p.version parcel_version,p.status,p.assigned_agent_id,p.active_attempt_id attempt_id,
 r.id receipt_id,r.kind,r.proof_id FROM shipit.parcels p
 LEFT JOIN LATERAL(
  SELECT r.id,r.kind,r.agent_id,r.proof_id FROM shipit.custody_receipts r
  LEFT JOIN shipit.delivery_proofs proof ON proof.organization_id=r.organization_id AND proof.franchise_id=r.franchise_id AND proof.parcel_id=r.parcel_id AND proof.attempt_id=r.attempt_id AND proof.id=r.proof_id
  WHERE r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id AND r.parcel_id=p.id AND r.recorded_at<=$4
   AND (r.kind<>'recipient_received' OR proof.completed_at<=$4) ORDER BY r.sequence DESC LIMIT 1
 ) r ON true
 WHERE {{franchise:p.organization_id:p.franchise_id}} AND ($1::uuid IS NULL OR p.id>$1)
  AND (NOT $2::boolean OR p.assigned_agent_id=$3 OR (r.kind='agent_received' AND r.agent_id=$3))
 ORDER BY p.id LIMIT 51`,[cursor,agentOnly,c.actor.id,asOf])).rows;
 const page=rows.slice(0,50);
 return {as_of:asOf.toISOString(),next_cursor:rows.length>50?page.at(-1)!.parcel_id:null,
  items:page.map(({kind,...r})=>({...r,physical_custody:kind===null?'unknown':kind==='agent_received'?'agent':kind==='office_received'?'office':'recipient'}))};
}

export async function accessAudit(scope:TenantAccess,action:'custody.read'|'custody.worklist'|'custody.export.capture'|'custody.export.read'|'custody.export.download',manifest:string|null=null,snapshot:string|null=null){
 const c=assertTenantAccess(scope,['custody.audit']);
 await scopedQuery(scope,['custody.audit'],`INSERT INTO shipit.custody_access_events(id,organization_id,franchise_id,actor_id,action,manifest_id,snapshot_id,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,
 [randomUUID(),c.permittedFranchiseIds[0],c.actor.id,action,manifest,snapshot,c.correlationId,c.organizationId]);
}

export async function manifests(scope:TenantAccess,agentOnly:boolean,cursor:string|null){
 const c=assertTenantAccess(scope,['custody.read']);
 const rows=(await scopedQuery<{id:string;agent_id:string;recorded_at:Date;item_count:number;cancelled:boolean;received:number}>(scope,['custody.read'],`SELECT m.id,m.agent_id,m.recorded_at,m.item_count,
 EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations x WHERE x.organization_id=m.organization_id AND x.franchise_id=m.franchise_id AND x.manifest_id=m.id) cancelled,
 (SELECT count(*)::int FROM shipit.custody_receipts r JOIN shipit.custody_manifest_items i ON i.organization_id=r.organization_id AND i.franchise_id=r.franchise_id AND i.id=r.manifest_item_id
  WHERE i.organization_id=m.organization_id AND i.franchise_id=m.franchise_id AND i.manifest_id=m.id) received
 FROM shipit.custody_manifests m WHERE {{franchise:m.organization_id:m.franchise_id}} AND ($1::uuid IS NULL OR m.id>$1) AND (NOT $2::boolean OR m.agent_id=$3)
 ORDER BY m.id LIMIT 51`,[cursor,agentOnly,c.actor.id])).rows;
 const page=rows.slice(0,50);return {next_cursor:rows.length>50?page.at(-1)!.id:null,items:page.map(r=>({id:r.id,agent_id:r.agent_id,recorded_at:r.recorded_at.toISOString(),item_count:r.item_count,
  state:r.cancelled?'cancelled' as const:r.received===r.item_count?'acknowledged' as const:'prepared' as const}))};
}
export async function agents(scope:TenantAccess,agentOnly:boolean,cursor:string|null){
 const c=assertTenantAccess(scope,['custody.read']);
 const rows=(await scopedQuery<{id:string}>(scope,['custody.read'],`SELECT DISTINCT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id
 JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
 WHERE {{franchise:f.organization_id:f.franchise_id}} AND u.lifecycle='active' AND m.lifecycle='active' AND m.role='delivery_agent' AND (NOT $1::boolean OR u.id=$2) AND ($3::uuid IS NULL OR u.id>$3)
 ORDER BY u.id LIMIT 101`,[agentOnly,c.actor.id,cursor])).rows;
 const agents=rows.slice(0,100);return {agents,next_cursor:rows.length>100?agents.at(-1)!.id:null};
}

/** Current, specifically approved outgoing sources; a giving agent never receives another giver's grant. */
export async function transfers(scope:TenantAccess,agentOnly:boolean,cursor:string|null,id:string|null=null){
 const c=assertTenantAccess(scope,['custody.read']);
 const rows=(await scopedQuery<import('@shippingco/shared').ParcelCustodyTransferDto>(scope,['custody.read'],`
 SELECT g.id,g.parcel_id,g.source_receipt_id,g.agent_id,g.destination_kind,g.destination_agent_id,p.version parcel_version,p.assigned_agent_id,
 (g.destination_kind='agent' AND p.status='out_for_delivery' AND a.state='active' AND p.active_attempt_id=a.id AND
   (p.assigned_agent_id=g.destination_agent_id OR instruction.id IS NOT NULL)) can_prepare,
 instruction.id instruction_id,
 (SELECT r.id FROM shipit.custody_releases r WHERE r.organization_id=g.organization_id AND r.franchise_id=g.franchise_id
  AND r.grant_id=g.id AND r.source_receipt_id=g.source_receipt_id AND r.manifest_id IS NULL) office_release_id
 FROM shipit.custody_transfer_grants g JOIN shipit.parcels p ON p.organization_id=g.organization_id AND p.franchise_id=g.franchise_id AND p.id=g.parcel_id
 JOIN LATERAL(SELECT r.id,r.kind,r.agent_id FROM shipit.custody_receipts r WHERE r.organization_id=g.organization_id AND r.franchise_id=g.franchise_id AND r.parcel_id=g.parcel_id ORDER BY r.sequence DESC LIMIT 1) source ON source.id=g.source_receipt_id AND source.kind='agent_received' AND source.agent_id=g.agent_id
 LEFT JOIN shipit.delivery_attempts a ON a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.parcel_id=p.id AND a.id=p.active_attempt_id
 LEFT JOIN LATERAL(SELECT i.id FROM shipit.custody_assignment_instructions i JOIN shipit.custody_commands command ON command.organization_id=i.organization_id AND command.franchise_id=i.franchise_id AND command.id=i.command_id
  WHERE i.organization_id=p.organization_id AND i.franchise_id=p.franchise_id AND i.parcel_id=p.id AND i.attempt_id=a.id AND i.assignment_id=a.assignment_id
  AND i.from_agent_id=a.agent_id AND i.to_agent_id=g.destination_agent_id AND i.expected_parcel_version=p.version
  AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
   JOIN shipit.auth_users u ON u.id=m.user_id WHERE m.organization_id=p.organization_id AND f.franchise_id=p.franchise_id AND m.user_id=command.actor_id
   AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin','dispatcher') AND u.lifecycle='active') ORDER BY i.id LIMIT 1) instruction ON p.assigned_agent_id<>g.destination_agent_id
 WHERE {{franchise:g.organization_id:g.franchise_id}} AND (NOT $1::boolean OR g.agent_id=$2) AND ($3::uuid IS NULL OR g.id>$3) AND ($4::uuid IS NULL OR g.id=$4)
 AND NOT EXISTS(SELECT 1 FROM shipit.custody_grant_revocations r WHERE r.organization_id=g.organization_id AND r.franchise_id=g.franchise_id AND r.grant_id=g.id)
 AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
  JOIN shipit.auth_users u ON u.id=m.user_id WHERE m.organization_id=g.organization_id AND f.franchise_id=g.franchise_id AND m.user_id=g.agent_id
  AND m.role='delivery_agent' AND m.lifecycle='active' AND u.lifecycle='active')
 AND (g.destination_kind='office' OR EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
  JOIN shipit.auth_users u ON u.id=m.user_id WHERE m.organization_id=g.organization_id AND f.franchise_id=g.franchise_id AND m.user_id=g.destination_agent_id
  AND m.role='delivery_agent' AND m.lifecycle='active' AND u.lifecycle='active'))
 ORDER BY g.id LIMIT 51`,[agentOnly,c.actor.id,cursor,id])).rows;
 const items=rows.slice(0,50);return {items,next_cursor:rows.length>50?items.at(-1)!.id:null};
}
export async function outgoingManifests(scope:TenantAccess,grant:GrantRow,cursor:string|null){
 const rows=(await scopedQuery<{id:string;agent_id:string;released:boolean}>(scope,['custody.read'],`SELECT m.id,m.agent_id,
 EXISTS(SELECT 1 FROM shipit.custody_releases r WHERE r.organization_id=m.organization_id AND r.franchise_id=m.franchise_id AND r.manifest_id=m.id AND r.grant_id=$1 AND r.source_receipt_id=$2) released
 FROM shipit.custody_manifest_items i JOIN shipit.custody_manifests m ON m.organization_id=i.organization_id AND m.franchise_id=i.franchise_id AND m.id=i.manifest_id
 WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.grant_id=$1 AND i.previous_receipt_id=$2 AND i.parcel_id=$3 AND ($4::uuid IS NULL OR m.id>$4)
 AND NOT EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations x WHERE x.organization_id=m.organization_id AND x.franchise_id=m.franchise_id AND x.manifest_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM shipit.custody_receipts r WHERE r.organization_id=i.organization_id AND r.franchise_id=i.franchise_id AND r.manifest_item_id=i.id)
 ORDER BY m.id LIMIT 51`,[grant.id,grant.source_receipt_id,grant.parcel_id,cursor])).rows;
 const items=rows.slice(0,50);return {grant_id:grant.id,items,next_cursor:rows.length>50?items.at(-1)!.id:null};
}
