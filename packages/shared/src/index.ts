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
