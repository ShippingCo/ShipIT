export type EffectivenessSection='messaging'|'assistant'|'queue';
export interface EffectivenessCell {
  section:EffectivenessSection;category:string;count:number|null;suppressed:boolean;
  denominator:number|null;denominator_kind:'logical_intents'|'measured_turns'|'case_events'|'active_cases'|'unknown';
  excluded:number|null;latency_ms:number|null;business_minutes:number|null;age_suppressed:boolean;
}
export interface EffectivenessFilter {week:string}
export interface EffectivenessSnapshot {
  id:string;schema_version:1;definition:'messaging_effectiveness_v1';organization_id:string;franchise_id:string;
  filter:EffectivenessFilter;count:number;timezone:'UTC';as_of:string;expires_at:string;minimum_subjects:5;
  freshness:{state:'captured';captured_at:string};
  staffing:{state:'configured'|'unavailable';timezone:string|null;weekdays:number[];start_minute:number|null;end_minute:number|null;policy:'captured_current_schedule'};
}
export interface EffectivenessPage {snapshot:EffectivenessSnapshot;items:EffectivenessCell[];selection:{section:EffectivenessSection|null;category:string|null}}
