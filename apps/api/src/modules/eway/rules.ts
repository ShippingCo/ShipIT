import { HttpError } from '../../plugins/errors.ts';
import { instant,type EwayRow,type Policy,type Estimate } from './types.ts';
export const estimateLabel='ShippingCo estimate — verify on the government portal' as const;
export function selectedPolicy(policies:readonly Policy[],now:Date):Policy|null {
  return policies.filter(p=>p.effective_from<=now).sort((a,b)=>b.effective_from.getTime()-a.effective_from.getTime())[0]??null;
}
export function calculateEstimate(policy:Policy|null,distance:number|null,startsAt:string,now:Date):Estimate {
  if(!policy?.approved||policy.estimate_rule!=='distance_blocks_v1'||!policy.block_km||!policy.block_seconds||!distance)throw new HttpError('EWAY_ESTIMATE_UNAVAILABLE');
  const ms=Math.ceil(distance/policy.block_km)*policy.block_seconds*1000,result=new Date(Date.parse(startsAt)+ms);
  if(!Number.isSafeInteger(ms)||!Number.isFinite(result.getTime())||result.getUTCFullYear()>9999)throw new HttpError('VALIDATION_FAILED');
  return {estimated_valid_until:instant(result),estimate_policy_id:policy.id,estimate_policy_version:policy.version,
    estimate_inputs:{distance_km:distance,starts_at:startsAt,block_km:policy.block_km,block_seconds:policy.block_seconds},
    estimate_calculated_at:instant(now),provenance:'shippingco_estimate',label:estimateLabel};
}
export function evaluate(row:EwayRow|null,policy:Policy|null,now:Date) {
  const official=row?.official_valid_until??null,estimate=row?.estimate?new Date(row.estimate.estimated_valid_until):null;
  const approved=policy?.approved===true,threshold=approved&&policy.threshold_paise!==null?BigInt(policy.threshold_paise):null;
  const value=row?.declared_goods_value_paise??null;
  const valueState=value===null||threshold===null?'unknown':BigInt(value)>=threshold?'threshold_met':'below_threshold';
  const reasons:('policy_verification_required'|'declared_value_unknown'|'value_threshold_met'|'external_reference_missing'|'official_validity_unknown'|'official_expiring'|'official_expired'|'estimate_expiring'|'estimate_expired')[]=[];
  if(!approved)reasons.push('policy_verification_required');
  if(value===null)reasons.push('declared_value_unknown');
  if(valueState==='threshold_met')reasons.push('value_threshold_met');
  if(!row?.external_reference)reasons.push('external_reference_missing');
  if(!official)reasons.push('official_validity_unknown');
  const warning=approved?policy.warning_seconds:null;
  if(official){if(now>=official)reasons.push('official_expired');else if(warning!==null&&official.getTime()-now.getTime()<=warning*1000)reasons.push('official_expiring');}
  if(estimate){if(now>=estimate)reasons.push('estimate_expired');else if(warning!==null&&estimate.getTime()-now.getTime()<=warning*1000)reasons.push('estimate_expiring');}
  return {reference_state:row?.external_reference?'recorded' as const:'missing' as const,
    official_validity_state:official?now>=official?'expired' as const:'source_supported' as const:'unknown' as const,
    estimate_state:estimate?now>=estimate?'expired' as const:'estimated' as const:'absent' as const,
    verification_state:row?.external_reference?'unverified_external' as const:'not_recorded' as const,verified_at:null,
    applicability_state:'unknown' as const,value_check_state:valueState,reminder_reasons:reasons,evaluated_at:instant(now),
    policy:{state:approved?'approved' as const:'no_approved_policy' as const,id:policy?.id??null,version:policy?.version??null,
      effective_from:policy?instant(policy.effective_from):null,source_ref:policy?.source_ref??null,approval_ref:policy?.approval_ref??null}};
}
