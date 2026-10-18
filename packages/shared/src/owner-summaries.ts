/** Owner reporting contracts. Money is integer INR paise; no browser-calculated authority. */
export type OwnerSummaryFrequency = 'daily'|'weekly'|'monthly';
export interface OwnerSummaryPeriod {
 frequency:OwnerSummaryFrequency;
 timezone:string;
 from:string;
 to:string;
 label:string;
}

export interface OwnerSummaryTiming {
 frequency:OwnerSummaryFrequency;
 timezone:string;
 minute:number;
 /** ISO weekday (Monday=1). Used only by weekly schedules. */
 weekday:number;
}
export interface OwnerSummaryScheduleInput {
 expected_version:number;
 name:string;
 timing:OwnerSummaryTiming;
 franchise_ids:string[];
 recipient_ids:string[];
 enabled:boolean;
 whatsapp:boolean;
 corrections:boolean;
 alerts:{enabled:boolean;notify:boolean;minimum_paise:string;minimum_overdue_days:number;repeat_hours:number|null};
}
export interface OwnerSummarySchedule extends OwnerSummaryScheduleInput {
 id:string;version:number;actor_id:string;organization_id:string;franchise_id:string;updated_at:string;last_state:'pending'|'completed'|'suppressed'|'failed';last_reason:string|null;last_check:string|null;
}
export interface OwnerSummaryEvidence {
 id:string;franchise_id:string;kind:string;occurred_at:string|null;amount_paise:string|null;state:string;
}
export interface OwnerSummarySnapshot {
 definition:'owner_period_v1';period:OwnerSummaryPeriod;as_of:string;expires_at:string;
 franchise_ids:string[];metrics:import('./daily-dashboard.ts').DailyMetrics;
 expenses_paise:string;overdue_paise:string;unknown_due_count:number;
 agent_held_known_paise:string;unknown_custody_count:number;
 cash_differences_paise:string;reconciliation_exceptions:number;
 reconciliation_state:'available'|'disabled'|'partially_disabled';
 evidence:OwnerSummaryEvidence[];sales_rows:import('./daily-dashboard.ts').DailyRow[];
}
export type OwnerDeliveryState='pending'|'sending'|'sent'|'failed'|'uncertain'|'suppressed';
export interface OwnerSummaryRun {
 id:string;schedule_id:string;schedule_name:string;kind:'summary'|'alert'|'preview';version:number;period:OwnerSummaryPeriod;
 created_at:string;expires_at:string;state:'ready'|'failed';reason:string|null;
 corrected_from:string|null;deliveries:{id:string;recipient_id:string;channel:'in_app'|'whatsapp';state:OwnerDeliveryState;reason:string;attempts:number;updated_at:string}[];
}
export interface OwnerOverdueAlert {
 id:string;schedule_id:string;source_id:string;franchise_id:string;amount_paise:string;
 overdue_days:number;state:'open'|'acknowledged'|'resolved';version:number;updated_at:string;
}
export interface OwnerSummaryWorkspace {
 enabled:boolean;can_configure:boolean;schedules:OwnerSummarySchedule[];runs:OwnerSummaryRun[];
 alerts:OwnerOverdueAlert[];recipients:{id:string}[];
 consent:{enabled:boolean;has_verified_number:boolean;version:number};
}
