import type { TenantAccess } from '../security/scope.ts';
export type EwayAction = 'eway.read' | 'eway.write';
export interface EwayScope { access:TenantAccess; accountantOnly:boolean; revision:string }
export interface Declaration { value_paise:number; source_ref:string }
export interface External {
  issuer:string; reference:string; source_ref:string|null; issued_at:string|null;
  official_valid_until:string|null; validity_evidence_ref:string|null;
}
export interface Capture { declaration:Declaration|null; external:External|null; vehicle_number:string|null; distance_km:number|null }
export type CorrectionReason = 'metadata_correction'|'source_extension'|'declaration_correction';
export interface Correction extends Partial<Capture> { expected_version:number; reason_code:CorrectionReason; reason_ref:string }
export interface Policy {
  id:string; organization_id:string; franchise_id:string; version:number; approved:boolean;
  effective_from:Date; source_ref:string; approval_ref:string;
  threshold_paise:string|null; warning_seconds:number|null; estimate_rule:'distance_blocks_v1'|null;
  block_km:number|null; block_seconds:number|null;
}
export interface Estimate {
  estimated_valid_until:string; estimate_policy_id:string; estimate_policy_version:number;
  estimate_inputs:{distance_km:number;starts_at:string;block_km:number;block_seconds:number};
  estimate_calculated_at:string; provenance:'shippingco_estimate';
  label:'ShippingCo estimate — verify on the government portal';
}
export interface EwayRow {
  id:string; organization_id:string; franchise_id:string; booking_id:string; version:number;
  declared_goods_value_paise:string|null; declaration_source_ref:string|null;
  issuer:string|null; external_reference:string|null; source_ref:string|null; source_issued_at:Date|null;
  official_valid_until:Date|null; validity_evidence_ref:string|null;
  vehicle_number:string|null; distance_km:number|null; estimate:Estimate|null; estimate_policy_id:string|null;
  actor_id:string; captured_at:Date; reason_code:CorrectionReason|'initial_capture'|'estimate_recalculation';
  reason_ref:string|null; command_id:string; correlation_id:string;
}
export interface CommandResult { booking_id:string; record_id:string; version:number }
export const instant=(d:Date)=>d.toISOString().replace(/\.000Z$/,'Z').replace(/(\.\d*?[1-9])0+Z$/,'$1Z');
export function capture(row:EwayRow):Capture {
  return {declaration:row.declared_goods_value_paise===null?null:{value_paise:Number(row.declared_goods_value_paise),source_ref:row.declaration_source_ref!},
    external:row.external_reference===null?null:{issuer:row.issuer!,reference:row.external_reference,source_ref:row.source_ref,
      issued_at:row.source_issued_at?instant(row.source_issued_at):null,official_valid_until:row.official_valid_until?instant(row.official_valid_until):null,validity_evidence_ref:row.validity_evidence_ref},
    vehicle_number:row.vehicle_number,distance_km:row.distance_km};
}
export function recordDto(row:EwayRow,accountantOnly:boolean) {
  const c=capture(row);
  return {record_id:row.id,booking_id:row.booking_id,version:row.version,declaration:c.declaration,
    external:c.external?{...c.external,provenance:'external_observation' as const,verification_state:'unverified_external' as const,verified_at:null}:null,
    estimate:accountantOnly?row.estimate?{estimated_valid_until:row.estimate.estimated_valid_until,estimate_policy_id:row.estimate.estimate_policy_id,
      estimate_policy_version:row.estimate.estimate_policy_version,provenance:row.estimate.provenance,label:row.estimate.label}:null:row.estimate,
    captured_at:instant(row.captured_at),...(accountantOnly?{}:{vehicle_number:c.vehicle_number,distance_km:c.distance_km,
      captured_by:row.actor_id,reason_code:row.reason_code,reason_ref:row.reason_ref})};
}
