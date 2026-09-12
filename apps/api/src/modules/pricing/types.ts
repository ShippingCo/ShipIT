import type { PricingRuleInput, PricingVersionDto, PricingQuoteDto } from '@shippingco/shared';
export type PricingAction = 'pricing.read' | 'pricing.draft' | 'pricing.publish' | 'pricing.quote' |
  'pricing.override' | 'pricing.override.approve' | 'pricing.validate';
export type PricingOperation = 'api.v1.pricing.draft' | 'api.v1.pricing.replace' | 'api.v1.pricing.publish' | 'api.v1.pricing.quote';
export interface RuleRow extends Omit<PricingRuleInput, 'min_weight_grams'|'max_weight_grams'|'freight_paise'|'packing_paise'> {
  id: string; min_weight_grams: string; max_weight_grams: string|null; freight_paise:string; packing_paise:string;
}
export interface VersionRow {
  id:string;card_id:string;version_number:number;revision:number;state:'draft'|'published';
  effective_from:Date;effective_to:Date;quote_validity_seconds:number;override_tolerance_paise:string;
  approval_ref:string;source_ref:string;created_at:Date;published_at:Date|null;published_by:string|null;
}
export function instant(date:Date) { return date.toISOString().replace(/\.000Z$/, 'Z').replace(/(\.\d*?[1-9])0+Z$/, '$1Z'); }
export function ruleDto(row:RuleRow) { return {id:row.id,destination_key:row.destination_key,service:row.service,
  min_weight_grams:Number(row.min_weight_grams),max_weight_grams:row.max_weight_grams===null?null:Number(row.max_weight_grams),
  freight_paise:Number(row.freight_paise),packing_paise:Number(row.packing_paise)}; }
export function versionDto(row:VersionRow,rules:RuleRow[]):PricingVersionDto {
  return {id:row.id,card_id:row.card_id,version_number:row.version_number,version:row.revision,state:row.state,
    effective_from:instant(row.effective_from),effective_to:instant(row.effective_to),quote_validity_seconds:row.quote_validity_seconds,
    override_tolerance_paise:Number(row.override_tolerance_paise),approval_ref:row.approval_ref,source_ref:row.source_ref,
    created_at:instant(row.created_at),published_at:row.published_at?instant(row.published_at):null,published_by:row.published_by,
    rules:rules.map(ruleDto)};
}

/** Explicit receipt projection: later private JSON fields never enter a replay DTO. */
export function replayDto(value:PricingVersionDto|PricingQuoteDto):PricingVersionDto|PricingQuoteDto {
  if('rate_version_id' in value) {
    const p=value.policy,b=value.breakdown,i=value.inputs;
    return {id:value.id,proposal:true,card_id:value.card_id,rate_version_id:value.rate_version_id,rate_version_number:value.rate_version_number,
      rule_id:value.rule_id,inputs:{destination_key:i.destination_key,service:i.service,weight_grams:i.weight_grams,
        ...(i.override?{override:{freight_paise:i.override.freight_paise,reason_code:i.override.reason_code}}:{})},
      policy:{effective_from:p.effective_from,effective_to:p.effective_to,quote_validity_seconds:p.quote_validity_seconds,
        override_tolerance_paise:p.override_tolerance_paise,approval_ref:p.approval_ref,source_ref:p.source_ref},
      freight_suggestion_paise:value.freight_suggestion_paise,packing_paise:value.packing_paise,freight_paise:value.freight_paise,
      variance_paise:value.variance_paise,override_status:value.override_status,approval_actor_id:value.approval_actor_id,
      subtotal_paise:value.subtotal_paise,created_at:value.created_at,expires_at:value.expires_at,fingerprint:value.fingerprint,
      breakdown:{calculation:'flat_paise_v1',min_weight_grams:b.min_weight_grams,max_weight_grams:b.max_weight_grams,excluded:['tax','final_payable_rounding']}};
  }
  return {id:value.id,card_id:value.card_id,version_number:value.version_number,version:value.version,state:value.state,
    effective_from:value.effective_from,effective_to:value.effective_to,quote_validity_seconds:value.quote_validity_seconds,
    override_tolerance_paise:value.override_tolerance_paise,approval_ref:value.approval_ref,source_ref:value.source_ref,
    created_at:value.created_at,published_at:value.published_at,published_by:value.published_by,
    rules:value.rules.map(r=>({id:r.id,destination_key:r.destination_key,service:r.service,min_weight_grams:r.min_weight_grams,
      max_weight_grams:r.max_weight_grams,freight_paise:r.freight_paise,packing_paise:r.packing_paise}))};
}
