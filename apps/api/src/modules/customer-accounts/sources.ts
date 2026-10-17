import {scopedQuery,type TenantAccess} from '../security/scope.ts';
/** Source amounts at the same server cutoff as the displayed credit; no customer advances are netted. */
export async function creditSources(scope:TenantAccess,account:string,cutoff:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{booking_id:string;due_date:string;gross_paise:string;reduction_paise:string;collected_paise:string;refund_paise:string;outstanding_paise:string}>(scope,['customer_accounts.select'],`SELECT b.id booking_id,ab.due_date::text,
 b.final_payable_paise::text gross_paise,COALESCE(f.reduction,0)::text reduction_paise,COALESCE(p.collected,0)::text collected_paise,COALESCE(f.refund,0)::text refund_paise,
 GREATEST(0,b.final_payable_paise::numeric-COALESCE(f.reduction,0)-COALESCE(p.collected,0)+COALESCE(f.refund,0))::text outstanding_paise
 FROM shipit.customer_account_bookings ab JOIN shipit.bookings b ON b.organization_id=ab.organization_id AND b.franchise_id=ab.franchise_id AND b.id=ab.booking_id
 JOIN shipit.booking_commands bc ON bc.organization_id=b.organization_id AND bc.franchise_id=b.franchise_id AND bc.id=b.command_id
 LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END) collected FROM shipit.payment_entries e JOIN shipit.payment_commands pc ON pc.organization_id=e.organization_id AND pc.franchise_id=e.franchise_id AND pc.id=e.command_id WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND pc.committed_at<=$2) p ON true
 LEFT JOIN LATERAL(SELECT sum(pre_tax::numeric+cgst+sgst+igst+rounding) reduction,sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END) refund FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id AND c.occurred_at<=$2) f ON true
 WHERE {{franchise:ab.organization_id:ab.franchise_id}} AND ab.account_id=$1 AND bc.committed_at<=$2 AND ($3::uuid IS NULL OR b.id>$3)
 ORDER BY b.id LIMIT $4`,[account,cutoff,cursor,limit])).rows;
}
