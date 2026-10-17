import type {ReconciliationSource} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
const actions=['reconciliation.read'] as const;
export async function accounts(scope:TenantAccess,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string;name:string;active:boolean;methods:string[]}>(scope,[...actions],`SELECT a.account_id id,a.name,a.active,a.methods FROM shipit.receiving_account_revisions a
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions n WHERE n.organization_id=a.organization_id AND n.franchise_id=a.franchise_id AND n.account_id=a.account_id AND n.version>a.version)
 AND EXISTS(SELECT 1 FROM shipit.receiving_account_revisions past WHERE past.organization_id=a.organization_id AND past.franchise_id=a.franchise_id AND past.account_id=a.account_id AND NOT ('cash'=ANY(past.methods))) AND ($1::uuid IS NULL OR a.account_id>$1) ORDER BY a.account_id LIMIT $2`,[cursor,limit])).rows;
}
export async function imports(scope:TenantAccess,account:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string;period_from:string;period_to:string;recorded_at:string;row_count:number;processed_count:number;review_count:number}>(scope,[...actions],`SELECT i.id,i.period_from::text,i.period_to::text,c.recorded_at::text,jsonb_array_length(i.rows) row_count,
 (SELECT count(DISTINCT row_number)::int FROM shipit.reconciliation_row_outcomes o WHERE o.organization_id=i.organization_id AND o.franchise_id=i.franchise_id AND o.import_id=i.id) processed_count,
 (SELECT count(*)::int FROM shipit.reconciliation_row_outcomes o WHERE o.organization_id=i.organization_id AND o.franchise_id=i.franchise_id AND o.import_id=i.id AND o.state IN ('needs_review','conflict') AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_row_outcomes n WHERE n.organization_id=o.organization_id AND n.franchise_id=o.franchise_id AND n.import_id=o.import_id AND n.row_number=o.row_number AND n.version>o.version)) review_count
 FROM shipit.reconciliation_imports i JOIN shipit.reconciliation_commands c ON c.organization_id=i.organization_id AND c.franchise_id=i.franchise_id AND c.id=i.command_id
 WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.account_id=$1 AND ($2::uuid IS NULL OR i.id>$2) ORDER BY i.id LIMIT $3`,[account,cursor,limit])).rows;
}
export async function sources(scope:TenantAccess,account:string,cursor:string|null,limit:number) {
 return (await scopedQuery<ReconciliationSource&{available_paise:string}>(scope,[...actions],`SELECT s.*,s.business_date::text,s.recorded_at::text,s.amount_paise::text,GREATEST(0,s.amount_paise-COALESCE(a.amount,0))::text available_paise
 FROM shipit.reconciliation_recorded_sources s LEFT JOIN LATERAL(SELECT sum(a.amount_paise) amount FROM shipit.reconciliation_match_sources a
 WHERE a.organization_id=s.organization_id AND a.franchise_id=s.franchise_id AND a.source_id=s.id AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=a.organization_id AND u.franchise_id=a.franchise_id AND u.match_id=a.match_id)) a ON true
 WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.account_id=$1 AND ($2::text IS NULL OR s.id>$2) ORDER BY s.id LIMIT $3`,[account,cursor,limit])).rows;
}
export async function transactions(scope:TenantAccess,account:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string;business_date:string;direction:'credit'|'debit';amount_paise:string;available_paise:string;external_reference:string|null;external_id:string|null;classification:string;classification_version:number}>(scope,[...actions],`SELECT t.id,t.business_date::text,t.direction,t.amount_paise::text,t.external_reference,t.external_id,
 GREATEST(0,t.amount_paise-COALESCE(a.amount,0))::text available_paise,COALESCE(c.classification,'unassigned') classification,COALESCE(c.version,0) classification_version
 FROM shipit.reconciliation_transactions t LEFT JOIN LATERAL(SELECT sum(a.amount_paise) amount FROM shipit.reconciliation_match_transactions a
 WHERE a.organization_id=t.organization_id AND a.franchise_id=t.franchise_id AND a.transaction_id=t.id AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=a.organization_id AND u.franchise_id=a.franchise_id AND u.match_id=a.match_id)) a ON true
 LEFT JOIN LATERAL(SELECT classification,version FROM shipit.reconciliation_classifications c WHERE c.organization_id=t.organization_id AND c.franchise_id=t.franchise_id AND c.transaction_id=t.id ORDER BY version DESC LIMIT 1) c ON true
 WHERE {{franchise:t.organization_id:t.franchise_id}} AND t.account_id=$1 AND ($2::uuid IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3`,[account,cursor,limit])).rows;
}
export async function batches(scope:TenantAccess,account:string,cursor:string|null,limit:number) {
 return (await scopedQuery<{id:string;batch_id:string;version:number;expected_date:string;reference:string;reason:string;receipts:unknown[];fees:unknown[]}>(scope,[...actions],`SELECT b.id,b.batch_id,b.version,b.expected_date::text,b.reference,b.reason,b.receipts,b.fees FROM shipit.reconciliation_batches b
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.account_id=$1 AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_batches n WHERE n.organization_id=b.organization_id AND n.franchise_id=b.franchise_id AND n.batch_id=b.batch_id AND n.version>b.version)
 AND ($2::uuid IS NULL OR b.batch_id>$2) ORDER BY b.batch_id LIMIT $3`,[account,cursor,limit])).rows;
}
