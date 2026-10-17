import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {transaction} from './imports.ts';
import {HttpError} from '../../plugins/errors.ts';
const actions=['reconciliation.read','reconciliation.configure','reconciliation.import','reconciliation.reconcile','reconciliation.unmatch'] as const;
export async function suggestions(scope:TenantAccess,id:string,cursor:string|null,limit:number) {
 const t=await transaction(scope,id);
 return (await scopedQuery<{source_id:string;source_version:string;source_kind:string;amount_paise:string;available_paise:string;external_reference:string|null;business_date:string;kind:'exact'|'review'}>(scope,[...actions],`SELECT s.id source_id,s.version source_version,s.source_kind,s.amount_paise::text,
 GREATEST(0,s.amount_paise-COALESCE(used.amount,0))::text available_paise,s.external_reference,s.business_date::text,
 CASE WHEN s.external_reference IS NOT NULL AND s.external_reference=$4 AND s.amount_paise=$5 AND COALESCE(used.amount,0)=0
 AND (SELECT count(*) FROM shipit.reconciliation_recorded_sources x WHERE x.organization_id=s.organization_id AND x.franchise_id=s.franchise_id AND x.account_id=s.account_id AND x.direction=s.direction AND x.external_reference=s.external_reference AND x.amount_paise=s.amount_paise)=1
 AND (SELECT count(*) FROM shipit.reconciliation_transactions x WHERE x.organization_id=s.organization_id AND x.franchise_id=s.franchise_id AND x.account_id=s.account_id AND x.direction=s.direction AND x.external_reference=s.external_reference AND x.amount_paise=s.amount_paise)=1
 AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_match_transactions a WHERE a.organization_id=s.organization_id AND a.franchise_id=s.franchise_id AND a.transaction_id=$1 AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=a.organization_id AND u.franchise_id=a.franchise_id AND u.match_id=a.match_id))
 THEN 'exact' ELSE 'review' END kind
 FROM shipit.reconciliation_recorded_sources s
 LEFT JOIN LATERAL(SELECT sum(a.amount_paise) amount FROM shipit.reconciliation_match_sources a WHERE a.organization_id=s.organization_id AND a.franchise_id=s.franchise_id AND a.source_id=s.id AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=a.organization_id AND u.franchise_id=a.franchise_id AND u.match_id=a.match_id)) used ON true
 WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.account_id=$2 AND s.direction=$3 AND s.amount_paise>COALESCE(used.amount,0)
 AND ((s.external_reference IS NOT NULL AND s.external_reference=$4) OR (s.amount_paise=$5 AND s.business_date=$6))
 AND ($7::text IS NULL OR s.id>$7) ORDER BY s.id LIMIT $8`,[id,t.account_id,t.direction,t.external_reference,t.amount_paise,t.business_date,cursor,limit])).rows;
}
/** Private command results are not included in history; exact intent evidence is read through its scoped resource. */
export async function history(scope:TenantAccess,id:string,cursor:string|null,limit:number) {
 // Empty history is valid for an owned source; guessed foreign/unknown IDs are not resources.
 const owned=(await scopedQuery(scope,[...actions],`SELECT f.id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} AND (
 EXISTS(SELECT 1 FROM shipit.reconciliation_commands c WHERE c.organization_id=f.organization_id AND c.franchise_id=f.id AND c.resource_id=$1)
 OR EXISTS(SELECT 1 FROM shipit.reconciliation_recorded_sources s WHERE s.organization_id=f.organization_id AND s.franchise_id=f.id AND s.source_id=$1)
 OR EXISTS(SELECT 1 FROM shipit.reconciliation_transactions t WHERE t.organization_id=f.organization_id AND t.franchise_id=f.id AND t.id=$1)
 OR EXISTS(SELECT 1 FROM shipit.cashbook_source_facts s WHERE s.organization_id=f.organization_id AND s.franchise_id=f.id AND s.source_id=$1))`,[id])).rows.length;
 if(!owned)throw new HttpError('RESOURCE_NOT_FOUND');
 return (await scopedQuery<{id:string;action:string;actor_id:string;recorded_at:string;resource_id:string;reason:string|null}>(scope,[...actions],`SELECT c.id,c.action,c.actor_id,c.resource_id,COALESCE(m.reason,u.reason,r.reason,b.reason,f.reason,cl.reason) reason,to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
 FROM shipit.reconciliation_commands c LEFT JOIN shipit.reconciliation_matches m ON m.organization_id=c.organization_id AND m.franchise_id=c.franchise_id AND m.command_id=c.id LEFT JOIN shipit.reconciliation_unmatches u ON u.organization_id=c.organization_id AND u.franchise_id=c.franchise_id AND u.command_id=c.id LEFT JOIN shipit.reconciliation_review_revisions r ON r.organization_id=c.organization_id AND r.franchise_id=c.franchise_id AND r.command_id=c.id LEFT JOIN shipit.reconciliation_batches b ON b.organization_id=c.organization_id AND b.franchise_id=c.franchise_id AND b.command_id=c.id LEFT JOIN shipit.reconciliation_config_versions f ON f.organization_id=c.organization_id AND f.franchise_id=c.franchise_id AND f.command_id=c.id LEFT JOIN shipit.reconciliation_classifications cl ON cl.organization_id=c.organization_id AND cl.franchise_id=c.franchise_id AND cl.command_id=c.id WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.resource_id=$1 AND ($2::uuid IS NULL OR c.id>$2) ORDER BY c.id LIMIT $3`,[id,cursor,limit])).rows;
}
