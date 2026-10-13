import {randomUUID} from 'node:crypto';
import {settingKeys,type SettingsDto,type SettingsOwner,type SettingsPatch,type SettingsValues,type SettingKey,type SettingResult,type SettingsHistoryDto} from '@shippingco/shared';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {settingsActions,type SettingsAccess} from './types.ts';
import {HttpError,SettingsVersionConflict} from '../../plugins/errors.ts';
import {instant} from '../pricing/types.ts';
export interface Version {id:string;version:number;franchise_id:string|null;payload:SettingsPatch;source_versions:Partial<Record<SettingKey,number>>;effective_at:Date;recorded_at:Date;actor_id:string;reason:string;changes:SettingsPatch}
const financialKeys:readonly SettingKey[]=['receiving_account','approval_policy','agent_fee_policy'];
export function editable(key:SettingKey,owner:SettingsOwner,canUpdate:boolean){return canUpdate&&(owner==='franchise'||!financialKeys.includes(key));}
export const consumer:Record<SettingKey,SettingResult['consumer']>={identity:'display_preference',language:'configuration_only',operating_hours:'configuration_only',booking_defaults:'booking_suggestion',collection_calendar:'lifecycle_unavailable',receiving_account:'domain_reference',approval_policy:'domain_reference',agent_fee_policy:'domain_reference',close_cutoff:'configuration_only',credit_policy:'owner_unavailable',overdue_policy:'owner_unavailable',billing_terms:'owner_unavailable',report_scope:'report_selection',reporting_schedule:'schedule_unavailable'};
export async function latest(scope:TenantAccess,franchiseId:string|null){
 return (await scopedQuery<Version>(scope,[...settingsActions],`SELECT * FROM shipit.settings_versions WHERE {{organization:organization_id}} AND franchise_id IS NOT DISTINCT FROM $1::uuid ORDER BY version DESC LIMIT 1`,[franchiseId])).rows[0]??null;
}
/** Reference validation is intentionally read-only. No generic setting can manufacture domain policy. */
export async function referenceAvailable(context:SettingsAccess,key:SettingKey,value:SettingsValues[SettingKey]){
 const s=context.access,c=assertTenantAccess(s,[...settingsActions]);
 if(key==='receiving_account'){
  const v=value as SettingsValues['receiving_account'];
  return !!(await scopedQuery(s,[...settingsActions],`SELECT r.id FROM shipit.receiving_account_revisions r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.account_id=$1 AND r.id=$2 AND r.active AND $3=ANY(r.methods) AND NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.account_id=r.account_id AND n.version>r.version)`,[v.account_id,v.revision_id,v.method])).rows.length;
 }
 if(key==='approval_policy'){
  const v=value as SettingsValues['approval_policy'];
  return !!(await scopedQuery(s,[...settingsActions],`SELECT r.id FROM shipit.financial_policy_revisions r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1 AND r.enabled AND NOT r.allow_self_approval AND r.discount_review_threshold_paise IS NULL AND NOT EXISTS(SELECT 1 FROM shipit.financial_policy_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.version>r.version)`,[v.revision_id])).rows.length;
 }
 if(key==='agent_fee_policy'){
  const v=value as SettingsValues['agent_fee_policy'];
  return !!(await scopedQuery(s,[...settingsActions],`SELECT r.id FROM shipit.agent_fee_term_revisions r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.agent_id=$1 AND r.id=$2 AND r.active AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.agent_id=r.agent_id AND n.version>r.version) AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=r.organization_id AND f.franchise_id=r.franchise_id AND m.user_id=r.agent_id AND m.role='delivery_agent' AND m.lifecycle='active')`,[v.agent_id,v.revision_id])).rows.length;
 }
 if(key==='report_scope'||key==='reporting_schedule'){
  const ids=(value as SettingsValues['report_scope']).franchise_ids;
  return ids.every(id=>context.reportFranchiseIds.includes(id))&&(c.organizationWide||ids.includes(c.permittedFranchiseIds[0]!));
 }
 return true;
}
export async function resolve(context:SettingsAccess,owner:SettingsOwner):Promise<SettingsDto>{
 const s=context.access,c=assertTenantAccess(s,[...settingsActions]),franchise=owner==='franchise'?c.permittedFranchiseIds[0]!:null;
 const org=await latest(s,null),local=franchise===null?null:await latest(s,franchise),head=owner==='organization'?org:local;
 const sourceIds=[...new Set([...Object.values(org?.source_versions??{}),...Object.values(local?.source_versions??{})])];
 const sources=sourceIds.length?(await scopedQuery<Version>(s,[...settingsActions],`SELECT id,version,franchise_id,effective_at,recorded_at FROM shipit.settings_versions WHERE {{organization:organization_id}} AND (franchise_id IS NULL OR franchise_id=$1::uuid) AND version=ANY($2::integer[])`,[franchise,sourceIds])).rows:[];
 const values={} as SettingsDto['values'];
 for(const key of settingKeys){
  const localValue=local?.payload[key],orgValue=org?.payload[key],selected=financialKeys.includes(key)&&!context.canReadFinance?null:localValue??orgValue??null,origin=localValue!=null?local:org;
  const source=selected!==null?sources.find(v=>v.franchise_id===(origin?.franchise_id??null)&&v.version===origin?.source_versions[key]):null;
  const referenceOk=selected===null||await referenceAvailable(context,key,selected);
  const unavailable=selected!==null&&(!referenceOk||['lifecycle_unavailable','owner_unavailable','schedule_unavailable'].includes(consumer[key]));
  const inaccessible=selected!==null&&(key==='report_scope'||key==='reporting_schedule')&&!referenceOk;
  Object.assign(values,{[key]:{key,value:inaccessible?null:selected,state:selected===null?'unconfigured':owner==='organization'?'configured':localValue!=null?'overridden':'inherited',source:source?{version_id:source.id,version:source.version,owner:source.franchise_id===null?'organization':'franchise',effective_at:instant(source.effective_at),recorded_at:instant(source.recorded_at)}:null,editable:editable(key,owner,context.canUpdate),consumer:consumer[key],availability:selected===null?'unconfigured':unavailable?'unavailable':'available'}});
 }
 return {schema_version:1,owner,organization_id:c.organizationId!,franchise_id:franchise,version:head?.version??0,version_id:head?.id??null,effective_at:head?instant(head.effective_at):null,organization_version:org?.version??0,can_update:context.canUpdate,values};
}
export async function append(context:SettingsAccess,franchiseId:string|null,changes:SettingsPatch,reason:string,expected:number){
 const s=context.access,c=assertTenantAccess(s,[...settingsActions]),previous=await latest(s,franchiseId);
 if((previous?.version??0)!==expected)throw new SettingsVersionConflict(previous?.version??0);
 const payload={...previous?.payload},sources={...previous?.source_versions};
 for(const key of Object.keys(changes) as SettingKey[]){if(changes[key]===null){delete payload[key];delete sources[key];}else{Object.assign(payload,{[key]:changes[key]});sources[key]=expected+1;}}
 return (await scopedQuery<Version>(s,['settings.organization.update','settings.franchise.update'],`INSERT INTO shipit.settings_versions(id,organization_id,franchise_id,version,actor_id,reason,correlation_id,payload,changes,source_versions) SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{organization:$10}} RETURNING *`,[randomUUID(),franchiseId,expected+1,c.actor.id,reason,c.correlationId,JSON.stringify(payload),JSON.stringify(changes),JSON.stringify(sources),c.organizationId])).rows[0]!;
}
export async function history(context:SettingsAccess,franchiseId:string|null,before:number|null):Promise<SettingsHistoryDto>{
 if(!context.canReadHistory)throw new HttpError('ACTION_FORBIDDEN');
 const rows=(await scopedQuery<Version>(context.access,[...settingsActions],`SELECT id,version,effective_at,recorded_at,actor_id,reason,changes FROM shipit.settings_versions WHERE {{organization:organization_id}} AND franchise_id IS NOT DISTINCT FROM $1::uuid AND ($2::integer IS NULL OR version<$2) ORDER BY version DESC LIMIT 51`,[franchiseId,before])).rows;
 return {items:rows.slice(0,50).map(r=>({id:r.id,version:r.version,effective_at:instant(r.effective_at),recorded_at:instant(r.recorded_at),actor_id:r.actor_id,reason:r.reason,changed_keys:Object.keys(r.changes) as SettingKey[]})),next_before:rows.length>50?rows[49]!.version:null};
}
