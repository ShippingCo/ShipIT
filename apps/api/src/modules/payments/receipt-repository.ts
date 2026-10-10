import type {MoneyReceiptInput,MoneyReceiptResult,MoneyReceiptEvidence,MoneyReceiptAllocation,MoneyReceiptHistoryEntry,ReceiptMethod} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {instant} from '../pricing/types.ts';
import type {MoneyReceiptRow,MoneyReceiptCommand} from './receipt-types.ts';
export async function active(scope:TenantAccess) {
 const row=(await scopedQuery<{lifecycle:string}>(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct'],`SELECT lifecycle FROM shipit.franchises
 WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
export async function customer(scope:TenantAccess,id:string) {
 if(!(await scopedQuery(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct','money_receipts.select'],`SELECT id FROM shipit.customers
 WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function receiver(scope:TenantAccess,id:string) {
 if(!(await scopedQuery(scope,['money_receipts.record'],`SELECT m.user_id FROM shipit.memberships m
 JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id AND s.organization_id=m.organization_id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE {{franchise:s.organization_id:s.franchise_id}} AND m.user_id=$1 AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin')`,[id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function account(scope:TenantAccess,id:string) {
 const row=(await scopedQuery<{id:string;account_id:string;version:number;methods:ReceiptMethod[];active:boolean}>(scope,['money_receipts.record'],`SELECT id,account_id,version,methods,active
 FROM shipit.receiving_account_revisions WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 ORDER BY version DESC LIMIT 1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function receipt(scope:TenantAccess,id:string,lock=false):Promise<MoneyReceiptRow> {
 const row=(await scopedQuery<MoneyReceiptRow>(scope,['money_receipts.allocate','money_receipts.correct','money_receipts.read','money_receipts.select'],`SELECT * FROM shipit.money_receipts
 WHERE {{franchise:organization_id:franchise_id}} AND id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function replay(scope:TenantAccess,key:string) {
 const c=assertTenantAccess(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct']);
 return (await scopedQuery<{fingerprint:string;result:MoneyReceiptResult|null}>(scope,[c.action],`SELECT fingerprint,result FROM shipit.money_receipt_commands
 WHERE {{franchise:organization_id:franchise_id}} AND principal_id=$1 AND operation_id=$2 AND key_digest=$3`,[c.actor.id,'api.v1.'+c.action,key])).rows[0];
}
export async function reserve(scope:TenantAccess,id:string,receipt:string,version:number,key:string,fingerprint:string,input:unknown):Promise<MoneyReceiptCommand> {
 const c=assertTenantAccess(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct']);
 const row=(await scopedQuery<MoneyReceiptCommand>(scope,[c.action],`INSERT INTO shipit.money_receipt_commands
 (id,organization_id,franchise_id,receipt_id,principal_id,operation_id,version,key_digest,fingerprint,input,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}} RETURNING id,receipt_id,version,recorded_at`,
 [id,c.permittedFranchiseIds[0],receipt,c.actor.id,'api.v1.'+c.action,version,key,fingerprint,input,c.correlationId,c.organizationId])).rows[0];
 if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return row;
}
export async function appendReceipt(scope:TenantAccess,p:MoneyReceiptCommand,revision:string,input:MoneyReceiptInput) {
 const c=assertTenantAccess(scope,['money_receipts.record']);
 const result=await scopedQuery(scope,['money_receipts.record'],`INSERT INTO shipit.money_receipts
 (id,organization_id,franchise_id,command_id,customer_id,account_id,account_revision_id,amount_paise,currency,method,receiver_id,initial_custodian_id,occurred_at,external_reference)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,'INR',$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
 [p.receipt_id,c.permittedFranchiseIds[0],p.id,input.customer_id,input.account_id,revision,input.amount_paise,input.method,input.receiver_id,input.custodian_id,input.occurred_at,input.external_reference,c.organizationId]);
 if(result.rowCount!==1)throw new HttpError('TEMPORARILY_UNAVAILABLE');
}
export async function bookingCustomer(scope:TenantAccess,id:string,customer:string) {
 if(!(await scopedQuery(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct'],`SELECT id FROM shipit.bookings
 WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND customer_id=$2`,[id,customer])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function current(scope:TenantAccess,id:string) {
 const c=assertTenantAccess(scope,['money_receipts.allocate','money_receipts.correct','money_receipts.read','money_receipts.select']);
 const row=(await scopedQuery<{result:MoneyReceiptResult}>(scope,[c.action],`SELECT result FROM shipit.money_receipt_commands
 WHERE {{franchise:organization_id:franchise_id}} AND receipt_id=$1 AND state='committed' ORDER BY version DESC LIMIT 1`,[id])).rows[0];
 if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return row.result;
}
export async function allocation(scope:TenantAccess,receipt:string,id:string) {
 const row=(await scopedQuery<{id:string;booking_id:string;obligation_id:string;payment_entry_id:string;amount_paise:string;released:string}>(scope,['money_receipts.correct'],`SELECT a.id,a.booking_id,a.obligation_id,a.payment_entry_id,a.amount_paise,
 COALESCE((SELECT sum(x.amount_paise::numeric) FROM shipit.money_receipt_allocations x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.receipt_id=a.receipt_id AND x.release_of=a.id),0)::text released
 FROM shipit.money_receipt_allocations a WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.receipt_id=$1 AND a.id=$2 AND a.kind='allocation'`,[receipt,id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function appendAllocation(scope:TenantAccess,p:MoneyReceiptCommand,link:MoneyReceiptAllocation,obligation:string) {
 const c=assertTenantAccess(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct']);
 const result=await scopedQuery(scope,[c.action],`INSERT INTO shipit.money_receipt_allocations
 (id,organization_id,franchise_id,receipt_id,command_id,command_version,booking_id,obligation_id,payment_entry_id,kind,amount_paise,release_of)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,
 [link.id,c.permittedFranchiseIds[0],p.receipt_id,p.id,p.version,link.booking_id,obligation,link.payment_entry_id,link.kind,link.amount_paise,link.release_of,c.organizationId]);
 if(result.rowCount!==1)throw new HttpError('TEMPORARILY_UNAVAILABLE');
}
export async function finish(scope:TenantAccess,p:MoneyReceiptCommand):Promise<MoneyReceiptResult> {
 const c=assertTenantAccess(scope,['money_receipts.record','money_receipts.allocate','money_receipts.correct']);
 const row=(await scopedQuery<{result:MoneyReceiptResult}>(scope,[c.action],`UPDATE shipit.money_receipt_commands SET state='committed',
 result=shipit.money_receipt_result(organization_id,franchise_id,id),committed_at=date_trunc('milliseconds',clock_timestamp())
 WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved' RETURNING result`,[p.id])).rows[0];
 if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return row.result;
}
export function evidence(row:MoneyReceiptRow):MoneyReceiptEvidence {
 return {id:row.id,customer_id:row.customer_id,account_id:row.account_id,account_revision_id:row.account_revision_id,method:row.method,
 received_paise:Number(row.amount_paise),currency:'INR',receiver_id:row.receiver_id,initial_custodian_id:row.initial_custodian_id,
 occurred_at:instant(row.occurred_at),recorded_at:instant(row.recorded_at),external_reference:row.external_reference,verification:'manually_recorded_unverified'};
}

export async function customerReceiptIds(scope:TenantAccess,customer:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string}>(scope,['money_receipts.select'],`SELECT id FROM shipit.money_receipts
 WHERE {{franchise:organization_id:franchise_id}} AND customer_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,[customer,cursor,limit])).rows;
}
export async function customerBookingIds(scope:TenantAccess,customer:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string}>(scope,['money_receipts.select'],`SELECT b.id FROM shipit.bookings b
 JOIN shipit.booking_obligations o ON o.organization_id=b.organization_id AND o.franchise_id=b.franchise_id AND o.booking_id=b.id
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.customer_id=$1 AND ($2::uuid IS NULL OR b.id>$2) ORDER BY b.id LIMIT $3`,[customer,cursor,limit])).rows;
}

export async function history(scope:TenantAccess,id:string,cursor:string|null,limit:number):Promise<MoneyReceiptHistoryEntry[]> {
 const rows=(await scopedQuery<MoneyReceiptAllocation&{version:number;recorded_at:Date;released_paise:string;amount_paise:number}>(scope,['money_receipts.select'],`SELECT a.id,a.booking_id,a.payment_entry_id,a.kind,a.amount_paise,a.release_of,c.version,c.recorded_at,
 COALESCE((SELECT sum(x.amount_paise::numeric) FROM shipit.money_receipt_allocations x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.receipt_id=a.receipt_id AND x.release_of=a.id),0)::text AS released_paise
 FROM shipit.money_receipt_allocations a JOIN shipit.money_receipt_commands c ON c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id AND c.id=a.command_id AND c.state='committed'
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.receipt_id=$1 AND ($2::uuid IS NULL OR a.id>$2) ORDER BY a.id LIMIT $3`,[id,cursor,limit])).rows;
 return rows.map(row=>({...row,amount_paise:Number(row.amount_paise),released_paise:Number(row.released_paise),recorded_at:instant(row.recorded_at)}));
}
export async function receivers(scope:TenantAccess,cursor:string|null,limit:number) {
 const c=assertTenantAccess(scope,['money_receipts.select']);
 const rows=(await scopedQuery<{id:string}>(scope,['money_receipts.select'],`SELECT DISTINCT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id
 JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
 WHERE {{franchise:m.organization_id:f.franchise_id}} AND m.lifecycle='active' AND u.lifecycle='active' AND m.role IN ('franchise_admin','operator') AND ($1::uuid IS NULL OR u.id>$1) ORDER BY u.id LIMIT $2`,[cursor,limit])).rows;
 return rows.map(row=>({id:row.id,label:row.id===c.actor.id?'You (signed-in staff)':'Staff '+row.id.slice(-8)}));
}
