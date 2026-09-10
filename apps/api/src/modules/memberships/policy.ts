import type { TenancyAction } from '../tenancy/types.ts';
import type { Membership, Role } from './types.ts';

export interface ManagementAuthority { organizationWide: boolean; franchiseIds: string[] }
export function managementAuthority(memberships: readonly Membership[]): ManagementAuthority | null {
  const active=memberships.filter(value=>value.lifecycle==='active');
  if (active.some(value=>value.role==='org_admin')) return {organizationWide:true,franchiseIds:[]};
  const franchiseIds=[...new Set(active.filter(value=>value.role==='franchise_admin').flatMap(value=>value.franchiseIds))].sort();
  return franchiseIds.length ? {organizationWide:false,franchiseIds} : null;
}
export function canManageGrant(authority: ManagementAuthority, role: Role, franchiseIds: readonly string[]) {
  if (authority.organizationWide) return true;
  return role !== 'org_admin' && franchiseIds.length > 0 && franchiseIds.every(id=>authority.franchiseIds.includes(id));
}
const franchiseReadRoles: readonly Role[]=['franchise_admin','operator','dispatcher','accountant','read_only'];
export function tenancyScope(action: TenancyAction, memberships: readonly Membership[], organizationFranchiseIds: readonly string[]) {
  const active=memberships.filter(value=>value.lifecycle==='active');
  if (['organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage'].includes(action)) return null;
  const orgAdmin=active.some(value=>value.role==='org_admin');
  if (action==='organization.profile.read' || action==='franchise.profile.read' || action==='franchise.profile.list') {
    if (orgAdmin) return [...organizationFranchiseIds];
    const ids=active.filter(value=>franchiseReadRoles.includes(value.role)).flatMap(value=>value.franchiseIds);
    return ids.length ? [...new Set(ids)].sort() : null;
  }
  const ids=active.filter(value=>value.role==='franchise_admin' ||
    (action==='franchise.lifecycle.manage' && value.role==='org_admin')).flatMap(value=>value.franchiseIds);
  return ids.length ? [...new Set(ids)].sort() : null;
}
