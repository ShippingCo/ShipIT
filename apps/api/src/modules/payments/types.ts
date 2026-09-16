import type { TenantAccess } from '../security/scope.ts';
export type { PaymentCollectionInput, PaymentReversalInput, PaymentProjection, PaymentEntryDto, PaymentResult } from '@shippingco/shared';
export type PaymentOperation = 'payments.collect' | 'payments.reverse';
export type PaymentAction = PaymentOperation | 'payments.read' | 'payments.audit' | 'payments.events';
export interface PaymentScopes { command: TenantAccess; audit: TenantAccess|null; events: TenantAccess|null }
export interface ObligationRow { id:string; booking_id:string; total_paise:string }
export interface LedgerRow {
  id:string; booking_id:string; obligation_id:string; kind:'collection'|'reversal'; amount_paise:string;
  currency:'INR'; context:'paid_counter'|'to_pay'; method:'cash'|'upi'; collection_reference:string|null;
  reversal_of:string|null; reason_code:'duplicate_recording'|'incorrect_amount'|'collection_not_received'|null;
  sequence:number; command_id:string; occurred_at:Date;
}
