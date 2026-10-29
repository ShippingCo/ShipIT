import {fingerprint as bookingFingerprint} from '../bookings/idempotency.ts';
import {randomUUID} from 'node:crypto';
import type {AccountBookingSnapshot,AccountCredit,CustomerSnapshot,PricingQuoteDto,TaxCalculationDto} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {digest} from '../pricing/idempotency.ts';
import {account} from './repository.ts';
import {accountDueDate} from './validation.ts';
import type {AccountRow} from './types.ts';
import type {BookingInput} from '../bookings/validation.ts';
export function creditIntent(body:BookingInput) {
 const {credit_approval_id:_,...intent}=body;void _;return digest(intent);
}
export async function exposure(scope:TenantAccess,a:AccountRow,now:Date|string,cutoff=false):Promise<AccountCredit> {
 const row=(await scopedQuery<{outstanding:string;overdue:string}>(scope,['customer_accounts.request','customer_accounts.select','customer_accounts.read','customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','bookings.create'],`SELECT
 COALESCE(sum(x.due),0)::text outstanding,COALESCE(sum(x.due) FILTER(WHERE x.due_date<($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date),0)::text overdue
 FROM (SELECT ab.due_date,GREATEST(0,b.final_payable_paise::numeric-COALESCE(f.reduction,0)-COALESCE(p.collected,0)+COALESCE(f.refund,0)) due
 FROM shipit.customer_account_bookings ab JOIN shipit.bookings b ON b.organization_id=ab.organization_id AND b.franchise_id=ab.franchise_id AND b.id=ab.booking_id
 JOIN shipit.booking_commands bc ON bc.organization_id=b.organization_id AND bc.franchise_id=b.franchise_id AND bc.id=b.command_id
 LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END) collected FROM shipit.payment_entries e JOIN shipit.payment_commands pc ON pc.organization_id=e.organization_id AND pc.franchise_id=e.franchise_id AND pc.id=e.command_id WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND (NOT $3::boolean OR pc.committed_at<=$2)) p ON true
 LEFT JOIN LATERAL(SELECT sum(pre_tax::numeric+cgst+sgst+igst+rounding) reduction,sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END) refund FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id AND (NOT $3::boolean OR c.occurred_at<=$2)) f ON true
 WHERE {{franchise:ab.organization_id:ab.franchise_id}} AND ab.account_id=$1 AND (NOT $3::boolean OR bc.committed_at<=$2)) x`,[a.account_id,now,cutoff])).rows[0]!;
 const available=BigInt(a.credit_limit_paise)-BigInt(row.outstanding);
 return {outstanding_paise:row.outstanding,overdue_paise:row.overdue,available_paise:(available>0n?available:0n).toString(),credit_limit_paise:Number(a.credit_limit_paise),state:a.state,as_of:typeof now==='string'?now:now.toISOString()};
}
export async function checkAccount(scope:TenantAccess,body:BookingInput,now:Date) {
 const id=body.tax_intent.pricing_input.customer_account_id;if(!id)return null;
 const a=await account(scope,id,true);
 if(!a.shipping_customer_ids.includes(body.customer_id))throw new HttpError('RESOURCE_NOT_FOUND');
 if(a.state!=='active')throw new HttpError('ACCOUNT_HELD');
 const credit=await exposure(scope,a,now);if(BigInt(credit.overdue_paise)>0n)throw new HttpError('ACCOUNT_OVERDUE');
 return {a,credit};
}
export async function prepareAccountBooking(scope:TenantAccess,body:BookingInput,pricing:PricingQuoteDto,tax:TaxCalculationDto,now:Date):Promise<AccountBookingSnapshot|null> {
 const checked=await checkAccount(scope,body,now);if(!checked){if(body.credit_approval_id)throw new HttpError('ACCOUNT_APPROVAL_INVALID');return null;}
 const {a,credit}=checked,c=assertTenantAccess(scope,['bookings.create']);
 if(pricing.account?.revision_id!==a.id)throw new HttpError('QUOTE_STALE');
 if(body.credit_approval_id) {
  const approval=(await scopedQuery<{id:string}>(scope,['bookings.create'],`SELECT p.id FROM shipit.customer_credit_approvals p
  WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 AND p.account_id=$2 AND p.account_revision_id=$3 AND p.operator_id=$4 AND p.intent_fingerprint=$5 AND p.amount_paise=$6 AND p.expires_at>$7
  AND NOT EXISTS(SELECT 1 FROM shipit.customer_account_bookings b WHERE b.approval_id=p.id)
  AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE m.organization_id=p.organization_id AND f.franchise_id=p.franchise_id AND m.user_id=p.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active') FOR UPDATE OF p`,
  [body.credit_approval_id,a.account_id,a.id,c.actor.id,creditIntent(body),tax.final_payable_paise,now])).rows[0];
  if(!approval)throw new HttpError('ACCOUNT_APPROVAL_INVALID');
 } else if(BigInt(credit.outstanding_paise)+BigInt(tax.final_payable_paise)>BigInt(a.credit_limit_paise))throw new HttpError('ACCOUNT_CREDIT_EXCEEDED');
 const debtor=(await scopedQuery<CustomerSnapshot>(scope,['bookings.create'],`SELECT id AS source_customer_id,version AS source_customer_version,name,phone_normalized AS phone,phone_display,address FROM shipit.customers
 WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[a.debtor_customer_id])).rows[0];
 if(!debtor)throw new HttpError('RESOURCE_NOT_FOUND');
 return {account_id:a.account_id,account_revision_id:a.id,account_version:a.version,debtor,closing_day:a.closing_day,due_days:a.due_days,due_date:accountDueDate(now,a.closing_day,a.due_days),
 credit_limit_paise:Number(a.credit_limit_paise),exposure_before_paise:credit.outstanding_paise,rate_source:pricing.account.rate_source,rate_revision_id:pricing.account.rate_revision_id,approval_id:body.credit_approval_id??null};
}
export async function saveAccountBooking(scope:TenantAccess,booking:string,snapshot:AccountBookingSnapshot) {
 const c=assertTenantAccess(scope,['bookings.create']);
 await scopedQuery(scope,['bookings.create'],`INSERT INTO shipit.customer_account_bookings(booking_id,organization_id,franchise_id,account_id,account_revision_id,debtor_customer_id,rate_revision_id,approval_id,due_date,snapshot)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
 [booking,c.permittedFranchiseIds[0],snapshot.account_id,snapshot.account_revision_id,snapshot.debtor.source_customer_id,snapshot.rate_revision_id,snapshot.approval_id,snapshot.due_date,snapshot,c.organizationId]);
}
export async function approve(scope:TenantAccess,operator:string,body:BookingInput,reason:string,key:string,fingerprint:string,requestId:string|null=null,writesEnabled=true,at?:Date) {
 const c=assertTenantAccess(scope,['customer_accounts.approve']);
 const now=at??(await scopedQuery<{now:Date}>(scope,['customer_accounts.approve'],`SELECT clock_timestamp() now FROM shipit.franchises WHERE {{franchise:organization_id:id}}`)).rows[0]!.now;
 const previous=(await scopedQuery<{id:string;fingerprint:string;expires_at:Date}>(scope,['customer_accounts.approve'],`SELECT id,fingerprint,expires_at FROM shipit.customer_credit_approvals WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
 if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id,expires_at:previous.expires_at.toISOString()};}
 if(requestId&&(await scopedQuery(scope,['customer_accounts.approve'],`SELECT id FROM shipit.customer_credit_approvals WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1`,[requestId])).rows.length)throw new HttpError('ACCOUNT_APPROVAL_INVALID');
 if(!writesEnabled)throw new HttpError('CUSTOMER_ACCOUNTS_DISABLED');
 const checked=await checkAccount(scope,body,now);if(!checked)throw new HttpError('RESOURCE_NOT_FOUND');
 const {a}=checked;
 const source=(await scopedQuery<{pricing:PricingQuoteDto;tax:TaxCalculationDto;tax_input:unknown}>(scope,['customer_accounts.approve'],`SELECT q.result pricing,t.result tax,i.input tax_input FROM shipit.pricing_quotes q
 JOIN shipit.tax_intents i ON i.organization_id=q.organization_id AND i.franchise_id=q.franchise_id AND i.quote_id=q.id AND i.actor_id=q.actor_id
 JOIN shipit.tax_calculations t ON t.organization_id=i.organization_id AND t.franchise_id=i.franchise_id AND t.intent_id=i.id
 WHERE {{franchise:q.organization_id:q.franchise_id}} AND q.id=$1 AND q.actor_id=$2 AND t.id=$3
 AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.user_id=q.actor_id AND m.organization_id=q.organization_id AND f.franchise_id=q.franchise_id AND m.role IN ('org_admin','franchise_admin','operator') AND m.lifecycle='active')`,
 [body.tax_intent.quote_id,operator,body.tax_calculation_id])).rows[0];
 if(!source)throw new HttpError('RESOURCE_NOT_FOUND');
 const expiry=new Date(Math.min(Date.parse(source.pricing.expires_at),Date.parse(source.tax.expires_at)));
 if(expiry<=now||source.pricing.account?.revision_id!==a.id||digest(source.tax_input)!==digest(body.tax_intent))throw new HttpError('QUOTE_STALE');
 const id=randomUUID();
 await scopedQuery(scope,['customer_accounts.approve'],`INSERT INTO shipit.customer_credit_approvals(id,organization_id,franchise_id,account_id,account_revision_id,actor_id,operator_id,intent_fingerprint,amount_paise,reason,expires_at,key_digest,fingerprint,correlation_id,quote_id,tax_calculation_id,request_id,booking_fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15,$16,$17,$18 WHERE {{franchise:$14:$2}}`,
 [id,c.permittedFranchiseIds[0],a.account_id,a.id,c.actor.id,operator,creditIntent(body),source.tax.final_payable_paise,reason,expiry,key,fingerprint,c.correlationId,c.organizationId,body.tax_intent.quote_id,body.tax_calculation_id,requestId,bookingFingerprint({...body,credit_approval_id:id})]);
 return {id,expires_at:expiry.toISOString()};
}

/** The last complete millisecond plus immutable command commit times prevents later writes from entering paged evidence. */
export async function creditTime(scope:TenantAccess,clock?:()=>Date):Promise<string> {
 if(clock)return new Date(clock().getTime()-1).toISOString().replace(/\.(\d{3})Z$/,(_,milliseconds:string)=>'.'+milliseconds+'000Z');
 return (await scopedQuery<{at:string}>(scope,['customer_accounts.select','customer_accounts.approve'],`SELECT to_char((date_trunc('milliseconds',clock_timestamp())-interval '1 millisecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at FROM shipit.franchises WHERE {{franchise:organization_id:id}}`)).rows[0]!.at;
}
