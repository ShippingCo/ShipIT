import type { PricingQuoteDto, PricingQuoteInput, PricingVersionDto } from '@shippingco/shared';
import { FieldValidationError, HttpError } from '../../plugins/errors.ts';
import { digest } from './idempotency.ts';
import { instant } from './types.ts';
export function checked(value:bigint) {
  if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new FieldValidationError('freight_paise','OUT_OF_RANGE');
  return Number(value);
}
export function assertRules(version:Pick<PricingVersionDto,'rules'>) {
  const rules=version.rules;
  for(let i=0;i<rules.length;i++)for(let j=i+1;j<rules.length;j++) {
    const a=rules[i]!,b=rules[j]!;
    if(a.destination_key===b.destination_key&&a.service===b.service&&
      (b.max_weight_grams===null||a.min_weight_grams<b.max_weight_grams)&&
      (a.max_weight_grams===null||b.min_weight_grams<a.max_weight_grams))throw new HttpError('RATE_CONFLICT');
  }
}
export function calculate(version:PricingVersionDto,input:PricingQuoteInput,now:Date,id:string,actor:string,privileged:boolean):PricingQuoteDto {
  if(version.state!=='published'||now.getTime()<Date.parse(version.effective_from)||now.getTime()>=Date.parse(version.effective_to))throw new HttpError('NO_RATE');
  const matches=version.rules.filter(r=>r.destination_key===input.destination_key&&r.service===input.service&&
    input.weight_grams>=r.min_weight_grams&&(r.max_weight_grams===null||input.weight_grams<r.max_weight_grams));
  if(matches.length!==1)throw new HttpError(matches.length?'RATE_CONFLICT':'NO_RATE');
  const rule=matches[0]!,freight=input.override?.freight_paise??rule.freight_paise;
  const delta=BigInt(freight)-BigInt(rule.freight_paise),variance=checked(delta<0n?-delta:delta);
  const excessive=variance>version.override_tolerance_paise;
  if(excessive&&!privileged)throw new HttpError('ACTION_FORBIDDEN');
  const value:Omit<PricingQuoteDto,'fingerprint'>={id,proposal:true,card_id:version.card_id,rate_version_id:version.id,rate_version_number:version.version_number,
    rule_id:rule.id,policy:{effective_from:version.effective_from,effective_to:version.effective_to,quote_validity_seconds:version.quote_validity_seconds,
      override_tolerance_paise:version.override_tolerance_paise,approval_ref:version.approval_ref,source_ref:version.source_ref},inputs:structuredClone(input),freight_suggestion_paise:rule.freight_paise,packing_paise:rule.packing_paise,
    freight_paise:freight,variance_paise:variance,override_status:input.override?(excessive?'privileged':'within_tolerance'):'none',
    approval_actor_id:excessive?actor:null,subtotal_paise:checked(BigInt(freight)+BigInt(rule.packing_paise)),created_at:instant(now),
    expires_at:instant(new Date(Math.min(now.getTime()+version.quote_validity_seconds*1000,Date.parse(version.effective_to)))),
    breakdown:{calculation:'flat_paise_v1',min_weight_grams:rule.min_weight_grams,max_weight_grams:rule.max_weight_grams,excluded:['tax','final_payable_rounding']}};
  return {...value,fingerprint:digest(value)};
}
