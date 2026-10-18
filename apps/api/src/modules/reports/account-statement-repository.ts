import {createHash,randomUUID} from 'node:crypto';
import type {AccountStatement,AccountStatementLine,StatementAdvance} from '@shippingco/shared';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {statementAmounts,statementTotals} from './account-statement-rules.ts';
const actions=['finance.statement','reports.capture','customer_accounts.read'] as const;
export async function account(scope:TenantAccess,id:string){
 const r=(await scopedQuery<{id:string;debtor_customer_id:string;revision_id:string;name:string}>(scope,['finance.statement','reports.capture','customer_accounts.read'],`SELECT a.id,a.debtor_customer_id,r.id revision_id,r.name FROM shipit.customer_accounts a
 JOIN LATERAL(SELECT id,name FROM shipit.customer_account_revisions x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.account_id=a.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1`,[id])).rows[0];
 if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r;
}
export async function latest(scope:TenantAccess,id:string){return (await scopedQuery<{snapshot:Pick<AccountStatement,'id'|'version'|'source_digest'>}>(scope,['finance.statement','reports.capture','customer_accounts.read'],`SELECT jsonb_build_object('id',id,'version',revision,'source_digest',source_digest) snapshot FROM shipit.account_statements WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 ORDER BY revision DESC LIMIT 1`,[id])).rows[0]?.snapshot;}
export async function capture(scope:TenantAccess,a:Awaited<ReturnType<typeof account>>,from:string,to:string):Promise<AccountStatement>{
 // One MVCC statement captures all sources. Committed/recorded time, never backdated occurrence, orders evidence.
 const r=(await scopedQuery<{as_of:string;rows:(Omit<AccountStatementLine,'amounts'>&{opening:string;charges:string;credits:string;payments:string;refunds:string})[];advances:StatementAdvance[]}>(scope,['finance.statement','reports.capture','customer_accounts.read'],`SELECT captured.* FROM (WITH bounds AS(SELECT $2::date::timestamp AT TIME ZONE 'Asia/Kolkata' start_at,($3::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata' end_at),
 sources AS(SELECT b.id,b.confirmed_at,jsonb_build_object('booking_id',b.id,'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'due_date',ab.due_date::text,
 'source_statement_id',sl.statement_id,'receipt_id',ir.id,'payment_version',p.version,'financial_version',f.version,'original_gross',b.final_payable_paise::text,
 'pre_tax',b.tax_snapshot->>'pre_tax_paise','cgst',b.tax_snapshot->>'cgst_paise','sgst',b.tax_snapshot->>'sgst_paise','igst',b.tax_snapshot->>'igst_paise','rounding',b.tax_snapshot->>'rounding_adjustment_paise',
 'payment_ids',p.ids,'adjustment_ids',f.ids,'payment_evidence',p.evidence,'adjustment_evidence',f.evidence,
 'opening',(CASE WHEN b.confirmed_at<x.start_at THEN b.final_payable_paise::numeric ELSE 0 END-CASE WHEN b.confirmed_at<x.start_at THEN f.old_credit+p.old_paid-f.old_refund ELSE 0 END)::text,
 'charges',(CASE WHEN b.confirmed_at>=x.start_at THEN b.final_payable_paise::numeric ELSE 0 END)::text,'credits',(f.credit-CASE WHEN b.confirmed_at<x.start_at THEN f.old_credit ELSE 0 END)::text,'payments',(p.paid-CASE WHEN b.confirmed_at<x.start_at THEN p.old_paid ELSE 0 END)::text,'refunds',(f.refund-CASE WHEN b.confirmed_at<x.start_at THEN f.old_refund ELSE 0 END)::text) row
 FROM shipit.customer_account_bookings ab JOIN shipit.bookings b ON b.organization_id=ab.organization_id AND b.franchise_id=ab.franchise_id AND b.id=ab.booking_id CROSS JOIN bounds x
 LEFT JOIN shipit.account_statement_lines sl ON sl.organization_id=b.organization_id AND sl.franchise_id=b.franchise_id AND sl.booking_id=b.id
 LEFT JOIN shipit.issued_receipts ir ON ir.organization_id=b.organization_id AND ir.franchise_id=b.franchise_id AND ir.booking_id=b.id AND ir.kind='booking_charge'
 CROSS JOIN LATERAL(SELECT COALESCE(max(sequence),0) version,COALESCE(jsonb_agg(e.id ORDER BY sequence),'[]') ids,COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'amount',e.amount_paise::text,'recorded_at',to_char(pc.committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY sequence),'[]') evidence,
 COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) paid,
 COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END) FILTER(WHERE pc.committed_at<x.start_at),0) old_paid
 FROM shipit.payment_entries e JOIN shipit.payment_commands pc ON pc.organization_id=e.organization_id AND pc.franchise_id=e.franchise_id AND pc.id=e.command_id
 WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id) p
 CROSS JOIN LATERAL(SELECT COALESCE(max(version),0) version,COALESCE(jsonb_agg(c.id ORDER BY version),'[]') ids,COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'reason',c.reason,'credit',(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding)::text,'refund',(CASE WHEN kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END)::text,'recorded_at',to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY version),'[]') evidence,
 COALESCE(sum(pre_tax::numeric+cgst+sgst+igst+rounding),0) credit,COALESCE(sum(pre_tax::numeric+cgst+sgst+igst+rounding) FILTER(WHERE occurred_at<x.start_at),0) old_credit,
 COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END),0) refund,
 COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END) FILTER(WHERE occurred_at<x.start_at),0) old_refund
 FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id) f
 WHERE {{franchise:ab.organization_id:ab.franchise_id}} AND ab.account_id=$1 AND b.confirmed_at<x.end_at ORDER BY b.confirmed_at,b.id LIMIT 5001)
 SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as_of,COALESCE((SELECT jsonb_agg(row ORDER BY confirmed_at,id) FROM sources),'[]') rows,
 COALESCE((SELECT jsonb_agg(v.row ORDER BY v.id) FROM(SELECT mr.id,jsonb_build_object('receipt_id',mr.id,'version',(mc.result->>'version')::int,'received',mr.amount_paise::text,'allocated',mc.result->>'allocated_paise','cod_reserved',cp.reserved::text,'returned',rf.returned::text,'unallocated',(mr.amount_paise-(mc.result->>'allocated_paise')::numeric-cp.reserved-rf.returned)::text) row
 FROM shipit.money_receipts mr
 JOIN LATERAL(SELECT result FROM shipit.money_receipt_commands c WHERE c.organization_id=mr.organization_id AND c.franchise_id=mr.franchise_id AND c.receipt_id=mr.id AND c.state='committed' ORDER BY version DESC LIMIT 1) mc ON true
 CROSS JOIN LATERAL(SELECT COALESCE(sum(reserved_paise),0) reserved FROM shipit.cod_receipt_positions p WHERE p.organization_id=mr.organization_id AND p.franchise_id=mr.franchise_id AND p.receipt_id=mr.id) cp
 CROSS JOIN LATERAL(SELECT COALESCE(sum(amount_paise::numeric),0) returned FROM shipit.advance_refund_commands f WHERE f.organization_id=mr.organization_id AND f.franchise_id=mr.franchise_id AND f.receipt_id=mr.id AND f.operation='return') rf
 WHERE {{franchise:mr.organization_id:mr.franchise_id}} AND mr.customer_id=$4 AND (mr.amount_paise>(mc.result->>'allocated_paise')::numeric+cp.reserved+rf.returned OR rf.returned>0) ORDER BY mr.id LIMIT 5001) v),'[]') advances) captured`,[a.id,from,to,a.debtor_customer_id])).rows[0]!;
 if(r.rows.length>5000||r.advances.length>5000||r.rows.some(l=>l.payment_evidence.length>5000)||Buffer.byteLength(JSON.stringify(r))>8000000)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 const lines=r.rows.map(({opening,charges,credits,payments,refunds,...line})=>({...line,amounts:statementAmounts(BigInt(opening),BigInt(charges),BigInt(credits),BigInt(payments),BigInt(refunds))}));
 const advance=r.advances.reduce((sum,r)=>sum+BigInt(r.unallocated),0n).toString();
 const previous=await latest(scope,a.id),content={account_revision_id:a.revision_id,from_day:from,to_day:to,lines,unallocated_advance:advance,advance_sources:r.advances};
 // Membership added by issuing this document is not a new financial source.
 const source_digest=createHash('sha256').update(JSON.stringify({...content,lines:lines.map(({source_statement_id:_,...line})=>{void _;return line;})})).digest('hex');
 return {id:null,kind:'account_statement_v2',account_id:a.id,account_revision_id:a.revision_id,account_name:a.name,customer_id:a.debtor_customer_id,from_day:from,to_day:to,as_of:r.as_of,version:(previous?.version??0)+1,previous_statement_id:previous?.id??null,source_digest,totals:statementTotals(lines),unallocated_advance:advance,advance_sources:r.advances,lines};
}
export async function issue(scope:TenantAccess,key:string,fingerprint:string,s:AccountStatement){
 const c=assertTenantAccess(scope,['finance.statement']);
 await scopedQuery(scope,['finance.statement'],`INSERT INTO shipit.account_statements(id,organization_id,franchise_id,customer_id,actor_id,key_digest,fingerprint,from_day,to_day,snapshot,correlation_id,account_id,previous_statement_id,revision,source_digest)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14 WHERE {{franchise:$15:$2}}`,[s.id,c.permittedFranchiseIds[0],s.customer_id,c.actor.id,key,fingerprint,s.from_day,s.to_day,s,c.correlationId,s.account_id,s.previous_statement_id,s.version,s.source_digest,c.organizationId]);
 const ids=s.lines.filter(l=>!l.source_statement_id).map(l=>l.booking_id);
 await scopedQuery(scope,['finance.statement'],`INSERT INTO shipit.account_statement_lines(organization_id,franchise_id,statement_id,booking_id) SELECT {{organization}},$1,$2,id FROM unnest($3::uuid[]) id WHERE {{franchise:$4:$1}}`,[c.permittedFranchiseIds[0],s.id,ids,c.organizationId]);
}
export async function read(scope:TenantAccess,id:string){const r=(await scopedQuery<{snapshot:AccountStatement}>(scope,['finance.statement','reports.capture','customer_accounts.read'],`SELECT snapshot FROM shipit.account_statements WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND account_id IS NOT NULL`,[id])).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r.snapshot;}
export async function history(scope:TenantAccess,id:string,cursor:number){return (await scopedQuery<{id:string;version:number;from_day:string;to_day:string;as_of:string}>(scope,['finance.statement','reports.capture','customer_accounts.read'],`SELECT id,revision version,from_day::text,to_day::text,snapshot->>'as_of' as_of FROM shipit.account_statements WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 AND revision>$2 ORDER BY revision LIMIT 51`,[id,cursor])).rows;}
export async function access(scope:TenantAccess,id:string){const c=assertTenantAccess(scope,actions);await scopedQuery(scope,['finance.statement','reports.capture','customer_accounts.read'],`INSERT INTO shipit.financial_access_events(id,organization_id,franchise_id,actor_id,resource_id,action,correlation_id) SELECT $1,{{organization}},$2,$3,$4,'statement.read',$5 WHERE {{franchise:$6:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.id,id,c.correlationId,c.organizationId]);}
