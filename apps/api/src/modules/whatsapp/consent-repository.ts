import { scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { Installation, RegisteredTemplate } from './types.ts';

export async function lockInstallation(scope:TenantAccess,dispatch=false) {
  await scopedQuery(scope,['whatsapp.consent.read','outbox.work'],`SELECT id FROM shipit.organizations o WHERE {{organization:o.id}} FOR SHARE`);
  await scopedQuery(scope,['whatsapp.consent.read','outbox.work'],`SELECT id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} FOR SHARE`);
  // Dispatch conflicts with ingress's SHARE lock as well as the consent consumer.
  // Acquire UPDATE directly: upgrading two concurrent SHARE locks would deadlock.
  if(dispatch)return (await scopedQuery<Installation & {owner_active:boolean}>(scope,['outbox.work'],
    `SELECT i.*,f.lifecycle='active' AND o.lifecycle='active' AS owner_active FROM shipit.whatsapp_installations i
     JOIN shipit.franchises f ON f.organization_id=i.organization_id AND f.id=i.franchise_id JOIN shipit.organizations o ON o.id=i.organization_id
     WHERE {{franchise:i.organization_id:i.franchise_id}} AND {{franchise:f.organization_id:f.id}} AND {{organization:o.id}} FOR UPDATE OF i`)).rows[0];
  return (await scopedQuery<Installation & {owner_active:boolean}>(scope,['whatsapp.consent.read','outbox.work'],
    `SELECT i.*,f.lifecycle='active' AND o.lifecycle='active' AS owner_active FROM shipit.whatsapp_installations i
     JOIN shipit.franchises f ON f.organization_id=i.organization_id AND f.id=i.franchise_id JOIN shipit.organizations o ON o.id=i.organization_id
     WHERE {{franchise:i.organization_id:i.franchise_id}} AND {{franchise:f.organization_id:f.id}} AND {{organization:o.id}} FOR SHARE OF i`)).rows[0];
}
export async function lockCustomer(scope:TenantAccess,id:string) {
  return (await scopedQuery<{id:string;phone_normalized:string;contact_version:string}>(scope,['whatsapp.consent.read','outbox.work'],
    `SELECT c.id,c.phone_normalized,c.contact_version FROM shipit.customers c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 FOR SHARE`,[id])).rows[0];
}
export async function contactMatches(scope:TenantAccess,phone:string) {
  return (await scopedQuery<{count:number}>(scope,['whatsapp.consent.read','outbox.work'],
    `SELECT count(*)::integer AS count FROM shipit.customers c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.phone_normalized=$1`,[phone])).rows[0]!.count;
}
export async function state(scope:TenantAccess,installation:string,contact:string) {
  return (await scopedQuery<{state:'unknown'|'granted'|'revoked';customer_id:string|null;contact_version:string|null;last_inbound_at:Date}>(scope,
    ['whatsapp.consent.read','outbox.work'],`SELECT s.state,s.customer_id,s.contact_version,s.last_inbound_at FROM shipit.whatsapp_consent_state s
     WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.installation_id=$1 AND s.contact_key=$2`,[installation,contact])).rows[0];
}
export async function pending(scope:TenantAccess,installation:string) {
  return (await scopedQuery<{pending:boolean}>(scope,['whatsapp.consent.read','outbox.work'],
    `SELECT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox j WHERE {{franchise:j.organization_id:j.franchise_id}}
     AND j.installation_id=$1 AND j.event_key LIKE 'inbound:%' AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_consent_receipts r
       WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.inbox_id=j.id AND r.outcome NOT IN ('key_unavailable','owner_disabled','source_invalid'))) AS pending`,[installation])).rows[0]!.pending;
}
export async function requestedContext(scope:TenantAccess,id:string,installation:string,contact:string,customer:string,version:string,now:Date) {
  return (await scopedQuery(scope,['whatsapp.consent.read','outbox.work'],
    `SELECT r.inbox_id FROM shipit.whatsapp_consent_receipts r WHERE {{franchise:r.organization_id:r.franchise_id}}
     AND r.inbox_id=$1 AND r.installation_id=$2 AND r.contact_key=$3 AND r.customer_id=$4 AND r.contact_version=$5
     AND r.intent='other' AND r.outcome='unchanged' AND r.occurred_at>$6::timestamptz-interval '24 hours' AND r.occurred_at<=$6`,
    [id,installation,contact,customer,version,now])).rows.length===1;
}
export async function template(scope:TenantAccess,installation:string,name:string|undefined,language:string|undefined) {
  return (await scopedQuery<RegisteredTemplate>(scope,['whatsapp.consent.read','outbox.work'],
    `SELECT t.* FROM shipit.whatsapp_templates t WHERE {{franchise:t.organization_id:t.franchise_id}}
     AND t.installation_id=$1 AND t.name=$2 AND t.language=$3 ORDER BY t.version DESC LIMIT 1`,[installation,name,language])).rows[0]??null;
}
export async function history(scope:TenantAccess,customer:string) {
  return (await scopedQuery(scope,['whatsapp.consent.read'],
    `SELECT inbox_id AS evidence_id,intent,outcome,source,purpose,channel,policy_version,occurred_at,recorded_at
     FROM shipit.whatsapp_consent_receipts r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.customer_id=$1
     ORDER BY recorded_at DESC,inbox_id DESC LIMIT 101`,[customer])).rows;
}
