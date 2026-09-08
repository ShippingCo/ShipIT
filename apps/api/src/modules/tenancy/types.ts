export type Lifecycle = 'active' | 'disabled';
export type TenancyAction = 'organization.bootstrap' | 'franchise.create' |
  'organization.profile.update' | 'organization.lifecycle.manage' |
  'organization.profile.read' | 'franchise.profile.read' | 'franchise.profile.list' |
  'franchise.profile.update' | 'franchise.lifecycle.manage';

// Only a trusted server adapter may produce this approval. It is never a request DTO.
// #13/#14 supply current identity, membership, action and projection checks.
export interface ApprovedTenancyContext {
  readonly action: TenancyAction;
  readonly actor: { readonly type: 'user' | 'service'; readonly id: string };
  readonly organizationId: string | null;
  readonly permittedFranchiseIds: readonly string[];
  readonly correlationId: string;
}
export interface TenancyAuthorizer {
  authorize(action: TenancyAction): Promise<ApprovedTenancyContext>;
}
export interface Organization {
  id: string; displayName: string; lifecycle: Lifecycle; version: number;
  createdAt: Date; updatedAt: Date; lifecycleChangedAt: Date;
}
export interface Franchise extends Organization { organizationId: string; franchiseCode: string }
export interface OrganizationDto {
  id: string; display_name: string; lifecycle: Lifecycle; version: number;
  created_at: string; updated_at: string; lifecycle_changed_at: string;
}
export interface FranchiseDto extends OrganizationDto { organization_id: string; franchise_code: string }
export function utcInstant(value: Date): string {
  return value.toISOString().replace(/\.000Z$/, 'Z').replace(/(\.\d*?[1-9])0+Z$/, '$1Z');
}
export function organizationDto(value: Organization): OrganizationDto {
  return { id: value.id, display_name: value.displayName, lifecycle: value.lifecycle,
    version: value.version, created_at: utcInstant(value.createdAt),
    updated_at: utcInstant(value.updatedAt), lifecycle_changed_at: utcInstant(value.lifecycleChangedAt) };
}
export function franchiseDto(value: Franchise): FranchiseDto {
  return { ...organizationDto(value), organization_id: value.organizationId, franchise_code: value.franchiseCode };
}
export interface FranchiseScope { organizationId: string; franchiseId: string }
export interface ListBoundary { created_at: string; id: string }
export interface FranchiseListInput { limit: number; after?: ListBoundary }
export interface TenancyAuditFact {
  actor: { type: 'user' | 'service'; id: string };
  action: TenancyAction;
  organization_id: string;
  franchise_id: string | null;
  previous_lifecycle: Lifecycle | null;
  new_lifecycle: Lifecycle;
  expected_version: number | null;
  committed_version: number;
  correlation_id: string;
  reason_code: 'bootstrap' | 'franchise_creation' | 'profile_correction' | 'administrative_disable' | 'administrative_reactivate';
  occurred_at: string;
}
// Post-commit notification only. #16 must replace this with transactional durable audit
// before private production administration is activated; it is not an event outbox.
export interface TenancyAuditPort { record(fact: Readonly<TenancyAuditFact>): Promise<void> }
