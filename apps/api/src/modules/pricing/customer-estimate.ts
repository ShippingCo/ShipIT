import type { PricingQuoteInput } from '@shippingco/shared';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { calculate } from './calculation.ts';
import { versionDto,type VersionRow,type RuleRow } from './types.ts';

/** A signed-channel caller may calculate only the explicitly approved published version.
 * Reuse Pricing's calculation; never return the card/rules directory to a customer. */
export async function customerEstimate(scope:TenantAccess,version:string,input:PricingQuoteInput,now:Date,id:string) {
 const row=(await scopedQuery<VersionRow>(scope,['whatsapp.inbox.work'],`SELECT v.* FROM shipit.pricing_versions v
  WHERE {{franchise:v.organization_id:v.franchise_id}} AND v.id=$1 AND v.state='published' AND v.effective_from<=$2 AND v.effective_to>$2`,[version,now])).rows[0];
 if(!row)throw new HttpError('NO_RATE');
 const rules=(await scopedQuery<RuleRow>(scope,['whatsapp.inbox.work'],`SELECT r.* FROM shipit.pricing_rules r
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.version_id=$1 AND r.destination_key=$2 AND r.service=$3
   AND r.min_weight_grams<=$4 AND (r.max_weight_grams IS NULL OR r.max_weight_grams>$4) LIMIT 2`,[version,input.destination_key,input.service,input.weight_grams])).rows;
 return calculate(versionDto(row,rules),input,now,id,scope.context.actor.id,false);
}
