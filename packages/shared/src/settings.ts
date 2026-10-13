/** #66 explicit configuration. Null clears a value; absence leaves that key unchanged. */
export const settingKeys = ['identity','language','operating_hours','booking_defaults','collection_calendar','receiving_account','approval_policy','agent_fee_policy','close_cutoff','credit_policy','overdue_policy','billing_terms','report_scope','reporting_schedule'] as const;
export type SettingKey = typeof settingKeys[number];
export type SettingsOwner = 'organization'|'franchise';
export interface SettingsValues {
 identity: {display_name:string};
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
