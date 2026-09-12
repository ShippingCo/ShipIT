export type * from './tax.ts';
/** Minimal browser-safe onboarding and shell contracts. No authentication secrets or DB rows. */
export type OperatorRole = 'org_admin' | 'franchise_admin' | 'operator' | 'dispatcher' | 'delivery_agent' | 'accountant' | 'read_only';
export interface PermittedFranchise {
  id: string;
  display_name: string;
  organization: { id: string; display_name: string };
  roles: OperatorRole[];
}
export interface OperatorContext {
  user_id: string;
  state: 'ready' | 'onboarding_required' | 'scope_unavailable';
  franchises: PermittedFranchise[];
  active_franchise_id: string | null;
}
export interface OnboardingResult {
  command_id: string;
  organization: { id: string; display_name: string };
  franchise: { id: string; display_name: string };
  role: 'org_admin';
}

/** Validated independent-onboarding input; IDs and roles are server-owned. */
export interface OnboardingRequest {
  display_name: string;
  franchise: { display_name: string; franchise_code: string };
}

/** Counter-workflow values only; ownership and server capabilities are not wire data. */
export interface CustomerCreateRequest { name: string; phone: string; address?: string }
export interface CustomerUpdateRequest { name: string; phone: string; address: string; expected_version: number }
export interface CustomerDto {
  id: string; name: string; phone: string; phone_display: string; address: string;
  version: number; created_at: string; updated_at: string;
}
export interface CustomerListDto {
  items: CustomerDto[];
  page: { next_cursor: string | null; has_more: boolean };
}
export interface CustomerSnapshot {
  readonly source_customer_id: string;
  readonly source_customer_version: number;
  readonly name: string;
  readonly phone: string;
  readonly phone_display: string;
  readonly address: string;
}
/** #22 persists these copied values in its own authorized booking transaction. */
export function customerSnapshot(customer: CustomerDto): CustomerSnapshot {
  return Object.freeze({ source_customer_id: customer.id, source_customer_version: customer.version,
    name: customer.name, phone: customer.phone, phone_display: customer.phone_display, address: customer.address });
}

// Pricing-only public inputs: no parcel measurement, tax or booking authority implied.
export type PricingService = 'standard' | 'express' | 'same_city';
export type PricingOverrideReason = 'customer_agreement' | 'service_recovery' | 'commercial_exception';
export interface PricingRuleInput {
  destination_key:string; service:PricingService; min_weight_grams:number; max_weight_grams:number|null;
  freight_paise:number; packing_paise:number;
}
export interface PricingDraftInput {
  effective_from:string; effective_to:string; quote_validity_seconds:number; override_tolerance_paise:number;
  approval_ref:string; source_ref:string; rules:PricingRuleInput[];
}
export interface PricingVersionDto extends PricingDraftInput {
  id:string; card_id:string; version_number:number; version:number; state:'draft'|'published';
  created_at:string; published_at:string|null; published_by:string|null;
  rules:(PricingRuleInput & {id:string})[];
}
export interface PricingQuoteInput {
  destination_key:string; service:PricingService; weight_grams:number;
  override?:{freight_paise:number;reason_code:PricingOverrideReason};
}
export interface PricingQuoteDto {
  id:string; proposal:true; card_id:string; rate_version_id:string; rate_version_number:number; rule_id:string;
  policy:{effective_from:string;effective_to:string;quote_validity_seconds:number;override_tolerance_paise:number;approval_ref:string;source_ref:string};
  inputs:PricingQuoteInput; freight_suggestion_paise:number; packing_paise:number; freight_paise:number;
  variance_paise:number; override_status:'none'|'within_tolerance'|'privileged'; approval_actor_id:string|null;
  subtotal_paise:number; created_at:string; expires_at:string; fingerprint:string;
  breakdown:{calculation:'flat_paise_v1';min_weight_grams:number;max_weight_grams:number|null;excluded:['tax','final_payable_rounding']};
}
