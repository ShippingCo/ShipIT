export const deliveryActions = [
  'deliveries.read','deliveries.list','deliveries.agents','deliveries.start','deliveries.retry',
  'deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request',
  'deliveries.exception.approve','deliveries.events','deliveries.messaging',
  'deliveries.cleanup',
] as const;
export type DeliveryAction = typeof deliveryActions[number];
export type DeliveryOperation = Extract<DeliveryAction,
  'deliveries.start'|'deliveries.retry'|'deliveries.resend'|'deliveries.replace'|'deliveries.complete'|
  'deliveries.exception.request'|'deliveries.exception.approve'>;
export type ChallengeStatus = 'pending'|'active'|'expired'|'locked'|'consumed'|'superseded'|'closed';
export type ExceptionalReason = 'recipient_channel_unavailable'|'provider_unavailable'|'challenge_locked_reviewed';
export type ProofMethod = 'otp_verified'|'exceptional';

export interface DeliveryProofKeys {
  readonly version:string;
  readonly verifier:Buffer;
  readonly encryption:Buffer;
}
export interface DeliveryProofConfiguration {
  readonly keys:DeliveryProofKeys;
  readonly template_name:string;
  readonly template_language:string;
  /** Set only after the exact Meta authentication send shape is qualified in that deployment. */
  readonly meta_send_qualified:boolean;
}
export interface DeliveryAttemptRow {
  id:string;organization_id:string;franchise_id:string;booking_id:string;parcel_id:string;assignment_id:string;
  agent_id:string;recipient_ref:string;recipient_contact_version:string;attempt_number:number;state:'active'|'failed'|'completed';
  failed_verifications:number;resend_count:number;locked_at:Date|null;started_at:Date;closed_at:Date|null;version:number;
  challenge_id:string;challenge_version:number;challenge_status:ChallengeStatus;issued_at:Date;expires_at:Date;
  superseded_at:Date|null;consumed_at:Date|null;encrypted_secret:string|null;key_version:string;
  parcel_version:number;parcel_status:string;parcel_custody:string;assigned_agent_id:string|null;active_attempt_id:string|null;
  docket:string;
}
export interface DeliveryStateDto {
  parcel_id:string;docket:string;parcel_version:number;attempt_id:string;assignment_id:string;attempt_number:number;
  challenge_ref:string;challenge_version:number;status:ChallengeStatus;expires_at:string;resend_available_at:string;
  resends_remaining:number;verification_attempts_remaining:number;send_state:string;send_reason:string;proof_method:ProofMethod|null;
  exception:{request_id:string;state:'pending'|'approved'|'denied'|'invalidated';reason_code:ExceptionalReason;approval_ref:string|null}|null;
}
