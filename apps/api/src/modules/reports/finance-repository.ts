import { assertTenantAccess,scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { changeInput } from './finance-service.ts';
import type { SalesRow,SalesAmounts } from '@shippingco/shared';
import { randomUUID } from 'node:crypto';

export async function access(scope:TenantAccess,id:string,action:'financial.read'|'statement.read'){
 const c=assertTenantAccess(scope,['reports.capture']);await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.financial_access_events(id,organization_id,franchise_id,actor_id,resource_id,action,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.id,id,action,c.correlationId,c.organizationId]);
}

export async function lock(scope:TenantAccess){const r=(await scopedQuery<{lifecycle:string}>(scope,['finance.policy.configure','finance.request','finance.approve','finance.apply','finance.adjust','finance.statement'],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');if(r.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');}
export async function replay(scope:TenantAccess,key:string,statement:boolean){
 return (await scopedQuery<{id:string;fingerprint:string}>(scope,['finance.adjust','finance.statement'],`SELECT id,fingerprint FROM ${statement?'shipit.account_statements':'shipit.financial_changes'} WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[assertTenantAccess(scope).actor.id,key])).rows[0];
}
export async function current(scope:TenantAccess,id:string,locking=false){
 const b=(await scopedQuery<{id:string}>(scope,['reports.capture','finance.request','finance.approve','finance.apply','finance.adjust','finance.statement'],`SELECT id FROM shipit.booking_obligations WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 ${locking?'FOR UPDATE':''}`,[id])).rows[0];if(!b)throw new HttpError('RESOURCE_NOT_FOUND');
 const r=(await scopedQuery<{version:number;payment_version:number;gross:string;collections:string;refunds:string;pre_tax:string;taxable:string;cgst:string;sgst:string;igst:string;rounding:string;changes:unknown[]}>(scope,['reports.capture','finance.request','finance.approve','finance.apply','finance.adjust','finance.statement'],`SELECT a.version,p.version payment_version,(b.final_payable_paise-a.pre_tax-a.cgst-a.sgst-a.igst-a.rounding)::text gross,p.net::text collections,a.refund::text refunds,
 ((b.tax_snapshot->>'pre_tax_paise')::numeric-a.pre_tax)::text pre_tax,((b.tax_snapshot->>'taxable_basis_paise')::numeric-a.taxable)::text taxable,
 ((b.tax_snapshot->>'cgst_paise')::numeric-a.cgst)::text cgst,((b.tax_snapshot->>'sgst_paise')::numeric-a.sgst)::text sgst,((b.tax_snapshot->>'igst_paise')::numeric-a.igst)::text igst,((b.tax_snapshot->>'rounding_adjustment_paise')::numeric-a.rounding)::text rounding,a.changes
 FROM shipit.bookings b CROSS JOIN LATERAL (SELECT COALESCE(max(version),0) version,COALESCE(sum(pre_tax),0) pre_tax,COALESCE(sum(taxable),0) taxable,COALESCE(sum(cgst),0) cgst,COALESCE(sum(sgst),0) sgst,COALESCE(sum(igst),0) igst,COALESCE(sum(rounding),0) rounding,COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END),0) refund,
 COALESCE(jsonb_agg(jsonb_build_object('id',id,'version',version,'kind',kind,'reason',reason,'approval_ref',approval_ref,'occurred_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'refund',refund::text) ORDER BY version),'[]'::jsonb) changes
 FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id) a
 CROSS JOIN LATERAL (SELECT COALESCE(max(sequence),0) version,COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) net FROM shipit.payment_entries e WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id) p
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1`,[id])).rows[0]!;
 return r;
}
export async function append(scope:TenantAccess,id:string,key:string,fingerprint:string,input:ReturnType<typeof changeInput>,refundCorrectionOf:string|null=null){
 const c=assertTenantAccess(scope,['finance.apply','finance.adjust','finance.statement']);await scopedQuery(scope,['finance.apply','finance.adjust','finance.statement'],`INSERT INTO shipit.financial_changes(id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,pre_tax,taxable,cgst,sgst,igst,rounding,refund,returned_to_ref,correlation_id,refund_correction_of)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21 WHERE {{franchise:$22:$2}}`,[id,c.permittedFranchiseIds[0],input.booking_id,c.actor.id,key,fingerprint,input.expected_version+1,input.payment_version,input.kind,input.reason,input.approval_ref,input.pre_tax,input.taxable,input.cgst,input.sgst,input.igst,input.rounding,input.refund,input.returned_to_ref,c.correlationId,refundCorrectionOf,c.organizationId]);
}
export async function customer(scope:TenantAccess,id:string){if(!(await scopedQuery(scope,['finance.adjust','finance.statement'],`SELECT id FROM shipit.customers WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');}
interface Statement {id:string;kind:'account_statement';customer_id:string;from_day:string;to_day:string;as_of:string;rows:SalesRow[];totals:SalesAmounts}
export async function issue(scope:TenantAccess,key:string,fingerprint:string,s:Statement){
 const c=assertTenantAccess(scope,['finance.adjust','finance.statement']);await scopedQuery(scope,['finance.adjust','finance.statement'],`INSERT INTO shipit.account_statements(id,organization_id,franchise_id,customer_id,actor_id,key_digest,fingerprint,from_day,to_day,snapshot,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,[s.id,c.permittedFranchiseIds[0],s.customer_id,c.actor.id,key,fingerprint,s.from_day,s.to_day,s,c.correlationId,c.organizationId]);
 await scopedQuery(scope,['finance.adjust','finance.statement'],`INSERT INTO shipit.account_statement_lines(organization_id,franchise_id,statement_id,booking_id) SELECT {{organization}},$1,$2,id FROM unnest($3::uuid[]) id WHERE {{franchise:$4:$1}}`,[c.permittedFranchiseIds[0],s.id,s.rows.map(r=>r.id),c.organizationId]);
}
export async function statement(scope:TenantAccess,id:string){const r=(await scopedQuery<{snapshot:Statement}>(scope,['reports.capture','finance.adjust','finance.statement'],`SELECT snapshot FROM shipit.account_statements WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r.snapshot;}


