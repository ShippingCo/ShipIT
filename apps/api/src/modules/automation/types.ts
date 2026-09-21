export interface ResolvedNotification {
  affected_type:'booking'|'parcel';affected_entity_id:string;booking_id:string;parcel_id:string|null;customer_id:string|null;
  contact_current:boolean;relevant:boolean;reason_code:string;canonical_event_id:string;values:Readonly<Record<string,string>>;
}
export type DecisionOutcome='queued'|'blocked'|'suppressed'|'skipped';
