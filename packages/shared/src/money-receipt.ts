/** Manually recorded receipt evidence: reconciliation is owned by #140. */
export type ReceiptMethod = 'cash'|'upi'|'card'|'bank_transfer'|'other';
export interface ReceivingAccountInput {
  name:string; methods:ReceiptMethod[]; other_method_name:string|null; active:boolean; expected_version:number;
}
export interface ReceivingAccountDto {
  id:string; revision_id:string; version:number; name:string; methods:ReceiptMethod[];
  other_method_name:string|null; active:boolean; recorded_at:string;
}
export interface ReceiptAllocationInput {
  booking_id:string; amount_paise:number; context:'paid_counter'|'to_pay'; expected_payment_version:number;
}
export interface MoneyReceiptInput {
  customer_id:string; account_id:string; expected_account_version:number; method:ReceiptMethod;
  amount_paise:number; currency:'INR'; receiver_id:string; custodian_id:string;
  occurred_at:string; external_reference:string|null; allocations:ReceiptAllocationInput[];
}
export interface AllocateReceiptInput { expected_version:number; allocations:ReceiptAllocationInput[] }
export interface CorrectAllocationInput {
  expected_version:number; allocation_id:string; amount_paise:number; currency:'INR';
  reason_code:'duplicate_recording'|'incorrect_amount'|'collection_not_received';
}
export interface MoneyReceiptAllocation {
 id:string; booking_id:string; payment_entry_id:string; kind:'allocation'|'release'; amount_paise:number; release_of:string|null;
}
export interface MoneyReceiptResult {
 receipt_id:string; customer_id:string; version:number; currency:'INR'; received_paise:number;
 allocated_paise:number; unallocated_paise:number; allocations:MoneyReceiptAllocation[];
}
export interface MoneyReceiptEvidence {
 id:string; customer_id:string; account_id:string; account_revision_id:string; method:ReceiptMethod; received_paise:number;
 currency:'INR'; receiver_id:string; initial_custodian_id:string; occurred_at:string; recorded_at:string;
 external_reference:string|null; verification:'manually_recorded_unverified';
}
export interface MoneyReceiptDetail { receipt:MoneyReceiptEvidence; balance:MoneyReceiptResult }

export interface MoneyReceiptHistoryEntry extends MoneyReceiptAllocation {
 version:number; recorded_at:string; released_paise:number;
}
