import {randomUUID} from 'node:crypto';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import type {proposalInput} from './finance-workflow-service.ts';
const actions=['finance.request','finance.approve','finance.apply'] as const;
export interface FinancialPolicy {id:string;version:number;discount_review_threshold_paise:string|null;allow_self_approval:boolean;enabled:boolean}
type Component='pre_tax'|'taxable'|'cgst'|'sgst'|'igst'|'rounding'|'refund';
export interface FinancialRequest extends Omit<ReturnType<typeof proposalInput>,Component|'document_links'>,Record<Component,string> {id:string;actor_id:string;recorded_at:string;policy_id:string|null;supersedes_id:string|null;version:number;outcome:'pending'|'approved'|'rejected'|'applied'|'superseded'}
export async function policy(scope:TenantAccess):Promise<FinancialPolicy|null> {
 return (await scopedQuery<FinancialPolicy>(scope,[...actions,'finance.adjust','finance.policy.configure'],`SELECT id,version,discount_review_threshold_paise::text,allow_self_approval,enabled FROM shipit.financial_policy_revisions
 WHERE {{franchise:organization_id:franchise_id}} ORDER BY version DESC LIMIT 1`)).rows[0]??null;
}
export async function replay(scope:TenantAccess,key:string,decision:boolean) {
 return (await scopedQuery<{id:string;fingerprint:string}>(scope,[...actions],`SELECT id,fingerprint FROM ${decision?'shipit.financial_request_decisions':'shipit.financial_adjustment_requests'}
 WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[assertTenantAccess(scope,actions).actor.id,key])).rows[0];
}
export async function request(scope:TenantAccess,id:string):Promise<FinancialRequest> {
 const row=(await scopedQuery<FinancialRequest>(scope,[...actions,'reports.capture'],`SELECT r.id,r.actor_id,to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at,r.policy_id,r.supersedes_id,r.refund_correction_of,r.booking_id,r.expected_financial_version expected_version,r.expected_payment_version payment_version,
 r.kind,r.reason,r.pre_tax::text,r.taxable::text,r.cgst::text,r.sgst::text,r.igst::text,r.rounding::text,r.refund::text,
 COALESCE(d.version,0) version,COALESCE(d.outcome,'pending') outcome FROM shipit.financial_adjustment_requests r
 LEFT JOIN LATERAL (SELECT version,outcome FROM shipit.financial_request_decisions WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND request_id=r.id ORDER BY version DESC LIMIT 1) d ON true
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function appendRequest(scope:TenantAccess,key:string,fingerprint:string,input:ReturnType<typeof proposalInput>,policyId:string|null,supersedesId:string|null=null) {
 const c=assertTenantAccess(scope,['finance.request']),id=randomUUID();
 await scopedQuery(scope,['finance.request'],`INSERT INTO shipit.financial_adjustment_requests
 (id,organization_id,franchise_id,booking_id,actor_id,policy_id,expected_financial_version,expected_payment_version,kind,reason,pre_tax,taxable,cgst,sgst,igst,rounding,refund,key_digest,fingerprint,correlation_id,supersedes_id,refund_correction_of)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21 WHERE {{franchise:$22:$2}}`,
 [id,c.permittedFranchiseIds[0],input.booking_id,c.actor.id,policyId,input.expected_version,input.payment_version,input.kind,input.reason,input.pre_tax,input.taxable,input.cgst,input.sgst,input.igst,input.rounding,input.refund,key,fingerprint,c.correlationId,supersedesId,input.refund_correction_of,c.organizationId]);
 for(const [index,link] of input.document_links.entries()){
  if(link.receipt_id&&!(await scopedQuery(scope,['finance.request'],`SELECT id FROM shipit.issued_receipts WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND id=$2`,[input.booking_id,link.receipt_id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
  await scopedQuery(scope,['finance.request'],`INSERT INTO shipit.financial_document_links
  (organization_id,franchise_id,booking_id,request_id,ordinal,kind,receipt_id,external_ref)
  SELECT {{organization}},$1,$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$1}}`,
  [c.permittedFranchiseIds[0],input.booking_id,id,index+1,link.kind,link.receipt_id,link.external_ref,c.organizationId]);
 }
 return {id};
}
export async function appendDecision(scope:TenantAccess,key:string,fingerprint:string,requestId:string,outcome:'approved'|'rejected') {
 const c=assertTenantAccess(scope,['finance.approve']),id=randomUUID();
 await scopedQuery(scope,['finance.approve'],`INSERT INTO shipit.financial_request_decisions
 (id,organization_id,franchise_id,request_id,actor_id,version,outcome,reason,key_digest,fingerprint,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,1,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
 [id,c.permittedFranchiseIds[0],requestId,c.actor.id,outcome,outcome==='approved'?'review_approved':'review_rejected',key,fingerprint,c.correlationId,c.organizationId]);return {id};
}

export async function refundAccount(scope:TenantAccess,id:string) {
 const row=(await scopedQuery<{id:string;account_id:string;version:number;methods:string[];active:boolean}>(scope,['finance.apply'],`SELECT id,account_id,version,methods,active FROM shipit.receiving_account_revisions
 WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 ORDER BY version DESC LIMIT 1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function appendRefundEvidence(scope:TenantAccess,changeId:string,requestId:string,revisionId:string,evidence:{account_id:string;method:string;occurred_at:string;returned_to_ref:string;transfer_ref:string;cash_location_id?:string;cash_location_revision_id?:string}) {
 const c=assertTenantAccess(scope,['finance.apply']);
 await scopedQuery(scope,['finance.apply'],`INSERT INTO shipit.financial_refund_evidence
 (id,organization_id,franchise_id,request_id,actor_id,source_account_id,source_revision_id,method,occurred_at,returned_to_ref,transfer_ref,cash_location_id,cash_location_revision_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
 [changeId,c.permittedFranchiseIds[0],requestId,c.actor.id,evidence.account_id,revisionId,evidence.method,evidence.occurred_at,evidence.returned_to_ref,evidence.transfer_ref,evidence.cash_location_id??null,evidence.cash_location_revision_id??null,c.organizationId]);
}
export async function appendApplied(scope:TenantAccess,key:string,fingerprint:string,requestId:string,changeId:string) {
 const c=assertTenantAccess(scope,['finance.apply']),id=randomUUID();
 await scopedQuery(scope,['finance.apply'],`INSERT INTO shipit.financial_request_decisions
 (id,organization_id,franchise_id,request_id,actor_id,version,outcome,financial_change_id,reason,key_digest,fingerprint,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,2,'applied',$5,'approved_change_applied',$6,$7,$8 WHERE {{franchise:$9:$2}}`,
 [id,c.permittedFranchiseIds[0],requestId,c.actor.id,changeId,key,fingerprint,c.correlationId,c.organizationId]);return {id};
}
export async function serverTime(scope:TenantAccess) {
 return (await scopedQuery<{now:Date}>(scope,['finance.apply'],'SELECT clock_timestamp() now FROM shipit.franchises WHERE {{franchise:organization_id:id}}')).rows[0]!.now;
}

export async function refundReferenceExists(scope:TenantAccess,account:string,method:string,reference:string) {
 return (await scopedQuery(scope,['finance.apply'],`SELECT id FROM shipit.financial_refund_evidence WHERE {{franchise:organization_id:franchise_id}}
 AND source_account_id=$1 AND method=$2 AND transfer_ref=$3`,[account,method,reference])).rows.length>0;
}

/** Reconstruct the immutable request observation by ledger order, never present-day totals. */
export async function requestObservation(scope:TenantAccess,r:FinancialRequest) {
 const row=(await scopedQuery<import('./finance-rules.ts').FinancialSource>(scope,['reports.capture'],`SELECT
 (b.final_payable_paise-a.pre_tax-a.cgst-a.sgst-a.igst-a.rounding)::text gross,p.net::text collections,a.refund::text refunds,
 ((b.tax_snapshot->>'pre_tax_paise')::numeric-a.pre_tax)::text pre_tax,((b.tax_snapshot->>'taxable_basis_paise')::numeric-a.taxable)::text taxable,
 ((b.tax_snapshot->>'cgst_paise')::numeric-a.cgst)::text cgst,((b.tax_snapshot->>'sgst_paise')::numeric-a.sgst)::text sgst,
 ((b.tax_snapshot->>'igst_paise')::numeric-a.igst)::text igst,((b.tax_snapshot->>'rounding_adjustment_paise')::numeric-a.rounding)::text rounding
 FROM shipit.bookings b CROSS JOIN LATERAL (SELECT COALESCE(sum(pre_tax),0) pre_tax,COALESCE(sum(taxable),0) taxable,
 COALESCE(sum(cgst),0) cgst,COALESCE(sum(sgst),0) sgst,COALESCE(sum(igst),0) igst,COALESCE(sum(rounding),0) rounding,COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END),0) refund
 FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id AND c.version<=$2) a
 CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) net
 FROM shipit.payment_entries e WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND e.sequence<=$3) p
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1`,[r.booking_id,r.expected_version,r.payment_version])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}

export async function decisionHistory(scope:TenantAccess,id:string) {
 return (await scopedQuery<{id:string;actor_id:string;outcome:string;version:number;financial_change_id:string|null;recorded_at:string}>(scope,['reports.capture'],`SELECT id,actor_id,outcome,version,financial_change_id,
 to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at FROM shipit.financial_request_decisions
 WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1 ORDER BY version`,[id])).rows;
}

/** A denied attempt is read/security evidence, never a financial mutation capability. */
export async function recordDeniedDeletion(scope:TenantAccess,id:string) {
 const c=assertTenantAccess(scope,['reports.capture']);
 await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.financial_deletion_denials
 (id,organization_id,franchise_id,request_id,actor_id,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5 WHERE {{franchise:$6:$2}}`,
 [randomUUID(),c.permittedFranchiseIds[0],id,c.actor.id,c.correlationId,c.organizationId]);
}

export async function documentLinks(scope:TenantAccess,id:string) {
 const c=assertTenantAccess(scope,['reports.capture','finance.request']);
 return (await scopedQuery<{kind:string;receipt_id:string|null;external_ref:string|null}>(scope,['reports.capture','finance.request'],`SELECT l.kind,l.receipt_id,l.external_ref FROM shipit.financial_document_links l
 WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.request_id=$1 AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM shipit.financial_adjustment_requests r
 WHERE r.organization_id=l.organization_id AND r.franchise_id=l.franchise_id AND r.id=l.request_id AND r.actor_id=$2)) ORDER BY l.ordinal`,[id,c.action==='finance.request'?c.actor.id:null])).rows.map(link=>({...link,qualification:link.kind==='issued_receipt'?'issued_source':'unverified_external_reference'}));
}

export async function appendSuperseded(scope:TenantAccess,id:string,key:string,fingerprint:string) {
 const c=assertTenantAccess(scope,['finance.request']);
 await scopedQuery(scope,['finance.request'],`INSERT INTO shipit.financial_request_decisions
 (id,organization_id,franchise_id,request_id,actor_id,version,outcome,reason,key_digest,fingerprint,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,1,'superseded','request_amended',$5,$6,$7 WHERE {{franchise:$8:$2}}`,
 [randomUUID(),c.permittedFranchiseIds[0],id,c.actor.id,key,fingerprint,c.correlationId,c.organizationId]);
}

export async function refundTarget(scope:TenantAccess,booking:string,id:string,prefix:number|null=null) {
 const row=(await scopedQuery<{refund:string;corrected:string}>(scope,[...actions,'reports.capture'],`SELECT original.refund::text refund,
 (SELECT COALESCE(sum(c.refund),0)::text FROM shipit.financial_changes c WHERE c.organization_id=original.organization_id AND c.franchise_id=original.franchise_id AND c.booking_id=original.booking_id AND c.kind='refund_correction' AND c.refund_correction_of=original.id AND ($3::integer IS NULL OR c.version<=$3)) corrected
 FROM shipit.financial_changes original WHERE {{franchise:original.organization_id:original.franchise_id}} AND original.booking_id=$1 AND original.id=$2 AND original.kind='refund'`,[booking,id,prefix])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}

/** Minimal own-proposal read; this grants no financial report access. */
export async function requestAccess(scope:TenantAccess,booking:string) {
 const c=assertTenantAccess(scope,['finance.request']);
 await scopedQuery(scope,['finance.request'],`INSERT INTO shipit.financial_access_events(id,organization_id,franchise_id,actor_id,resource_id,action,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,'financial.read',$5 WHERE {{franchise:$6:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.id,booking,c.correlationId,c.organizationId]);
}

/** Safe reference/amount choices; beneficiary, bank/account and transfer evidence stay private. */
export async function refundTargets(scope:TenantAccess,booking:string,version:number) {
 return (await scopedQuery<{id:string;original_paise:string;remaining_paise:string}>(scope,['finance.request'],`SELECT r.id,r.refund::text original_paise,(r.refund-COALESCE(c.corrected,0))::text remaining_paise
 FROM shipit.financial_changes r LEFT JOIN LATERAL (SELECT sum(x.refund) corrected FROM shipit.financial_changes x
 WHERE x.organization_id=r.organization_id AND x.franchise_id=r.franchise_id AND x.booking_id=r.booking_id AND x.refund_correction_of=r.id AND x.kind='refund_correction' AND x.version<=$2) c ON true
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.booking_id=$1 AND r.kind='refund' AND r.version<=$2 AND r.refund-COALESCE(c.corrected,0)>0 ORDER BY r.version`,[booking,version])).rows;
}

export async function policyReplay(scope:TenantAccess,key:string) {
 const c=assertTenantAccess(scope,['finance.policy.configure']);
 return (await scopedQuery<FinancialPolicy&{fingerprint:string}>(scope,['finance.policy.configure'],`SELECT id,version,discount_review_threshold_paise::text,allow_self_approval,enabled,fingerprint FROM shipit.financial_policy_revisions
 WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
}
export async function appendPolicy(scope:TenantAccess,key:string,fingerprint:string,expected:number,enabled:boolean) {
 const c=assertTenantAccess(scope,['finance.policy.configure']),id=randomUUID();
 // Ratified #139 baseline: no preset monetary threshold and a different approver.
 await scopedQuery(scope,['finance.policy.configure'],`INSERT INTO shipit.financial_policy_revisions
 (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,NULL,false,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
 [id,c.permittedFranchiseIds[0],expected+1,enabled,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
 return {id,version:expected+1,discount_review_threshold_paise:null,allow_self_approval:false,enabled};
}

export async function refundCashLocation(scope:TenantAccess,id:string,revision:string,account:string,accountRevision:string) {
 const location=(await scopedQuery<{kind:string;active:boolean;revision_id:string;account_revision_id:string;custodian_id:string|null;account_id:string}>(scope,['finance.apply'],`SELECT l.kind,l.account_id,l.custodian_id,r.active,r.id revision_id,r.account_revision_id FROM shipit.cash_locations l
 JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id=$1`,[id])).rows[0];
 if(!location||location.kind!=='cash'||location.account_id!==account)throw new HttpError('RESOURCE_NOT_FOUND');
 if(!location.active||location.revision_id!==revision||location.account_revision_id!==accountRevision)throw new HttpError('VERSION_CONFLICT');
 if(!(await scopedQuery(scope,['finance.apply'],`SELECT m.user_id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE {{franchise:f.organization_id:f.franchise_id}} AND m.user_id=$1 AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin')`,[location.custodian_id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
