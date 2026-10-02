import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { QuotePolicy,QuoteDraft,QuoteInput } from './rules.ts';

export interface Policy {id:string;version:number;configuration:QuotePolicy}
export interface Estimate {id:string;policy_id:string|null;rate_version_id:string|null;rule_id:string|null;input:QuoteInput;reason:string|null;
 freight_paise:string|null;packing_paise:string|null;total_paise:string|null;created_at:Date;expires_at:Date;refreshed_from:string|null}
export async function policy(scope:TenantAccess) {
 return (await scopedQuery<Policy>(scope,['pricing.draft','whatsapp.inbox.work','outbox.work'],`SELECT p.id,p.version,p.configuration FROM shipit.customer_quote_policies p
  WHERE {{franchise:p.organization_id:p.franchise_id}} ORDER BY p.version DESC LIMIT 1`,[])).rows[0];
}
export async function saveDraft(scope:TenantAccess,conversation:string,draft:QuoteDraft|null) {
 await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.customer_conversations c SET quote_draft=$2
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1`,[conversation,draft]);
}
export async function limited(scope:TenantAccess,installation:string,contact:string,now:Date) {
 return (await scopedQuery<{n:number}>(scope,['whatsapp.inbox.work'],`SELECT count(*)::integer AS n FROM (
  SELECT 1 FROM shipit.customer_conversation_turns t WHERE {{franchise:t.organization_id:t.franchise_id}} AND t.installation_id=$1
   AND t.contact_key=$2 AND t.intent='quote' AND t.recorded_at>$3::timestamptz-interval '1 hour' LIMIT 60) recent`,[installation,contact,now])).rows[0]!.n>=60;
}
export async function read(scope:TenantAccess,id:string,installation:string,contact:string) {
 return (await scopedQuery<Estimate>(scope,['whatsapp.inbox.work','outbox.work'],`SELECT q.* FROM shipit.customer_quotes q
  WHERE {{franchise:q.organization_id:q.franchise_id}} AND q.id=$1 AND q.installation_id=$2 AND q.contact_key=$3`,[id,installation,contact])).rows[0];
}
export async function save(scope:TenantAccess,inbox:string,installation:string,contact:string,value:Estimate) {
 const c=scope.context;
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.customer_quotes
  (id,organization_id,franchise_id,inbox_id,installation_id,contact_key,policy_id,rate_version_id,rule_id,input,reason,freight_paise,packing_paise,total_paise,created_at,expires_at,refreshed_from,correlation_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17 WHERE {{franchise:$18:$2}}`,
 [value.id,c.permittedFranchiseIds[0],inbox,installation,contact,value.policy_id,value.rate_version_id,value.rule_id,value.input,value.reason,value.freight_paise,
 value.packing_paise,value.total_paise,value.created_at,value.expires_at,value.refreshed_from,c.correlationId,c.organizationId]);
}
