import { assertTenantAccess,scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { EwayRow,Policy,Capture,Estimate,CommandResult } from './types.ts';
export async function parent(scope:TenantAccess,booking:string,write:boolean) {
  const row=(await scopedQuery<{state:string;lifecycle:string}>(scope,['eway.read','eway.write'],`SELECT b.state,f.lifecycle FROM shipit.bookings b
    JOIN shipit.franchises f ON f.organization_id=b.organization_id AND f.id=b.franchise_id
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1`,[booking])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  if(write&&row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
  if(write&&row.state!=='active')throw new HttpError('PARCEL_STATE_CONFLICT');
}
export async function find(scope:TenantAccess,booking:string) {
  return (await scopedQuery<EwayRow>(scope,['eway.read','eway.write'],`SELECT * FROM shipit.eway_records
    WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1`,[booking])).rows[0]??null;
}
export async function policy(scope:TenantAccess,now:Date) {
  return (await scopedQuery<Policy>(scope,['eway.read','eway.write'],`SELECT * FROM shipit.eway_policies
    WHERE {{franchise:organization_id:franchise_id}} AND effective_from<=$1 ORDER BY effective_from DESC LIMIT 1`,[now])).rows[0]??null;
}
export async function replay(scope:TenantAccess,operation:string,key:string,fingerprint:string):Promise<CommandResult|null> {
  const c=assertTenantAccess(scope,['eway.write']);
  const row=(await scopedQuery<CommandResult&{fingerprint:string}>(scope,['eway.write'],`SELECT booking_id,record_id,version,fingerprint FROM shipit.eway_commands
    WHERE {{franchise:organization_id:franchise_id}} AND principal_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
  if(!row)return null;if(row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
  return {booking_id:row.booking_id,record_id:row.record_id,version:row.version};
}
export async function save(scope:TenantAccess,booking:string,id:string,version:number,input:Capture,estimate:Estimate|null,
  command:string,reason:EwayRow['reason_code'],reasonRef:string|null,now:Date) {
  const c=assertTenantAccess(scope,['eway.write']),e=input.external;
  const values=[id,c.permittedFranchiseIds[0],booking,version,input.declaration?.value_paise??null,input.declaration?.source_ref??null,
    e?.issuer??null,e?.reference??null,e?.source_ref??null,e?.issued_at??null,e?.official_valid_until??null,e?.validity_evidence_ref??null,
    input.vehicle_number,input.distance_km,estimate,estimate?.estimate_policy_id??null,c.actor.id,now,reason,reasonRef,command,c.correlationId,c.organizationId];
  if(version===1)await scopedQuery(scope,['eway.write'],`INSERT INTO shipit.eway_records
    (id,organization_id,franchise_id,booking_id,version,declared_goods_value_paise,declaration_source_ref,issuer,external_reference,source_ref,source_issued_at,
    official_valid_until,validity_evidence_ref,vehicle_number,distance_km,estimate,estimate_policy_id,actor_id,captured_at,reason_code,reason_ref,command_id,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22 WHERE {{franchise:$23:$2}}`,values);
  else {
    const result=await scopedQuery(scope,['eway.write'],`UPDATE shipit.eway_records SET version=$4,declared_goods_value_paise=$5,declaration_source_ref=$6,
      issuer=$7,external_reference=$8,source_ref=$9,source_issued_at=$10,official_valid_until=$11,validity_evidence_ref=$12,vehicle_number=$13,distance_km=$14,
      estimate=$15,estimate_policy_id=$16,actor_id=$17,captured_at=$18,reason_code=$19,reason_ref=$20,command_id=$21,correlation_id=$22
      WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND franchise_id=$2 AND booking_id=$3 AND version=$4-1 AND organization_id=$23 RETURNING id`,values);
    if(!result.rows.length)throw new HttpError('VERSION_CONFLICT');
  }
}
export async function receipt(scope:TenantAccess,command:string,result:CommandResult,operation:string,key:string,fingerprint:string,now:Date) {
  const c=assertTenantAccess(scope,['eway.write']);
  await scopedQuery(scope,['eway.write'],`INSERT INTO shipit.eway_commands
    (id,organization_id,franchise_id,booking_id,record_id,version,principal_id,operation,key_digest,fingerprint,committed_at,retain_until)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$10::timestamptz+interval '24 hours' WHERE {{franchise:$11:$2}}`,
  [command,c.permittedFranchiseIds[0],result.booking_id,result.record_id,result.version,c.actor.id,operation,key,fingerprint,now,c.organizationId]);
}
export async function history(scope:TenantAccess,booking:string,after:number,limit:number) {
  return (await scopedQuery<EwayRow>(scope,['eway.read'],`SELECT * FROM shipit.eway_record_revisions
    WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND version>$2 ORDER BY version LIMIT $3`,[booking,after,limit+1])).rows;
}
export async function reminders(scope:TenantAccess,after:string|null,limit:number) {
  return (await scopedQuery<EwayRow&{parent_booking_id:string}>(scope,['eway.read'],`SELECT r.*,b.id AS parent_booking_id FROM shipit.bookings b
    LEFT JOIN shipit.eway_records r ON r.organization_id=b.organization_id AND r.franchise_id=b.franchise_id AND r.booking_id=b.id
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND ($1::uuid IS NULL OR b.id>$1::uuid) ORDER BY b.id LIMIT $2`,[after,limit+1])).rows;
}
