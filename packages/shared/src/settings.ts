/** #66 explicit configuration. Null clears a value; absence leaves that key unchanged. */
export const settingKeys = ['identity','language','operating_hours','booking_defaults','collection_calendar','receiving_account','approval_policy','agent_fee_policy','close_cutoff','credit_policy','overdue_policy','billing_terms','report_scope','reporting_schedule'] as const;
export type SettingKey = typeof settingKeys[number];
export type SettingsOwner = 'organization'|'franchise';
export interface SettingsValues {
 identity: {display_name:string;shop?:ShopPresentation};
 language: {locale:'en'|'hi'};
 operating_hours: {timezone:string;days:{weekday:number;opens_minute:number;closes_minute:number}[]};
 booking_defaults: {service:'standard'|'express'|'same_city'};
 collection_calendar: {timezone:'Asia/Kolkata';weekdays:number[];holidays:string[]};
 receiving_account: {account_id:string;revision_id:string;method:'cash'|'upi'|'bank_transfer'|'card'|'other'};
 approval_policy: {revision_id:string};
 agent_fee_policy: {agent_id:string;revision_id:string};
 close_cutoff: {timezone:string;minute:number};
 /** #141 has no approved producer. Only explicit unconfigured intent is currently accepted. */
 credit_policy: {state:'unconfigured';owner:'account_terms_v1'};
 overdue_policy: {state:'unconfigured';owner:'account_terms_v1'};
 billing_terms: {state:'unconfigured';owner:'account_terms_v1'};
 report_scope: {franchise_ids:string[]};
 reporting_schedule: {report:'sales'|'contribution';franchise_ids:string[];timezone:string;weekday:number;minute:number};
}
export type SettingsPatch = {[K in SettingKey]?:SettingsValues[K]|null};
export interface SettingsUpdateInput {expected_version:number;changes:SettingsPatch;reason:string}
export interface SettingsProvenance {version_id:string;version:number;owner:SettingsOwner;effective_at:string;recorded_at:string}
export type SettingResult<K extends SettingKey=SettingKey> = {
 key:K;value:SettingsValues[K]|null;state:'configured'|'inherited'|'overridden'|'unconfigured';
 source:SettingsProvenance|null;editable:boolean;
 consumer:'display_preference'|'booking_suggestion'|'report_selection'|'configuration_only'|'lifecycle_unavailable'|'domain_reference'|'owner_unavailable'|'schedule_unavailable';
 availability:'available'|'unconfigured'|'unavailable';
};
export interface SettingsDto {
 schema_version:1;owner:SettingsOwner;organization_id:string;franchise_id:string|null;version:number;version_id:string|null;
 effective_at:string|null;organization_version:number;can_update:boolean;values:{[K in SettingKey]:SettingResult<K>};
}
export interface SettingsHistoryDto {items:{id:string;version:number;effective_at:string;recorded_at:string;actor_id:string;reason:string;changed_keys:SettingKey[]}[];next_before:number|null}
export interface ReportScopeOptions {organization_id:string;active_franchise_id:string;items:{id:string;name:string;can_export:boolean}[];next_cursor:string|null;maximum_selection:50}

/** Keep accepted spelling stable for immutable intents; PostgreSQL catalog support is checked by the API. */
export function parseSettingsTimezone(value:unknown):string|null {
 if(typeof value!=='string'||value.length>64||[...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return null;
 const zone=value.trim();
 if(!zone||(!zone.includes('/')&&zone.toUpperCase()!=='UTC'))return null;
 try {new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{return null;}
 return zone;
}

/** Display and branding preferences; never a replacement for issued tax or receipt evidence. */
export interface ShopPresentation {tagline:string;origin_city:string;support_phone:string;address:string;assistant_name:string;logo:string|null}
export function parseShopPresentation(value:unknown):ShopPresentation|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as Record<string,unknown>,limits={tagline:160,origin_city:120,support_phone:40,address:500,assistant_name:120};
 if(Object.keys(v).some(k=>!Object.hasOwn(limits,k)&&k!=='logo'))return null;
 for(const [k,max] of Object.entries(limits))if(typeof v[k]!=='string'||(v[k] as string).length>max||Array.from(v[k] as string).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return null;
 if(typeof v.support_phone==='string'&&v.support_phone&&!/^\+?[0-9 ()-]{7,40}$/.test(v.support_phone))return null;
 if(v.logo!==null&&(typeof v.logo!=='string'||v.logo.length>30000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(v.logo)))return null;
 return v as unknown as ShopPresentation;
}
