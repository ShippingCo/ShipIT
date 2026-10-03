import { randomUUID } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { assertTenantAccess,type TenantAccess } from '../security/scope.ts';
import { customerEstimate } from '../pricing/customer-estimate.ts';
import { dialogue,firstPrompt,quoteReference,referral,validatedInput,type QuoteDraft,type QuoteInput } from './rules.ts';
import * as repository from './repository.ts';

const manual='Please contact the franchise for staff review. No booking or staff case has been created.';
const money=(v:string)=>`${BigInt(v)/100n}.${String(BigInt(v)%100n).padStart(2,'0')}`;
export function renderEstimate(q:repository.Estimate,refreshed=false,locale:'en'|'hi'='en') {
 if(locale==='hi') {
  const prefix=refreshed?'पिछला अनुमान समाप्त हो गया या नीति बदल गई है। यह नया परिणाम है। ':'';
  const reasons:Record<string,string>={policy_unavailable:'नीति उपलब्ध नहीं',unsupported_origin:'प्रस्थान स्थान समर्थित नहीं',manual_review:'कर्मचारी की समीक्षा ज़रूरी',heavy:'भारी पार्सल',large:'बड़ा पार्सल',unsupported_lane:'मार्ग समर्थित नहीं',dimensional_review:'माप की समीक्षा ज़रूरी',rate_unavailable:'दर उपलब्ध नहीं'};
  if(q.reason)return `${prefix}अनुमान संदर्भ ${q.id}: अनुमान उपलब्ध नहीं (${reasons[q.reason]??'कर्मचारी की समीक्षा ज़रूरी'})। फ्रैंचाइज़ी से संपर्क करें। कोई बुकिंग या कर्मचारी केस नहीं बना है।`;
  return `${prefix}अनुमान संदर्भ ${q.id}: भाड़े का अनुमान INR ${money(q.total_paise!)} (भाड़ा INR ${money(q.freight_paise!)}, पैकिंग INR ${money(q.packing_paise!)})। `+
   `एक पैकेट, ${q.input.weight_grams} g वास्तविक वजन, ${q.input.dimensions_mm.join(' x ')} mm, ${q.input.origin_key} से ${q.input.destination_key}, सेवा ${q.input.service}। `+
   `कर, अंतिम देय राशि का राउंडिंग, पिकअप, बीमा और विशेष हैंडलिंग शामिल नहीं हैं। मान्य है: ${q.expires_at.toISOString()}। यह बुकिंग का बिल नहीं है। `+
   `जाँचने या नया अनुमान पाने के लिए QUOTE ${q.id} भेजें। बुकिंग की पुष्टि नहीं हुई है; बुकिंग के लिए फ्रैंचाइज़ी से संपर्क करें।`;
 }
 const prefix=refreshed?'The previous estimate expired or its policy changed. Here is a refreshed result. ':'';
 if(q.reason)return `${prefix}Quote reference ${q.id}: estimate unavailable (${q.reason.replaceAll('_',' ')}). ${manual}`;
 return `${prefix}Quote reference ${q.id}: non-binding estimate INR ${money(q.total_paise!)} (freight INR ${money(q.freight_paise!)}, packing INR ${money(q.packing_paise!)}). `+
  `One package, ${q.input.weight_grams} g actual weight, ${q.input.dimensions_mm.join(' x ')} mm, ${q.input.origin_key} to ${q.input.destination_key}, ${q.input.service}. `+
  `Excludes tax, final payable rounding, pickup, insurance and special handling. Valid until ${q.expires_at.toISOString()}. This is not a booked invoice. `+
  `Send QUOTE ${q.id} to refresh/check it. Booking is not confirmed; contact the franchise to book.`;
}
export async function quoteTurn(scope:TenantAccess,context:{inbox:string;installation:string;contact:string;conversation:string;now:Date},text:string,draft:QuoteDraft|null,locale:'en'|'hi'='en') {
 assertTenantAccess(scope,['whatsapp.inbox.work']);
 const {inbox,installation,contact,conversation,now}=context;
 if(await repository.limited(scope,installation,contact,now))return {reply:'Quote assistance has reached its hourly limit. Please try later or contact the franchise.',quoteId:null,outcome:'unavailable' as const};
 const policy=await repository.policy(scope),reference=text.trim().match(quoteReference);
 let input:QuoteInput,prior:repository.Estimate|undefined;
 if(reference) {
  prior=await repository.read(scope,reference[1]!.toLowerCase(),installation,contact);
  if(!prior)return {reply:'No quote is available for that reference. Send QUOTE to start a new estimate.',quoteId:null,outcome:'not_found' as const};
  input=validatedInput(prior.input);
  if(prior.expires_at>now&&prior.policy_id===policy?.id&&policy.configuration.enabled) {
   await repository.saveDraft(scope,conversation,null);
   return {reply:renderEstimate(prior,false,locale),quoteId:prior.id,outcome:prior.reason?'unavailable' as const:'answered' as const};
  }
 } else if(/^quote$/i.test(text.trim())) {
  await repository.saveDraft(scope,conversation,{});
  return {reply:firstPrompt,quoteId:null,outcome:'selection_required' as const};
 } else {
  if(!draft)return {reply:'Send QUOTE to start, or QUOTE followed by your quote reference.',quoteId:null,outcome:'unavailable' as const};
  const next=dialogue(draft,text);
  await repository.saveDraft(scope,conversation,next.complete?null:next.draft);
  if(!next.complete)return {reply:next.prompt!,quoteId:null,outcome:'selection_required' as const};
  input=next.complete;
 }
 const result:repository.Estimate={id:randomUUID(),policy_id:policy?.id??null,rate_version_id:policy?.configuration.rate_version_id??null,rule_id:null,input,
  reason:policy?referral(policy.configuration,input):'policy_unavailable',freight_paise:null,packing_paise:null,total_paise:null,
  created_at:now,expires_at:new Date(now.getTime()+900000),refreshed_from:prior?.id??null};
 if(!result.reason) {
  try {
   const price=await customerEstimate(scope,policy!.configuration.rate_version_id,{destination_key:input.destination_key,service:input.service,weight_grams:input.weight_grams},now,result.id);
   result.rule_id=price.rule_id;result.freight_paise=String(price.freight_paise);result.packing_paise=String(price.packing_paise);result.total_paise=String(price.subtotal_paise);
   result.expires_at=new Date(Math.min(Date.parse(price.expires_at),result.expires_at.getTime()));
  }catch(error){if(!(error instanceof HttpError)||!['NO_RATE','RATE_CONFLICT'].includes(error.code))throw error;result.reason='rate_unavailable';}
 }
 await repository.save(scope,inbox,installation,contact,result);
 await repository.saveDraft(scope,conversation,null);
 return {reply:renderEstimate(result,!!prior,locale),quoteId:result.id,outcome:result.reason?'unavailable' as const:'answered' as const};
}
