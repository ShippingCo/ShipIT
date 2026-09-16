import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { ReceiptDto } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import type { ReceiptRow } from './types.ts';
const columns='id,number,schema_version,version,booking_id,issued_at,kind,booking_receipt_id,correction_of,snapshot';
export async function find(scope:TenantAccess,booking:string,payment:string|null) {
  return (await scopedQuery<ReceiptRow>(scope,['receipts.read'],`SELECT ${columns} FROM shipit.issued_receipts
    WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND payment_entry_id IS NOT DISTINCT FROM $2::uuid`,[booking,payment])).rows[0];
}
export async function byId(scope:TenantAccess,id:string) {
  const row=(await scopedQuery<ReceiptRow>(scope,['receipts.read'],`SELECT ${columns} FROM shipit.issued_receipts
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function insert(scope:TenantAccess,id:string,booking:string,obligation:string,kind:ReceiptDto['kind'],payment:string|null,base:string|null,correction:string|null) {
  const c=assertTenantAccess(scope,['receipts.materialize']);
  const row=(await scopedQuery<ReceiptRow>(scope,['receipts.materialize'],`INSERT INTO shipit.issued_receipts
    (id,organization_id,franchise_id,booking_id,obligation_id,kind,payment_entry_id,booking_receipt_id,correction_of,actor_id,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}} RETURNING ${columns}`,
    [id,c.permittedFranchiseIds[0],booking,obligation,kind,payment,base,correction,c.actor.id,c.correlationId,c.organizationId])).rows[0];
  if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return row;
}
