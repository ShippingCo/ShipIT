import { randomUUID } from 'node:crypto';
import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { Observation } from './contract.ts';
import type { TrackingFacts } from './reconciliation-policy.ts';

export interface TrackingRecord extends TrackingFacts {
  id:string; installation_id:string; parcel_id:string; reference_id:string; external_docket:string;
  status_code:string; source_id:string; source_mode:string; source_ref:string; received_at:Date;
}
export async function record(s:TenantAccess,id:string,parcelId:string,referenceId:string,e:Observation,statusCode:string,observationId:string|null) {
  const c=assertTenantAccess(s,['carriers.write']);
  const source=(e.provenance.mode==='manual'?'manual:':'external:')+e.sourceRecordId;
  const before=(await scopedQuery<TrackingRecord>(s,['carriers.write'],`SELECT * FROM shipit.carrier_tracking_records
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND source_id=$2
    AND duplicate_of IS NULL AND conflict IS NULL`,[e.reference.installationId,source])).rows[0];
  const status=e.status.state==='mapped'?e.status.status:null,at=e.occurredAt.state==='known'?e.occurredAt.at:null;
  const reason=e.occurredAt.state==='unknown'?e.occurredAt.reason:null;
  const same=before&&before.parcel_id===parcelId&&before.external_docket===e.reference.externalDocket&&before.status_code===statusCode&&
    before.status===status&&(before.occurred_at?new Date(before.occurred_at).getTime():null)===(at?new Date(at).getTime():null)&&before.time_reason===reason;
  const ref=(await scopedQuery<{external_docket:string}>(s,['carriers.write'],`SELECT external_docket FROM shipit.carrier_references
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND installation_id=$2 AND parcel_id=$3`,[referenceId,e.reference.installationId,parcelId])).rows[0];
  if(!ref)throw new HttpError('RESOURCE_NOT_FOUND');
  const conflict=ref.external_docket!==e.reference.externalDocket?'reference_conflict':before&&!same?'source_conflict':null;
  const provenance=e.provenance;
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_tracking_records
    (id,organization_id,franchise_id,installation_id,parcel_id,reference_id,observation_id,source_id,external_docket,status_code,status,
     occurred_at,time_reason,received_at,source_mode,source_ref,duplicate_of,conflict)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17 WHERE {{franchise:$18:$2}}`,
  [id,c.permittedFranchiseIds[0],e.reference.installationId,parcelId,referenceId,observationId,source,e.reference.externalDocket,statusCode,status,at,reason,e.receivedAt,
    provenance.mode==='live_api'?provenance.channel:provenance.mode,
    provenance.mode==='manual'?provenance.commandId:provenance.mode==='file'?provenance.importId:provenance.receiptId,
    !conflict&&same?before.id:null,conflict,c.organizationId]);
}
export async function load(s:TenantAccess,id:string) {
  const row=(await scopedQuery<TrackingRecord>(s,['carriers.read','carriers.write'],`SELECT * FROM shipit.carrier_tracking_records
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function queue(s:TenantAccess,installation:string,after:string|null,limit:number) {
  return (await scopedQuery<TrackingRecord & {decision:string|null;decision_reason:string|null;decided_at:Date|null}>(s,['carriers.read'],`SELECT r.*,d.decision,d.reason_code AS decision_reason,d.decided_at FROM shipit.carrier_tracking_records r
    LEFT JOIN shipit.carrier_tracking_decisions d ON d.organization_id=r.organization_id AND d.franchise_id=r.franchise_id AND d.record_id=r.id
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.installation_id=$1 AND ($2::uuid IS NULL OR r.id>$2)
    ORDER BY r.id LIMIT $3`,[installation,after,limit+1])).rows;
}
export async function parcelFacts(s:TenantAccess,id:string) {
  const row=(await scopedQuery<{status:string;version:number;updated_at:Date;created_at:Date}>(s,['carriers.read','carriers.write'],`SELECT p.status,p.version,p.updated_at,b.confirmed_at AS created_at
    FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function newer(s:TenantAccess,row:TrackingRecord) {
  return (await scopedQuery(s,['carriers.read','carriers.write'],`SELECT r.id FROM shipit.carrier_tracking_records r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.parcel_id=$1 AND r.occurred_at>$2 AND r.occurred_at<=r.received_at
    AND r.duplicate_of IS NULL AND r.conflict IS NULL AND r.status IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM shipit.carrier_tracking_decisions d WHERE d.organization_id=r.organization_id
      AND d.franchise_id=r.franchise_id AND d.record_id=r.id AND d.decision='reject') LIMIT 1`,[row.parcel_id,row.occurred_at])).rows.length>0;
}
export async function conflicting(s:TenantAccess,row:TrackingRecord) {
  return (await scopedQuery(s,['carriers.read','carriers.write'],`SELECT r.id FROM shipit.carrier_tracking_records r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id<>$2
    AND ((r.installation_id=$1 AND r.source_id=$3 AND r.conflict='source_conflict') OR (r.parcel_id=$4 AND r.occurred_at=$5 AND r.status<>$6
      AND r.conflict IS NULL AND r.duplicate_of IS NULL))
    AND NOT EXISTS(SELECT 1 FROM shipit.carrier_tracking_decisions d WHERE d.organization_id=r.organization_id
      AND d.franchise_id=r.franchise_id AND d.record_id=r.id AND d.decision='reject') LIMIT 1`,
  [row.installation_id,row.id,row.source_id,row.parcel_id,row.occurred_at,row.status])).rows.length>0;
}
export interface Decision {id:string;record_id:string;decision:'apply'|'reject';fingerprint:string;event_id:string|null}
export async function replay(s:TenantAccess,key:string,fingerprint:string) {
  const c=assertTenantAccess(s,['carriers.write']);
  const row=(await scopedQuery<Decision>(s,['carriers.write'],`SELECT id,record_id,decision,fingerprint,event_id FROM shipit.carrier_tracking_decisions
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
  if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row;
}
export async function resolved(s:TenantAccess,id:string) {
  return (await scopedQuery(s,['carriers.write'],`SELECT id FROM shipit.carrier_tracking_decisions
    WHERE {{franchise:organization_id:franchise_id}} AND record_id=$1`,[id])).rows.length>0;
}
export async function decide(s:TenantAccess,row:TrackingRecord,key:string,fingerprint:string,input:{decision:string;reason_code:string;expected_parcel_version:number},event:string|null,now:Date) {
  const c=assertTenantAccess(s,['carriers.write']),id=randomUUID();
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_tracking_decisions
    (id,organization_id,franchise_id,record_id,actor_id,key_digest,fingerprint,decision,reason_code,expected_version,expected_parcel_version,event_id,source_ref,correlation_id,decided_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13 WHERE {{franchise:$14:$2}}`,
  [id,c.permittedFranchiseIds[0],row.id,c.actor.id,key,fingerprint,input.decision,input.reason_code,input.expected_parcel_version,event,row.source_ref,c.correlationId,now,c.organizationId]);
  return {id,record_id:row.id,decision:input.decision,event_id:event};
}
export interface Checkpoint {id:string;version:number;cursor_value:string|null;state:string;checked_at:Date;fingerprint:string}
export async function checkpoint(s:TenantAccess,installation:string) {
  return (await scopedQuery<Checkpoint>(s,['carriers.read','carriers.write'],`SELECT id,version,cursor_value,state,checked_at,fingerprint FROM shipit.carrier_tracking_checkpoints
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 ORDER BY version DESC LIMIT 1`,[installation])).rows[0]??null;
}
export async function checkpointById(s:TenantAccess,id:string) {
  return (await scopedQuery<Checkpoint>(s,['carriers.write'],`SELECT id,version,cursor_value,state,checked_at,fingerprint FROM shipit.carrier_tracking_checkpoints
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
}
export async function saveCheckpoint(s:TenantAccess,id:string,installation:string,version:number,cursor:string|null,state:string,fingerprint:string,now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_tracking_checkpoints
    (id,organization_id,franchise_id,installation_id,version,cursor_value,state,fingerprint,checked_at,actor_id,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$10,$11 WHERE {{franchise:$9:$2}}`,
  [id,c.permittedFranchiseIds[0],installation,version,cursor,state,fingerprint,now,c.organizationId,c.actor.id,c.correlationId]);
}
export async function freshness(s:TenantAccess,installation:string) {
  return (await scopedQuery<{last_received_at:Date|null;last_source_at:Date|null}>(s,['carriers.read'],`SELECT max(received_at) AS last_received_at,max(occurred_at) FILTER
    (WHERE occurred_at<=received_at AND conflict IS NULL AND duplicate_of IS NULL) AS last_source_at FROM shipit.carrier_tracking_records
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1`,[installation])).rows[0]!;
}
