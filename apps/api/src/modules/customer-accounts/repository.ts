import {randomUUID} from 'node:crypto';
import type {CustomerAccountInput,CustomerAccountDto,AccountRateInput,AccountRateDto} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {instant} from '../pricing/types.ts';
import type {AccountRow,RateRow} from './types.ts';
export function accountDto(row:AccountRow):CustomerAccountDto {
 return {id:row.account_id,revision_id:row.id,version:row.version,debtor_customer_id:row.debtor_customer_id,name:row.name,
 shipping_customer_ids:row.shipping_customer_ids,billing_contact:{name:row.billing_contact.name,phone:row.billing_contact.phone,authorization_ref:row.billing_contact.authorization_ref},
 closing_day:row.closing_day,due_days:row.due_days,credit_limit_paise:Number(row.credit_limit_paise),state:row.state,recorded_at:instant(row.recorded_at)};
}
export function rateDto(row:RateRow):AccountRateDto {
 return {id:row.id,account_id:row.account_id,version:row.version,effective_from:instant(row.effective_from),effective_to:instant(row.effective_to),approval_ref:row.approval_ref,
 rules:row.rules.map(r=>({destination_key:r.destination_key,service:r.service,min_weight_grams:r.min_weight_grams,max_weight_grams:r.max_weight_grams,freight_paise:r.freight_paise,packing_paise:r.packing_paise})),recorded_at:instant(row.recorded_at)};
}
export async function active(scope:TenantAccess) {
 const row=(await scopedQuery<{lifecycle:string}>(scope,['customer_accounts.request','customer_accounts.select','customer_accounts.read','customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','bookings.create'],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
export async function account(scope:TenantAccess,id:string,lock=false):Promise<AccountRow> {
 if(lock)await scopedQuery(scope,['customer_accounts.request','customer_accounts.select','customer_accounts.read','customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','bookings.create'],`SELECT id FROM shipit.customer_accounts WHERE {{franchise:organization_id:franchise_id}} AND id=$1 FOR UPDATE`,[id]);
 const row=(await scopedQuery<AccountRow>(scope,['customer_accounts.request','customer_accounts.select','customer_accounts.read','customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','bookings.create'],`SELECT r.*,a.debtor_customer_id FROM shipit.customer_accounts a
 JOIN LATERAL(SELECT * FROM shipit.customer_account_revisions x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.account_id=a.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function customers(scope:TenantAccess,ids:string[]) {
 const rows=(await scopedQuery<{id:string}>(scope,['customer_accounts.configure'],`SELECT id FROM shipit.customers WHERE {{franchise:organization_id:franchise_id}} AND id=ANY($1::uuid[])`,[ids])).rows;
 if(rows.length!==new Set(ids).size)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function configure(scope:TenantAccess,id:string|null,b:CustomerAccountInput,key:string,fingerprint:string) {
 const c=assertTenantAccess(scope,['customer_accounts.configure']),f=c.permittedFranchiseIds[0]!,accountId=id??randomUUID();
 if(!id)await scopedQuery(scope,['customer_accounts.configure'],`INSERT INTO shipit.customer_accounts(id,organization_id,franchise_id,debtor_customer_id)
 SELECT $1,{{organization}},$2,$3 WHERE {{franchise:$4:$2}}`,[accountId,f,b.debtor_customer_id,c.organizationId]);
 const row=(await scopedQuery<AccountRow>(scope,['customer_accounts.configure'],`INSERT INTO shipit.customer_account_revisions
 (id,organization_id,franchise_id,account_id,version,name,shipping_customer_ids,billing_contact,closing_day,due_days,credit_limit_paise,state,reason,actor_id,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16 WHERE {{franchise:$17:$2}} RETURNING *`,
 [randomUUID(),f,accountId,b.expected_version+1,b.name,b.shipping_customer_ids,b.billing_contact,b.closing_day,b.due_days,b.credit_limit_paise,b.state,b.reason,c.actor.id,c.correlationId,key,fingerprint,c.organizationId])).rows[0]!;
 return accountDto({...row,debtor_customer_id:b.debtor_customer_id});
}
export async function replayAccount(scope:TenantAccess,key:string) {
 const c=assertTenantAccess(scope,['customer_accounts.configure']);
 return (await scopedQuery<AccountRow>(scope,['customer_accounts.configure'],`SELECT r.*,a.debtor_customer_id FROM shipit.customer_account_revisions r
 JOIN shipit.customer_accounts a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.id=r.account_id
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.actor_id=$1 AND r.key_digest=$2`,[c.actor.id,key])).rows[0];
}
export async function rates(scope:TenantAccess,id:string,cursor:number,limit:number) {
 return (await scopedQuery<RateRow>(scope,['customer_accounts.request','customer_accounts.select','customer_accounts.read','customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','bookings.create'],`SELECT * FROM shipit.customer_account_rates WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 AND version>$2 ORDER BY version LIMIT $3`,[id,cursor,limit])).rows;
}
export async function rateVersion(scope:TenantAccess,id:string) {
 return Number((await scopedQuery<{v:number}>(scope,['customer_accounts.rates'],`SELECT COALESCE(max(version),0)::int v FROM shipit.customer_account_rates WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1`,[id])).rows[0]!.v);
}
export async function replayRate(scope:TenantAccess,key:string) {
 const c=assertTenantAccess(scope,['customer_accounts.rates']);
 return (await scopedQuery<RateRow>(scope,['customer_accounts.rates'],`SELECT * FROM shipit.customer_account_rates WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
}
export async function appendRate(scope:TenantAccess,id:string,b:AccountRateInput,key:string,fingerprint:string) {
 const c=assertTenantAccess(scope,['customer_accounts.rates']);
 return rateDto((await scopedQuery<RateRow>(scope,['customer_accounts.rates'],`INSERT INTO shipit.customer_account_rates
 (id,organization_id,franchise_id,account_id,version,effective_from,effective_to,approval_ref,rules,actor_id,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}} RETURNING *`,
 [randomUUID(),c.permittedFranchiseIds[0],id,b.expected_version+1,b.effective_from,b.effective_to,b.approval_ref,JSON.stringify(b.rules),c.actor.id,c.correlationId,key,fingerprint,c.organizationId])).rows[0]!);
}
export async function page(scope:TenantAccess,cursor:string|null,limit:number) {
 return (await scopedQuery<AccountRow>(scope,['customer_accounts.request','customer_accounts.select','customer_accounts.read'],`SELECT r.*,a.debtor_customer_id FROM shipit.customer_accounts a
 JOIN LATERAL(SELECT * FROM shipit.customer_account_revisions x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.account_id=a.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND ($1::uuid IS NULL OR a.id>$1) ORDER BY a.id LIMIT $2`,[cursor,limit])).rows;
}
export async function choices(scope:TenantAccess,customer:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string;name:string;version:number;state:'active'|'held'}>(scope,['customer_accounts.select'],`SELECT a.id,r.name,r.version,r.state FROM shipit.customer_accounts a
 JOIN LATERAL(SELECT * FROM shipit.customer_account_revisions x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.account_id=a.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND $1::uuid=ANY(r.shipping_customer_ids) AND ($2::uuid IS NULL OR a.id>$2) ORDER BY a.id LIMIT $3`,[customer,cursor,limit])).rows;
}
export async function history(scope:TenantAccess,id:string,cursor:number,limit:number) {
 return (await scopedQuery<AccountRow&{actor_id:string}>(scope,['customer_accounts.read'],`SELECT r.*,a.debtor_customer_id FROM shipit.customer_account_revisions r
 JOIN shipit.customer_accounts a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.id=r.account_id
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.account_id=$1 AND r.version>$2 ORDER BY r.version LIMIT $3`,[id,cursor,limit])).rows;
}
