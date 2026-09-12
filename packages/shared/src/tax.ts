import type { PricingQuoteInput, PricingService } from './index.ts';

export type TaxJurisdiction = 'intra' | 'inter';
export type TaxRegistration = 'registered' | 'unregistered';
export type TaxComponentKind = 'CGST' | 'SGST' | 'IGST';
export interface TaxComponent { id: string; kind: TaxComponentKind; numerator: number; denominator: number }
export interface TaxRule {
  id: string; service: PricingService; registration: TaxRegistration; jurisdiction: TaxJurisdiction;
  classification: string; treatment: 'taxable' | 'nil_rated' | 'exempt'; evidence_ref: string;
  taxable_lines: ('freight' | 'packing')[]; components: TaxComponent[];
}
export interface TaxPolicyInput {
  effective_from: string; effective_to: string; validity_seconds: number;
  supplier_state: string; supplier_gstin: string; approval_ref: string; source_ref: string;
  time_rule: 'contemporaneous_v1'; rules: TaxRule[];
}
/** Published finance projection excludes the supplier identifier. */
export interface TaxPolicyDto extends Omit<TaxPolicyInput, 'supplier_gstin'> {
  id: string; version_number: number; version: number; state: 'draft' | 'published';
}
export interface TaxFacts {
  service_recipient_ref: string; registration: TaxRegistration | 'unknown';
  recipient_state: string | null; recipient_gstin: string | null; handover_state: string | null;
  evidence_ref: string | null; special_case: 'none' | 'unsupported';
}
export interface TaxIntentInput { quote_id: string; pricing_input: PricingQuoteInput; facts: TaxFacts }
export interface TaxIntentDto {
  id: string; quote_id: string; fingerprint: string; created_at: string; expires_at: string;
  jurisdiction_status: 'known' | 'resolution_required';
}
export interface TaxResolutionInput { intent_id: string; policy_id: string; facts: TaxFacts; evidence_ref: string }
export interface TaxResolutionDto {
  id: string; intent_id: string; policy_id: string; evidence_ref: string; created_at: string; expires_at: string;
}
export interface TaxCalculationInput { intent_id: string; resolution_id?: string }
export interface TaxCalculationDto {
  id: string; proposal: true; intent_id: string; quote_id: string; policy_id: string; policy_version: number;
  rule_id: string; resolution_id: string | null; supplier_state: string; place_of_supply: string;
  jurisdiction: TaxJurisdiction; registration: TaxRegistration; classification: string; treatment: TaxRule['treatment'];
  pre_tax_paise: number; taxable_basis_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
  tax_total_paise: number; unrounded_payable_paise: number; rounding_adjustment_paise: number; final_payable_paise: number;
  components: (TaxComponent & { exact_numerator: string; exact_denominator: string; amount_paise: number })[];
  approval_ref: string; source_ref: string; rule_evidence_ref: string; allocation: 'largest_remainder_v1';
  time_rule: 'contemporaneous_v1'; proposed_tax_point_at: string; created_at: string; expires_at: string; fingerprint: string;
}
