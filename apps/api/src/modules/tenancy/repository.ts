import { randomUUID } from 'node:crypto';
import { assertActiveTransaction, type QueryExecutor, type TransactionExecutor } from '@shippingco/db';
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
export async function insertOrganization(tx: TransactionExecutor, displayName: string): Promise<Organization> {
  assertActiveTransaction(tx);
  const result = await tx.query<OrganizationRow>(`INSERT INTO shipit.organizations (id, display_name)
    VALUES ($1, $2) RETURNING ${organizationColumns}`, [randomUUID(), displayName]);
  return organization(result.rows[0]!);
}
export async function insertFranchise(tx: TransactionExecutor, input: { organizationId: string; displayName: string; franchiseCode: string }): Promise<Franchise> {
  assertActiveTransaction(tx);
  const result = await tx.query<FranchiseRow>(`INSERT INTO shipit.franchises (id, organization_id, display_name, franchise_code)
    VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, franchise_code) DO NOTHING RETURNING ${franchiseColumns}`,
  [randomUUID(), input.organizationId, input.displayName, input.franchiseCode]);
  // Only the named conflict target becomes this public conflict, never an arbitrary 23505.
  if (!result.rows[0]) throw new TenancyError('FRANCHISE_CODE_CONFLICT');
  return franchise(result.rows[0]);
}
export async function findOrganization(db: QueryExecutor, organizationId: string): Promise<Organization | null> {
  const result = await db.query<OrganizationRow>(`SELECT ${organizationColumns} FROM shipit.organizations WHERE id = $1`, [organizationId]);
  return result.rows[0] ? organization(result.rows[0]) : null;
}
export async function findFranchise(db: QueryExecutor, scope: FranchiseScope): Promise<Franchise | null> {
  const result = await db.query<FranchiseRow>(`SELECT ${franchiseColumns} FROM shipit.franchises
    WHERE organization_id = $1 AND id = $2`, [scope.organizationId, scope.franchiseId]);
  return result.rows[0] ? franchise(result.rows[0]) : null;
}
export async function listFranchises(db: QueryExecutor, scope: { organizationId: string; permittedFranchiseIds: readonly string[] }, input: FranchiseListInput) {
  const result = await db.query<FranchiseRow>(`SELECT ${franchiseColumns} FROM shipit.franchises
    WHERE organization_id = $1 AND id = ANY($2::uuid[])
      AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
    ORDER BY created_at ASC, id ASC LIMIT $5`,
  [scope.organizationId, scope.permittedFranchiseIds, input.after?.created_at ?? null, input.after?.id ?? null, input.limit + 1]);
  return result.rows.map(franchise);
}
// Shared locks allow concurrent operational writes; UPDATE waits for all prior writers.
// Always lock parent before child to serialize organization disable as well.
export async function lockOrganization(tx: TransactionExecutor, organizationId: string, exclusive = false): Promise<Organization> {
  assertActiveTransaction(tx);
  const result = await tx.query<OrganizationRow>(`SELECT ${organizationColumns} FROM shipit.organizations
    WHERE id = $1 ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`, [organizationId]);
  if (!result.rows[0]) throw new TenancyError('RESOURCE_NOT_FOUND');
  return organization(result.rows[0]);
}
export async function lockFranchise(tx: TransactionExecutor, scope: FranchiseScope, exclusive = false): Promise<Franchise> {
  assertActiveTransaction(tx);
  const result = await tx.query<FranchiseRow>(`SELECT ${franchiseColumns} FROM shipit.franchises
    WHERE organization_id = $1 AND id = $2 ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`, [scope.organizationId, scope.franchiseId]);
  if (!result.rows[0]) throw new TenancyError('RESOURCE_NOT_FOUND');
  return franchise(result.rows[0]);
}
export async function lockActiveFranchiseForOperationalWrite(tx: TransactionExecutor, scope: FranchiseScope): Promise<void> {
  const parent = await lockOrganization(tx, scope.organizationId);
  const child = await lockFranchise(tx, scope);
  if (parent.lifecycle !== 'active') throw new TenancyError('ORGANIZATION_DISABLED');
  if (child.lifecycle !== 'active') throw new TenancyError('FRANCHISE_DISABLED');
  // Caller must perform the operational write using this same transaction before commit.
}
export async function updateOrganizationProfile(tx: TransactionExecutor, organizationId: string, displayName: string, expectedVersion: number): Promise<Organization> {
  const result = await tx.query<OrganizationRow>(`UPDATE shipit.organizations
    SET display_name = $2, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
    WHERE id = $1 AND version = $3 RETURNING ${organizationColumns}`, [organizationId, displayName, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return organization(result.rows[0]);
}
export async function updateFranchiseProfile(tx: TransactionExecutor, scope: FranchiseScope, displayName: string, expectedVersion: number): Promise<Franchise> {
  const result = await tx.query<FranchiseRow>(`UPDATE shipit.franchises
    SET display_name = $3, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
    WHERE organization_id = $1 AND id = $2 AND version = $4 RETURNING ${franchiseColumns}`,
  [scope.organizationId, scope.franchiseId, displayName, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return franchise(result.rows[0]);
}
export async function updateOrganizationLifecycle(tx: TransactionExecutor, organizationId: string, lifecycle: Lifecycle, expectedVersion: number): Promise<Organization> {
  const result = await tx.query<OrganizationRow>(`UPDATE shipit.organizations
    SET lifecycle = $2, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()),
      lifecycle_changed_at = date_trunc('milliseconds', clock_timestamp())
    WHERE id = $1 AND version = $3 RETURNING ${organizationColumns}`, [organizationId, lifecycle, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return organization(result.rows[0]);
}
export async function updateFranchiseLifecycle(tx: TransactionExecutor, scope: FranchiseScope, lifecycle: Lifecycle, expectedVersion: number): Promise<Franchise> {
  const result = await tx.query<FranchiseRow>(`UPDATE shipit.franchises
    SET lifecycle = $3, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()),
      lifecycle_changed_at = date_trunc('milliseconds', clock_timestamp())
    WHERE organization_id = $1 AND id = $2 AND version = $4 RETURNING ${franchiseColumns}`,
  [scope.organizationId, scope.franchiseId, lifecycle, expectedVersion]);
  if (!result.rows[0]) throw new TenancyError('VERSION_CONFLICT');
  return franchise(result.rows[0]);
}
