import type {FinancialAuditDecision,FinancialAuditDocument} from './financial-audit.ts';
import type {ReceiptMethod} from './money-receipt.ts';
export const financialChangeKinds=['discount','cancellation','correction','refund','refund_correction'] as const;
export const financialChangeReasons=['customer_agreement','service_recovery','booking_cancelled','incorrect_charge','customer_refund','incorrect_refund_recording'] as const;
export type FinancialChangeKind=typeof financialChangeKinds[number];
export type FinancialChangeReason=typeof financialChangeReasons[number];
export const financialComponentKeys=['pre_tax','taxable','cgst','sgst','igst','rounding'] as const;
export type FinancialComponentsDto=Record<typeof financialComponentKeys[number],string>;
export interface FinancialPositionDto {gross:string;held:string;outstanding:string;refundable_credit:string}
export interface FinancialDocumentInput {kind:'issued_receipt'|'external_invoice'|'external_credit_note';receipt_id?:string|null;external_ref?:string|null}
export interface FinancialProposalInput extends Record<typeof financialComponentKeys[number],number> {
 booking_id:string;expected_version:number;payment_version:number;kind:FinancialChangeKind;reason:FinancialChangeReason;refund:number;
 refund_correction_of:string|null;document_links:FinancialDocumentInput[];
}
export interface FinancialProposalContext {booking_id:string;expected_version:number;payment_version:number;components:FinancialComponentsDto;position:FinancialPositionDto;refund_targets:{id:string;original_paise:string;remaining_paise:string}[]}
export interface FinancialRequestDto extends Omit<FinancialProposalInput,typeof financialComponentKeys[number]|'refund'|'document_links'>,FinancialComponentsDto {
 id:string;actor_id:string;recorded_at:string;policy_id:string|null;supersedes_id:string|null;refund:string;
 version:number;outcome:'pending'|'approved'|'rejected'|'applied'|'superseded';
}
export interface FinancialOwnRequest {request:FinancialRequestDto;document_links:FinancialAuditDocument[]}
export interface FinancialRequestDetail extends FinancialOwnRequest {
 decisions:FinancialAuditDecision[];source:{booking_id:string;financial_version:number;payment_version:number;components:FinancialComponentsDto&{gross:string;collections:string;refunds:string}};
 before:FinancialPositionDto;proposed:FinancialPositionDto;
}
export interface FinancialRefundEvidenceInput {account_id:string;expected_account_version:number;method:ReceiptMethod;occurred_at:string;returned_to_ref:string;transfer_ref:string;cash_location_id?:string|null;cash_location_revision_id?:string|null}
export interface FinancialApplyInput {expected_version:1;refund_evidence?:FinancialRefundEvidenceInput}

export interface FinancialPolicyDto {id:string;version:number;discount_review_threshold_paise:string|null;allow_self_approval:boolean;enabled:boolean}
export interface FinancialPolicyInput {expected_version:number;enabled:boolean;discount_review_threshold_paise:null;allow_self_approval:false}
