import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';

/** Caller has reauthorized a sender binding for this parcel in the same transaction. */
export async function customerCharges(scope:TenantAccess,parcel:string) {
 const row=(await scopedQuery<{booked_paise:string;collected_paise:string;ledger_version:number}>(scope,['whatsapp.inbox.work'],
  `SELECT o.total_paise::text AS booked_paise,coalesce(sum(CASE WHEN e.kind='collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END),0)::text AS collected_paise,
   coalesce(max(e.sequence),0)::integer AS ledger_version FROM shipit.parcels p JOIN shipit.booking_obligations o
   ON o.organization_id=p.organization_id AND o.franchise_id=p.franchise_id AND o.booking_id=p.booking_id
   LEFT JOIN shipit.payment_entries e ON e.organization_id=o.organization_id AND e.franchise_id=o.franchise_id AND e.booking_id=o.booking_id AND e.obligation_id=o.id
   WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 GROUP BY o.id,o.total_paise`,[parcel])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
 return {...row,remaining_paise:(BigInt(row.booked_paise)-BigInt(row.collected_paise)).toString()};
}
