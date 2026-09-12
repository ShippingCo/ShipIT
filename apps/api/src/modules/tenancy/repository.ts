import { randomUUID } from 'node:crypto';
import { scopedQuery, assertTenantAccess, assertOrganization, assertFranchises, type TenantAccess } from '../security/scope.ts';
import { TenancyError } from './errors.ts';
import type { Organization, Franchise, FranchiseScope, FranchiseListInput, Lifecycle } from './types.ts';

interface OrganizationRow {
  id: string; display_name: string; lifecycle: Lifecycle; version: number;
  created_at: Date; updated_at: Date; lifecycle_changed_at: Date;
}
interface FranchiseRow extends OrganizationRow { organization_id: string; franchise_code: string }
const organizationColumns = 'id, display_name, lifecycle, version, created_at, updated_at, lifecycle_changed_at';
const franchiseColumns = `${organizationColumns}, organization_id, franchise_code`;
function organization(row: OrganizationRow): Organization {
  return { id: row.id, displayName: row.display_name, lifecycle: row.lifecycle, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, lifecycleChangedAt: row.lifecycle_changed_at };
}
function franchise(row: FranchiseRow): Franchise {
  return { ...organization(row), organizationId: row.organization_id, franchiseCode: row.franchise_code };
}
export async function insertOrganization(tx: TenantAccess, displayName: string): Promise<Organization> {
  assertTenantAccess(tx, ['organization.bootstrap']);
  assertTenantAccess(tx);
  const result = await scopedQuery<OrganizationRow>(tx, ['organization.bootstrap'], `INSERT INTO shipit.organizations (id, display_name)
    VALUES ($1, $2) RETURNING ${organizationColumns}`, [randomUUID(), displayName]);
  return organization(result.rows[0]!);
}
export async function insertFranchise(tx: TenantAccess, input: { organizationId: string; displayName: string; franchiseCode: string }): Promise<Franchise> {
  assertTenantAccess(tx, ['organization.bootstrap', 'franchise.create']); assertOrganization(tx, input.organizationId);
  assertTenantAccess(tx);
  const result = await scopedQuery<FranchiseRow>(tx, ['organization.bootstrap', 'franchise.create'], `INSERT INTO shipit.franchises (id, organization_id, display_name, franchise_code)
    SELECT $1, $2, $3, $4 WHERE {{organization:$2}} ON CONFLICT (organization_id, franchise_code) DO NOTHING RETURNING ${franchiseColumns}`,
  [randomUUID(), input.organizationId, input.displayName, input.franchiseCode]);
  // Only the named conflict target becomes this public conflict, never an arbitrary 23505.
  if (!result.rows[0]) throw new TenancyError('FRANCHISE_CODE_CONFLICT');
  return franchise(result.rows[0]);
}
export async function findOrganization(db: TenantAccess, organizationId: string): Promise<Organization | null> {
  assertTenantAccess(db, ['organization.profile.read']); assertOrganization(db, organizationId);
  const result = await scopedQuery<OrganizationRow>(db, ['organization.profile.read'], `SELECT ${organizationColumns} FROM shipit.organizations WHERE {{organization:id}} AND id = $1`, [organizationId]);
  return result.rows[0] ? organization(result.rows[0]) : null;
}
export async function findFranchise(db: TenantAccess, scope: FranchiseScope): Promise<Franchise | null> {
  assertTenantAccess(db, ['franchise.profile.read', 'franchise.profile.list']); assertOrganization(db, scope.organizationId); assertFranchises(db, [scope.franchiseId]);
  const result = await scopedQuery<FranchiseRow>(db, ['franchise.profile.read', 'franchise.profile.list'], `SELECT ${franchiseColumns} FROM shipit.franchises
    WHERE {{franchise:organization_id:id}} AND organization_id = $1 AND id = $2`, [scope.organizationId, scope.franchiseId]);
  return result.rows[0] ? franchise(result.rows[0]) : null;
}
export async function listFranchises(db: TenantAccess, scope: { organizationId: string; permittedFranchiseIds: readonly string[] }, input: FranchiseListInput) {
  assertTenantAccess(db, ['franchise.profile.list']); assertOrganization(db, scope.organizationId);
  const result = await scopedQuery<FranchiseRow>(db, ['franchise.profile.list'], `SELECT ${franchiseColumns} FROM shipit.franchises
    WHERE {{franchise:organization_id:id}} AND organization_id = $1 AND id = ANY($2::uuid[])
      AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
    ORDER BY created_at ASC, id ASC LIMIT $5`,
  [scope.organizationId, scope.permittedFranchiseIds, input.after?.created_at ?? null, input.after?.id ?? null, input.limit + 1]);
  return result.rows.map(franchise);
}
// Shared locks allow concurrent operational writes; UPDATE waits for all prior writers.
// Always lock parent before child to serialize organization disable as well.
export async function lockOrganization(tx: TenantAccess, organizationId: string, exclusive = false): Promise<Organization> {
  assertTenantAccess(tx, ['franchise.create', 'organization.profile.update', 'organization.lifecycle.manage', 'franchise.profile.update', 'franchise.lifecycle.manage', 'customer.create', 'customer.update']); assertOrganization(tx, organizationId);
  assertTenantAccess(tx);
  const result = await scopedQuery<OrganizationRow>(tx, ['franchise.create', 'organization.profile.update', 'organization.lifecycle.manage', 'franchise.profile.update', 'franchise.lifecycle.manage', 'customer.create', 'customer.update'], `SELECT ${organizationColumns} FROM shipit.organizations
    WHERE {{organization:id}} AND id = $1 ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`, [organizationId]);
  if (!result.rows[0]) throw new TenancyError('RESOURCE_NOT_FOUND');
  return organization(result.rows[0]);
}
export async function lockFranchise(tx: TenantAccess, scope: FranchiseScope, exclusive = false): Promise<Franchise> {
  assertTenantAccess(tx, ['franchise.profile.update', 'franchise.lifecycle.manage', 'customer.create', 'customer.update']); assertOrganization(tx, scope.organizationId); assertFranchises(tx, [scope.franchiseId]);
  assertTenantAccess(tx);
  const result = await scopedQuery<FranchiseRow>(tx, ['franchise.profile.update', 'franchise.lifecycle.manage', 'customer.create', 'customer.update'], `SELECT ${franchiseColumns} FROM shipit.franchises
    WHERE {{franchise:organization_id:id}} AND organization_id = $1 AND id = $2 ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`, [scope.organizationId, scope.franchiseId]);
  if (!result.rows[0]) throw new TenancyError('RESOURCE_NOT_FOUND');
  return franchise(result.rows[0]);
}
export async function lockActiveFranchiseForOperationalWrite(tx: TenantAccess, scope: FranchiseScope): Promise<void> {
  const parent = await lockOrganization(tx, scope.organizationId);
  const child = await lockFranchise(tx, scope);
  if (parent.lifecycle !== 'active') throw new TenancyError('ORGANIZATION_DISABLED');
  if (child.lifecycle !== 'active') throw new TenancyError('FRANCHISE_DISABLED');
  // Caller must perform the operational write using this same transaction before commit.
}
export async function updateOrganizationProfile(tx: TenantAccess, organizationId: string, displayName: string, expectedVersion: number): Promise<Organization> {
  assertTenantAccess(tx, ['organization.profile.update']); assertOrganization(tx, organizationId);
  const result = await scopedQuery<OrganizationRow>(tx, ['organization.profile.update'], `UPDATE shipit.organizations
    SET display_name = $2, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
    WHERE {{organization:id}} AND id = $1 AND version = $3 RETURNING ${organizationColumns}`, [organizationId, displayName, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return organization(result.rows[0]);
}
export async function updateFranchiseProfile(tx: TenantAccess, scope: FranchiseScope, displayName: string, expectedVersion: number): Promise<Franchise> {
  assertTenantAccess(tx, ['franchise.profile.update']); assertOrganization(tx, scope.organizationId); assertFranchises(tx, [scope.franchiseId]);
  const result = await scopedQuery<FranchiseRow>(tx, ['franchise.profile.update'], `UPDATE shipit.franchises
    SET display_name = $3, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
    WHERE {{franchise:organization_id:id}} AND organization_id = $1 AND id = $2 AND version = $4 RETURNING ${franchiseColumns}`,
  [scope.organizationId, scope.franchiseId, displayName, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return franchise(result.rows[0]);
}
export async function updateOrganizationLifecycle(tx: TenantAccess, organizationId: string, lifecycle: Lifecycle, expectedVersion: number): Promise<Organization> {
  assertTenantAccess(tx, ['organization.lifecycle.manage']); assertOrganization(tx, organizationId);
  const result = await scopedQuery<OrganizationRow>(tx, ['organization.lifecycle.manage'], `UPDATE shipit.organizations
    SET lifecycle = $2, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()),
      lifecycle_changed_at = date_trunc('milliseconds', clock_timestamp())
    WHERE {{organization:id}} AND id = $1 AND version = $3 RETURNING ${organizationColumns}`, [organizationId, lifecycle, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return organization(result.rows[0]);
}
export async function updateFranchiseLifecycle(tx: TenantAccess, scope: FranchiseScope, lifecycle: Lifecycle, expectedVersion: number): Promise<Franchise> {
  assertTenantAccess(tx, ['franchise.lifecycle.manage']); assertOrganization(tx, scope.organizationId); assertFranchises(tx, [scope.franchiseId]);
  const result = await scopedQuery<FranchiseRow>(tx, ['franchise.lifecycle.manage'], `UPDATE shipit.franchises
    SET lifecycle = $3, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()),
      lifecycle_changed_at = date_trunc('milliseconds', clock_timestamp())
    WHERE {{franchise:organization_id:id}} AND organization_id = $1 AND id = $2 AND version = $4 RETURNING ${franchiseColumns}`,
  [scope.organizationId, scope.franchiseId, lifecycle, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return franchise(result.rows[0]);
}

/** R02 safe shell projection; SQL applies grants and active-root eligibility. */
export async function usableFranchises(scope: TenantAccess) {
  return (await scopedQuery<{ id: string; display_name: string; organization_name: string }>(scope,
    ['franchise.profile.list'], `SELECT f.id,f.display_name,o.display_name AS organization_name
      FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id
      WHERE {{franchise:f.organization_id:f.id}} AND f.lifecycle='active' AND o.lifecycle='active'
      ORDER BY f.created_at,f.id`)).rows;
}
