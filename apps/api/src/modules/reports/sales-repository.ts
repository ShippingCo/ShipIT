import { reportLimits,type SalesFilter,type SalesRow,type SalesAmounts,type SalesEvidence,type TaxCalculationDto } from '@shippingco/shared';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { utcRange } from './rules.ts';
interface SourceRow {
 id:string;franchise_id:string;customer_id:string;confirmed_at:string;booking_version:number;payment_version:number;
 receipt_id:string|null;receipt_number:string|null;tax:TaxCalculationDto;collections:string;refunds:string;
 corrections:(SalesEvidence&{taxable:string})[];statement_ids:string[];
}
function gcd(a:bigint,b:bigint):bigint{return b===0n?a:gcd(b,a%b);}
export function taxRate(components:TaxCalculationDto['components']):string {
 let n=0n,d=1n;
 for(const c of components){n=n*BigInt(c.denominator)+BigInt(c.numerator)*d;d*=BigInt(c.denominator);const g=gcd(n,d);n/=g;d/=g;}
 return `${n}/${d}`;
}
export function salesRow(r:SourceRow):SalesRow {
 const t=r.tax,pre=BigInt(t.pre_tax_paise),taxable=BigInt(t.taxable_basis_paise),cgst=BigInt(t.cgst_paise),sgst=BigInt(t.sgst_paise),igst=BigInt(t.igst_paise),rounding=BigInt(t.rounding_adjustment_paise);
 const collected=BigInt(r.collections),refund=BigInt(r.refunds),gross=BigInt(t.final_payable_paise);
 const max=(v:bigint)=>v>0n?v:0n;
 const amounts=(p:bigint,b:bigint,c:bigint,s:bigint,i:bigint,a:bigint):SalesAmounts=>({pre_tax:String(p),taxable:String(b),non_taxable:String(p-b),cgst:String(c),sgst:String(s),igst:String(i),gst:String(c+s+i),rounding:String(a),gross:String(p+c+s+i+a),collections:String(collected),refunds:String(refund),outstanding:String(max(p+c+s+i+a-collected+refund)),refundable_credit:String(max(collected-refund-p-c-s-i-a))});
 const sum=(key:'pre_tax'|'taxable'|'cgst'|'sgst'|'igst'|'rounding')=>r.corrections.reduce((n,c)=>n+BigInt(c[key]),0n);
 if(pre+cgst+sgst+igst+rounding!==gross)throw new HttpError('TAX_CONFLICT');
 return {id:r.id,franchise_id:r.franchise_id,customer_id:r.customer_id,confirmed_at:r.confirmed_at,booking_version:r.booking_version,payment_version:r.payment_version,receipt_id:r.receipt_id,receipt_number:r.receipt_number,
 rate:taxRate(t.components),treatment:t.treatment,jurisdiction:t.jurisdiction,policy_id:t.policy_id,
 original:amounts(pre,taxable,cgst,sgst,igst,rounding),amounts:amounts(pre-sum('pre_tax'),taxable-sum('taxable'),cgst-sum('cgst'),sgst-sum('sgst'),igst-sum('igst'),rounding-sum('rounding')),
 corrections:r.corrections,statement_ids:r.statement_ids};
}
export async function captureSales(scope:TenantAccess,filter:SalesFilter,customer:string|null=null) {
 const range=utcRange(filter);
 const result=(await scopedQuery<{as_of:Date;rows:SourceRow[]}>(scope,['reports.capture','finance.statement'],`SELECT statement_timestamp() AS as_of,COALESCE(jsonb_agg(r.row ORDER BY r.confirmed_at,r.id),'[]'::jsonb) rows FROM (
 SELECT b.id,b.confirmed_at,jsonb_build_object('id',b.id,'franchise_id',b.franchise_id,'customer_id',b.customer_id,'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'booking_version',b.version,'tax',b.tax_snapshot,
 'receipt_id',receipt.id,'receipt_number',receipt.number,'payment_version',p.version,'collections',p.collected::text,'refunds',a.refunds::text,'corrections',a.corrections,
 'statement_ids',COALESCE((SELECT jsonb_agg(l.statement_id ORDER BY l.statement_id) FROM shipit.account_statement_lines l WHERE l.organization_id=b.organization_id AND l.franchise_id=b.franchise_id AND l.booking_id=b.id),'[]'::jsonb)) row
 FROM shipit.bookings b
 LEFT JOIN shipit.issued_receipts receipt ON receipt.organization_id=b.organization_id AND receipt.franchise_id=b.franchise_id AND receipt.booking_id=b.id AND receipt.kind='booking_charge'
 CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) collected,COALESCE(max(sequence),0) version
 FROM shipit.payment_entries e WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id) p
 CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END),0) refunds,COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'occurred_at',to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reason',c.reason,'approval_ref',c.approval_ref,
 'refund',c.refund::text,'pre_tax',c.pre_tax::text,'taxable',c.taxable::text,'cgst',c.cgst::text,'sgst',c.sgst::text,'igst',c.igst::text,'rounding',c.rounding::text) ORDER BY c.version),'[]'::jsonb) corrections
 FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id) a
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.confirmed_at >= $1 AND b.confirmed_at < $2 AND ($4::uuid IS NULL OR b.customer_id=$4)
 ORDER BY b.confirmed_at,b.id LIMIT $3) r`,[range.from,range.to,reportLimits.rows+1,customer])).rows[0]!;
 if(result.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 let rows=result.rows.map(salesRow);if(filter.rate!==null)rows=rows.filter(r=>r.rate===filter.rate);
 if(filter.sort==='confirmed_desc')rows.reverse();return {as_of:result.as_of.toISOString(),rows};
}

