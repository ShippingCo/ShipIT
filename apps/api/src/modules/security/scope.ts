import { assertActiveTransaction, type QueryExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import type { ApprovedTenancyContext } from '../tenancy/types.ts';

export type PrivateAction = ApprovedTenancyContext['action'] | 'memberships.read' | 'memberships.manage' |
  'invitations.accept' | 'memberships.bootstrap' | 'operations.export' | 'financial.export';
export interface PrivateContext extends Omit<ApprovedTenancyContext, 'action'> {
  readonly action: PrivateAction;
  readonly organizationWide: boolean;
  readonly invitationId?: string;
  readonly provenance: 'membership' | 'internal-service' | 'invitation' | 'trusted-event';
}
const brand: unique symbol = Symbol('TenantAccess');
export interface TenantAccess { readonly [brand]: true; readonly context: PrivateContext }
const capabilities = new WeakMap<TenantAccess, { executor: QueryExecutor; transaction: boolean }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const actions: readonly PrivateAction[] = ['organization.bootstrap','franchise.create','organization.profile.update',
  'organization.lifecycle.manage','organization.profile.read','franchise.profile.read','franchise.profile.list',
  'franchise.profile.update','franchise.lifecycle.manage','memberships.read','memberships.manage',
  'invitations.accept','memberships.bootstrap','operations.export','financial.export'];
const reference = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

// Internal issuer. Import sites are allowlisted by the AST security gate. Never a DTO parser.
export function issueTenantAccess(executor: QueryExecutor, input: PrivateContext, transaction = true): TenantAccess {
  if (!input || !actions.includes(input.action) || !input.actor || !['user','service'].includes(input.actor.type) ||
    typeof input.actor.id !== 'string' || !reference.test(input.actor.id) ||
    (['organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage','memberships.bootstrap'].includes(input.action) && input.actor.type !== 'service') || typeof input.correlationId !== 'string' || !reference.test(input.correlationId) ||
    typeof input.organizationWide !== 'boolean' ||
    (input.action === 'invitations.accept' && (!input.invitationId || !uuid.test(input.invitationId))) || !Array.isArray(input.permittedFranchiseIds) ||
    input.permittedFranchiseIds.some(id => typeof id !== 'string' || !uuid.test(id)) ||
    (input.organizationId === null && input.permittedFranchiseIds.length !== 0) ||
    (['internal-service','trusted-event'].includes(input.provenance) ? input.actor.type !== 'service' : input.actor.type !== 'user') ||
    !['membership','internal-service','invitation','trusted-event'].includes(input.provenance) ||
    (input.organizationId === null ? input.action !== 'organization.bootstrap' : !uuid.test(input.organizationId))) {
    throw new HttpError('ACTION_FORBIDDEN');
  }
  if (transaction) assertActiveTransaction(executor);
  const context = Object.freeze({ action:input.action, organizationId:input.organizationId,
    organizationWide:input.organizationWide, invitationId:input.invitationId, provenance:input.provenance, correlationId:input.correlationId,
    actor: Object.freeze({ type:input.actor.type,id:input.actor.id }),
    permittedFranchiseIds: Object.freeze([...input.permittedFranchiseIds]) });
  const access: TenantAccess = Object.freeze({ [brand]: true as const, context });
  capabilities.set(access, { executor, transaction });
  return access;
}
export function assertTenantAccess(access: TenantAccess, actions: readonly PrivateAction[] = []): PrivateContext {
  const capability = capabilities.get(access);
  if (!capability || (actions.length && !actions.includes(access.context.action))) throw new HttpError('ACTION_FORBIDDEN');
  if (capability.transaction) {
    try { assertActiveTransaction(capability.executor); }
    catch { throw new HttpError('ACTION_FORBIDDEN'); }
  }
  return access.context;
}
export function assertOrganization(access: TenantAccess, organizationId: string) {
  if (assertTenantAccess(access).organizationId !== organizationId) throw new HttpError('RESOURCE_NOT_FOUND');
}
export function assertFranchises(access: TenantAccess, ids: readonly string[]) {
  const context = assertTenantAccess(access);
  if (!context.organizationWide && ids.some(id => !context.permittedFranchiseIds.includes(id))) throw new HttpError('RESOURCE_NOT_FOUND');
}

/** Scope macros generate bound ownership predicates; no connection/session state is used. */
export function scopedQuery<Row extends object = Record<string, unknown>>(
  access: TenantAccess, actions: readonly PrivateAction[], sql: string, params: readonly unknown[] = [],
) {
  if (!actions.length) throw new HttpError('ACTION_FORBIDDEN');
  const context = assertTenantAccess(access, actions);
  const command = sql.trimStart().match(/^(SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1]?.toUpperCase();
  if (!command || sql.includes(';') ||
    ((command !== 'SELECT' || /FOR\s+(UPDATE|SHARE)/i.test(sql)) && !capabilities.get(access)!.transaction) || (command !== 'SELECT' && /(?:\.read|\.list|\.export)$/.test(context.action))) {
    throw new HttpError('ACTION_FORBIDDEN');
  }
  const values = [...params];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  let predicates = 0;
  const text = sql.replace(/\{\{(organization|franchise|membership|invitation):([a-z_$][a-z0-9_.$]*)(?::([a-z_$][a-z0-9_.$]*))?\}\}/g,
    (_, kind: string, column: string, franchise: string | undefined) => {
      predicates++;
      if (kind === 'organization') return `${column}::uuid = ${bind(context.organizationId)}::uuid`;
      if (kind === 'franchise') {
        if (!franchise) throw new HttpError('ACTION_FORBIDDEN');
        return `(${column} = ${bind(context.organizationId)} AND ${franchise} = ANY(${bind(context.permittedFranchiseIds)}::uuid[]))`;
      }
      const table = kind === 'membership' ? 'membership_franchise_scopes' : 'invitation_franchise_scopes';
      const key = kind === 'membership' ? 'membership_id' : 'invitation_id';
      let own = `${column}.organization_id = ${bind(context.organizationId)}`;
      if (context.action === 'invitations.accept') {
        own += kind === 'membership' ? ` AND ${column}.user_id=${bind(context.actor.id)}::uuid`
          : ` AND ${column}.invitee_user_id=${bind(context.actor.id)}::uuid AND ${column}.id=${bind(context.invitationId)}::uuid`;
      }
      const permitted = bind(context.permittedFranchiseIds);
      // Read projection can intersect scopes; mutation must control every scope on the grant.
      const scope = context.action === 'memberships.read'
        ? `EXISTS (SELECT 1 FROM shipit.${table} allowed WHERE allowed.organization_id=${column}.organization_id AND allowed.${key}=${column}.id AND allowed.franchise_id=ANY(${permitted}::uuid[]))`
        : `(EXISTS (SELECT 1 FROM shipit.${table} allowed WHERE allowed.organization_id=${column}.organization_id AND allowed.${key}=${column}.id) AND NOT EXISTS (SELECT 1 FROM shipit.${table} denied WHERE denied.organization_id=${column}.organization_id AND denied.${key}=${column}.id AND NOT (denied.franchise_id=ANY(${permitted}::uuid[]))))`;
      return `(${own} AND (${bind(context.organizationWide)}::boolean OR (${column}.role <> 'org_admin' AND ${scope})))`;
    }).replaceAll('{{organization}}', () => bind(context.organizationId))
    .replaceAll('{{franchises}}', () => bind(context.permittedFranchiseIds))
    .replaceAll('{{organizationWide}}', () => bind(context.organizationWide));
  // Inserts must use scope-derived ownership; bootstrap is the sole root creation exception.
  if ((!predicates && !(/INSERT\s+INTO/i.test(sql) && (sql.includes('{{organization}}') || context.action === 'organization.bootstrap'))) || text.includes('{{')) {
    throw new HttpError('ACTION_FORBIDDEN');
  }
  return capabilities.get(access)!.executor.query<Row>(text, values);
}
