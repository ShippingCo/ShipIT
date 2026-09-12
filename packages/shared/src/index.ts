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
