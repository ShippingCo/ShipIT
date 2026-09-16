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

/** R05/W03: explicit local grants only; V needs a separate verified-purpose workflow. */
export function customerScope(memberships: readonly Membership[]) {
  return [...new Set(memberships.filter(m => m.lifecycle === 'active' &&
    (m.role === 'franchise_admin' || m.role === 'operator')).flatMap(m => m.franchiseIds))].sort();
}

/** R06/R07 owning-franchise reads. Custody/assignment-only grants remain unavailable
 * until their authoritative records land; a role label never fabricates C/A scope. */
export function shipmentReadScope(kind:'booking'|'parcel',memberships:readonly Membership[],all:readonly string[]) {
  const active=memberships.filter(value=>value.lifecycle==='active');
  if(active.some(value=>value.role==='org_admin'))return [...all].sort();
  const roles:readonly Role[]=kind==='booking'
    ? ['franchise_admin','operator','dispatcher','read_only']
    : ['franchise_admin','operator','dispatcher','read_only'];
  return [...new Set(active.filter(value=>roles.includes(value.role)).flatMap(value=>value.franchiseIds))].sort();
}

/** W07-W09/W12/W14. Custodial C and assigned A are deliberately narrower than a role
 * name; until durable custody grants land, this issue activates owning-franchise F only. */
export function parcelCommandScope(action:import('../parcels/types.ts').ParcelAction,memberships:readonly Membership[]) {
  const roles:readonly Role[]=action==='parcels.check_in'?['operator']:
    action==='parcels.dispatch'?['franchise_admin','operator','dispatcher']:
    action==='parcels.transit'?['dispatcher']:
    action==='parcels.fail_delivery'?['delivery_agent']:
    action==='parcels.approve_rto'?['franchise_admin']:[];
  return [...new Set(memberships.filter(m=>m.lifecycle==='active'&&roles.includes(m.role)).flatMap(m=>m.franchiseIds))].sort();
}

/** R21 published projection, W27 policy administration, W37 resolution, W01 booking preparation. */
export function taxScope(action: import('../tax/types.ts').TaxAction, memberships: readonly Membership[], all: readonly string[]) {
  const active = memberships.filter(m => m.lifecycle === 'active');
  if (action === 'tax.read' && active.some(m => m.role === 'org_admin')) return [...all];
  const roles: readonly Role[] = action === 'tax.read' ? ['franchise_admin','operator','dispatcher','accountant'] :
    ['tax.draft','tax.publish','tax.resolve'].includes(action) ? ['franchise_admin'] : ['franchise_admin','operator','dispatcher'];
  return [...new Set(active.filter(m => roles.includes(m.role)).flatMap(m => m.franchiseIds))].sort();
}

/** R21 reads; W27 local config; W01 ordinary variance; W43 privileged approval. */
export function pricingScope(action:import('../pricing/types.ts').PricingAction,memberships:readonly Membership[],all:readonly string[]) {
  const active=memberships.filter(m=>m.lifecycle==='active');
  const reading=action==='pricing.read'||action==='pricing.quote';
  if(reading&&active.some(m=>m.role==='org_admin'))return [...all];
  const roles:readonly Role[]=reading?['franchise_admin','operator','dispatcher','accountant']:
    action==='pricing.draft'||action==='pricing.publish'||action==='pricing.override.approve'?['franchise_admin']:['franchise_admin','operator','dispatcher'];
  return [...new Set(active.filter(m=>roles.includes(m.role)).flatMap(m=>m.franchiseIds))].sort();
}

/** R08 and W04. Dispatcher-only corrections are a separate live grant, never inheritance. */
export function lotScope(action:import('../lots/types.ts').LotAction,memberships:readonly Membership[],all:readonly string[]) {
  const active=memberships.filter(m=>m.lifecycle==='active');
  const read=action==='lots.read'||action==='lots.list';
  if(read&&active.some(m=>m.role==='org_admin'))return [...all];
  const roles:readonly Role[]=read?['franchise_admin','operator','dispatcher','read_only']:['franchise_admin','operator','dispatcher'];
  return [...new Set(active.filter(m=>roles.includes(m.role)).flatMap(m=>m.franchiseIds))].sort();
}

/** R09/W05/W06. Assignment-only agent snippets await their authoritative projection. */
export function routeScope(action:import('../routes/types.ts').RouteAction,memberships:readonly Membership[],all:readonly string[]) {
  const active=memberships.filter(m=>m.lifecycle==='active'),read=action==='routes.read'||action==='routes.list';
  if(read&&active.some(m=>m.role==='org_admin'))return [...all];
  const roles:readonly Role[]=read?['franchise_admin','operator','dispatcher','read_only']:
    action==='routes.archive'?['franchise_admin']:['franchise_admin','operator','dispatcher'];
  return [...new Set(active.filter(m=>roles.includes(m.role)).flatMap(m=>m.franchiseIds))].sort();
}

/** R11 and W20/W21: no role inheritance or additional cashier/agent grant. */
export function paymentScope(action:import('../payments/types.ts').PaymentAction,memberships:readonly Membership[],all:readonly string[]) {
  const active=memberships.filter(m=>m.lifecycle==='active');
  if(action==='payments.read'&&active.some(m=>m.role==='org_admin'))return [...all];
  const roles:readonly Role[]=action==='payments.read'?['franchise_admin','accountant']:['franchise_admin'];
  return [...new Set(active.filter(m=>roles.includes(m.role)).flatMap(m=>m.franchiseIds))].sort();
}

/** R13: one minimum finance artifact, never the R06/R11 operational/ledger grants. */
export function receiptScope(memberships:readonly Membership[],all:readonly string[]) {
  const active=memberships.filter(m=>m.lifecycle==='active');
  if(active.some(m=>m.role==='org_admin'))return [...all];
  return [...new Set(active.filter(m=>['franchise_admin','operator','accountant'].includes(m.role)).flatMap(m=>m.franchiseIds))].sort();
}
