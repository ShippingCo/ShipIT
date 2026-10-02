import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';

/** Minimum issued document summary; never returns names, other dockets or staff fields. */
export async function customerReceipt(scope:TenantAccess,parcel:string) {
 const row=(await scopedQuery<{number:string;issued_at:Date;booked_paise:string}>(scope,['whatsapp.inbox.work'],
  `SELECT r.number,r.issued_at,r.snapshot->'charges'->'tax'->>'final_payable_paise' AS booked_paise
   FROM shipit.parcels p JOIN shipit.issued_receipts r ON r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id AND r.booking_id=p.booking_id
   WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 AND r.kind='booking_charge'`,[parcel])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
 return {...row,issued_at:row.issued_at.toISOString()};
}
