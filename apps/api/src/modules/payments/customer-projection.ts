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
 const changes=(await scopedQuery<{reduction:string;refund:string}>(scope,['whatsapp.inbox.work'],`SELECT COALESCE(sum(c.pre_tax+c.cgst+c.sgst+c.igst+c.rounding),0)::text reduction,COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0)::text refund
 FROM shipit.parcels p LEFT JOIN shipit.financial_changes c ON c.organization_id=p.organization_id AND c.franchise_id=p.franchise_id AND c.booking_id=p.booking_id
 WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1`,[parcel])).rows[0]!;
 const adjusted=BigInt(row.booked_paise)-BigInt(changes.reduction),net=BigInt(row.collected_paise)-BigInt(changes.refund),remaining=adjusted-net;
 return {...row,remaining_paise:(remaining>0n?remaining:0n).toString(),...(BigInt(changes.reduction)>0n?{correction:{adjusted_paise:adjusted.toString(),refunded_paise:changes.refund,refundable_credit_paise:(remaining<0n?-remaining:0n).toString()}}:{})};
}
