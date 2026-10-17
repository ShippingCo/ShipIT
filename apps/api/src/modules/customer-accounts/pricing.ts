import type {PricingQuoteDto,PricingQuoteInput,PricingVersionDto} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {calculate} from '../pricing/calculation.ts';
import {digest} from '../pricing/idempotency.ts';
import {instant} from '../pricing/types.ts';
import {account} from './repository.ts';
import type {RateRow} from './types.ts';
/** Recomputed inside quote, tax validation and booking transactions. Never trust browser money. */
export async function calculateAccountQuote(scope:TenantAccess,version:PricingVersionDto,input:PricingQuoteInput,now:Date,id:string,actor:string,privileged:boolean,currentAt=now):Promise<PricingQuoteDto> {
 if(!input.customer_account_id)return calculate(version,input,now,id,actor,privileged);
 if(input.override)throw new HttpError('ACTION_FORBIDDEN');
 const a=await account(scope,input.customer_account_id,true);
 if(a.state!=='active')throw new HttpError('ACCOUNT_HELD');
 // Newer effective versions supersede the entire prior schedule; expiration falls back to franchise rates.
 const rate=(await scopedQuery<RateRow>(scope,['customer_accounts.select','customer_accounts.read','customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','bookings.create'],`SELECT * FROM shipit.customer_account_rates WHERE {{franchise:organization_id:franchise_id}}
 AND account_id=$1 AND effective_from<=$2 ORDER BY effective_from DESC,version DESC LIMIT 1`,[a.account_id,currentAt])).rows[0];
 const matches=rate&&rate.effective_to>currentAt?rate.rules.map((rule,index)=>({rule,index})).filter(({rule:r})=>r.destination_key===input.destination_key&&r.service===input.service&&input.weight_grams>=r.min_weight_grams&&(r.max_weight_grams===null||input.weight_grams<r.max_weight_grams)):[];
 if(matches.length>1)throw new HttpError('RATE_CONFLICT');
 const match=matches[0];
 const selected=match?{...version,rules:[{...match.rule,id:rate!.id}]}:version;
 const result=calculate(selected,input,now,id,actor,privileged);
 if(match){result.rule_id=null;result.expires_at=instant(new Date(Math.min(Date.parse(result.expires_at),rate!.effective_to.getTime())));}
 result.account={id:a.account_id,revision_id:a.id,version:a.version,rate_source:match?'account':'normal',rate_revision_id:match?rate!.id:null,rule_index:match?match.index:null};
 const {fingerprint:_,...evidence}=result;void _;
 return {...evidence,fingerprint:digest(evidence)};
}
