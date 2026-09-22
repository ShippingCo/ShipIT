export const routeDelayBatchSize=20;
export const routeDelayReminderCooldownMinutes=60;
export interface DelayFanoutRow {
  id:string;source_identity_id:string;source_kind:'route_delay'|'reminder';original_event_id:string;reminder_event_id:string|null;
  route_id:string;manifest_id:string;manifest_version:number;route_version:number;policy_id:string;policy_version:number;
  purpose:'route_delay'|'route_delay_reminder';correlation_id:string;state:'pending'|'running'|'completed'|'failed';
  cursor_parcel_id:string|null;total_count:number;completed_count:number;skipped_count:number;failed_count:number;attempt_count:number;
  reason_code:string|null;source_suppression_reason:'historical_cutover'|'stale_aggregate_event'|null;created_at:Date;started_at:Date|null;completed_at:Date|null;
}
export interface DelayFanoutCandidate {
  parcel_id:string;booking_id:string;source_outcome:'updated'|'skipped';source_skip_reason:string|null;
  status:string;booking_state:string;customer_id:string|null;contact_current:boolean;
  execution_state:string;eta_event_id:string|null;latest_delay_event_id:string|null;docket:string;effective_at:Date|null;revised_eta_at:Date|null;
}
export type DelayFanoutOutcome='queued'|'skipped'|'suppressed'|'blocked';
