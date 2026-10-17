import {randomUUID} from 'node:crypto';
import {HttpError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {create as bookingInput} from '../bookings/validation.ts';
import type {BookingInput} from '../bookings/validation.ts';
import {checkAccount,creditIntent} from './credit.ts';
interface RequestRow {id:string;account_id:string;operator_id:string;booking_intent:BookingInput;fingerprint:string;approval_id:string|null;expires_at:Date|null;reason:string|null}
export async function request(scope:TenantAccess,body:BookingInput,key:string,writesEnabled=true,now=new Date()) {
 const c=assertTenantAccess(scope,['customer_accounts.request']),fingerprint=creditIntent(body);
 const previous=(await scopedQuery<RequestRow>(scope,['customer_accounts.request'],`SELECT id,fingerprint FROM shipit.customer_credit_requests WHERE {{franchise:organization_id:franchise_id}} AND operator_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
 if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:previous.id};}
 if(!writesEnabled)throw new HttpError('CUSTOMER_ACCOUNTS_DISABLED');
 const checked=await checkAccount(scope,body,now);if(!checked)throw new HttpError('RESOURCE_NOT_FOUND');
 const source=(await scopedQuery(scope,['customer_accounts.request'],`SELECT q.id FROM shipit.pricing_quotes q JOIN shipit.tax_intents i ON i.organization_id=q.organization_id AND i.franchise_id=q.franchise_id AND i.quote_id=q.id AND i.actor_id=q.actor_id
 JOIN shipit.tax_calculations t ON t.organization_id=i.organization_id AND t.franchise_id=i.franchise_id AND t.intent_id=i.id
 WHERE {{franchise:q.organization_id:q.franchise_id}} AND q.id=$1 AND q.actor_id=$2 AND t.id=$3 AND i.input=$4::jsonb
 AND q.expires_at>clock_timestamp() AND (t.result->>'expires_at')::timestamptz>clock_timestamp()`,[body.tax_intent.quote_id,c.actor.id,body.tax_calculation_id,body.tax_intent])).rows[0];
 if(!source)throw new HttpError('QUOTE_STALE');
 const id=randomUUID();await scopedQuery(scope,['customer_accounts.request'],`INSERT INTO shipit.customer_credit_requests(id,organization_id,franchise_id,account_id,operator_id,booking_intent,key_digest,fingerprint,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],checked.a.account_id,c.actor.id,body,key,fingerprint,c.correlationId,c.organizationId]);return {id};
}
export async function readRequest(scope:TenantAccess,id:string) {
 const c=assertTenantAccess(scope,['customer_accounts.request','customer_accounts.approve']);
 const row=(await scopedQuery<RequestRow>(scope,['customer_accounts.request','customer_accounts.approve'],`SELECT r.*,a.id approval_id,a.expires_at,a.reason FROM shipit.customer_credit_requests r
 LEFT JOIN shipit.customer_credit_approvals a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.request_id=r.id
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1 AND ($2::boolean OR r.operator_id=$3)`,[id,c.action==='customer_accounts.approve',c.actor.id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function pending(scope:TenantAccess,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string;account_id:string;name:string;operator_id:string;total_paise:number;expires_at:Date}>(scope,['customer_accounts.approve'],`SELECT r.id,r.account_id,ar.name,r.operator_id,(t.result->>'final_payable_paise')::bigint total_paise,
 LEAST(q.expires_at,(t.result->>'expires_at')::timestamptz) expires_at
 FROM shipit.customer_credit_requests r JOIN shipit.pricing_quotes q ON q.organization_id=r.organization_id AND q.franchise_id=r.franchise_id AND q.id=(r.booking_intent->'tax_intent'->>'quote_id')::uuid
 JOIN shipit.tax_calculations t ON t.organization_id=r.organization_id AND t.franchise_id=r.franchise_id AND t.id=(r.booking_intent->>'tax_calculation_id')::uuid
 JOIN shipit.customer_account_revisions ar ON ar.organization_id=r.organization_id AND ar.franchise_id=r.franchise_id AND ar.id=(q.result->'account'->>'revision_id')::uuid
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND ($1::uuid IS NULL OR r.id>$1) AND q.expires_at>clock_timestamp() AND (t.result->>'expires_at')::timestamptz>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM shipit.customer_credit_approvals a WHERE a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.request_id=r.id)
 ORDER BY r.id LIMIT $2`,[cursor,limit])).rows.map(r=>({...r,total_paise:Number(r.total_paise),expires_at:r.expires_at.toISOString()}));
}

/** Stored intent is normalized domain data; rebuild the wire shape before validating it again. */
export function requestBooking(row:RequestRow):BookingInput {
 const stored=row.booking_intent,body=bookingInput({...stored,parcels:stored.parcels.map(p=>({weight_grams:p.weight_grams,...(p.docket===null?{}:{docket:p.docket}),recipient:{name:p.recipient.name,phone:p.recipient.phone_display,address:p.recipient.address}}))});
 if(creditIntent(body)!==row.fingerprint)throw new HttpError('RESOURCE_NOT_FOUND');return body;
}
