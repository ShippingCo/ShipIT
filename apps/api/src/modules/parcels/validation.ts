import { FieldValidationError } from '../../plugins/errors.ts';
import { integer,object,uuid } from '../tax/validation.ts';
import type { FailureReason,FailureSubreason,ParcelCommandInput,ParcelOperation,RtoOverrideReason } from './types.ts';

const failures:readonly FailureReason[]=['customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue','other_controlled'];
const subreasons:readonly FailureSubreason[]=['weather_disruption','vehicle_breakdown','route_access_restricted','device_or_network_failure'];
const overrides:readonly RtoOverrideReason[]=['safety_risk','legal_restriction','operationally_unserviceable'];
const invalid=(field:'reason_code'|'failure_subreason_code'|'override_reason_code')=>{throw new FieldValidationError(field,'INVALID_FORMAT');};
export function command(operation:ParcelOperation,value:unknown):ParcelCommandInput {
  const common=['expected_version','evidence_ref'];
  const keys=operation==='parcels.check_in'?[...common,'location_ref']:
    operation==='parcels.dispatch'?[...common,'manifest_id']:
    operation==='parcels.transit'?[...common,'route_id']:
    operation==='parcels.fail_delivery'?[...common,'attempt_id','reason_code','failure_subreason_code']:
    [...common,'approval_ref','return_plan_ref','override_reason_code'];
  const b=object(value,keys);
  const result:ParcelCommandInput={expected_version:integer(b.expected_version,'expected_version',1,2147483646),evidence_ref:uuid(b.evidence_ref,'evidence_ref')};
  if(operation==='parcels.check_in')result.location_ref=uuid(b.location_ref,'location_ref');
  if(operation==='parcels.dispatch')result.manifest_id=uuid(b.manifest_id,'manifest_id');
  if(operation==='parcels.transit')result.route_id=uuid(b.route_id,'route_id');
  if(operation==='parcels.fail_delivery'){
    result.attempt_id=uuid(b.attempt_id,'attempt_id');
    if(typeof b.reason_code!=='string'||!failures.includes(b.reason_code as FailureReason))invalid('reason_code');
    result.reason_code=b.reason_code as FailureReason;
    if(b.reason_code==='other_controlled'){
      if(typeof b.failure_subreason_code!=='string'||!subreasons.includes(b.failure_subreason_code as FailureSubreason))invalid('failure_subreason_code');
      result.failure_subreason_code=b.failure_subreason_code as FailureSubreason;
    }else if(b.failure_subreason_code!==undefined)invalid('failure_subreason_code');
  }
  if(operation==='parcels.approve_rto'){
    result.approval_ref=uuid(b.approval_ref,'approval_ref');result.return_plan_ref=uuid(b.return_plan_ref,'return_plan_ref');
    if(b.override_reason_code!==undefined){if(typeof b.override_reason_code!=='string'||!overrides.includes(b.override_reason_code as RtoOverrideReason))invalid('override_reason_code');result.override_reason_code=b.override_reason_code as RtoOverrideReason;}
  }
  return result;
}
