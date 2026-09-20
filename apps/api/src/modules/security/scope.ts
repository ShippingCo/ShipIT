import { assertActiveTransaction, type QueryExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import type { CustomerAction } from '../customers/types.ts';
import type { ApprovedTenancyContext } from '../tenancy/types.ts';

export type BookingAction = 'bookings.create'|'parcels.create'|'customer.snapshot.read'|'bookings.audit'|'bookings.events'|
  'bookings.read'|'bookings.list'|'parcels.read'|'parcels.list'|'parcels.timeline';
export type PrivateAction = 'whatsapp.consent.read' | 'whatsapp.consent.work' | 'whatsapp.inbox.work' | 'whatsapp.read' | 'whatsapp.write' | import('../outbox/types.ts').OutboxAction | import('../eway/types.ts').EwayAction | import('../attachments/types.ts').AttachmentAction | import('../receipts/types.ts').ReceiptAction | import('../payments/types.ts').PaymentAction | import('../routes/types.ts').RouteAction | import('../lots/types.ts').LotAction | BookingAction | import('../parcels/types.ts').ParcelAction | import('../tax/types.ts').TaxAction | import('../pricing/types.ts').PricingAction | CustomerAction | ApprovedTenancyContext['action'] | 'memberships.read' | 'memberships.manage' |
  'invitations.accept' | 'memberships.bootstrap' | 'operations.export' | 'financial.export' | 'audit.read';
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
const actions: readonly PrivateAction[] = ['whatsapp.consent.read','whatsapp.consent.work','whatsapp.inbox.work','whatsapp.read','whatsapp.write','eway.read','eway.write','attachments.read','attachments.write','attachments.download','attachments.audit','attachments.cleanup','receipts.read','receipts.materialize','payments.receipt.read','payments.collect','payments.reverse','payments.read','payments.audit','payments.events','routes.departure','routes.delay','routes.arrival','routes.read','routes.list','routes.create','routes.update','routes.archive','routes.finalize','routes.lot.attach','routes.lot.detach','routes.parcel.attach','routes.parcel.detach','routes.audit','routes.events','lots.read','lots.list','lots.create','lots.update','lots.archive','lots.membership.add','lots.membership.move','lots.membership.remove','lots.audit','lots.events','bookings.create','parcels.create','customer.snapshot.read','bookings.audit','bookings.events','bookings.read','bookings.list','parcels.read','parcels.list','parcels.timeline',
  'outbox.read','outbox.redrive','outbox.work','parcels.check_in','parcels.dispatch','parcels.transit','parcels.fail_delivery','parcels.approve_rto','parcels.events',
  'tax.read','tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate','tax.validate','organization.bootstrap','franchise.create','organization.profile.update',
  'organization.lifecycle.manage','organization.profile.read','franchise.profile.read','franchise.profile.list',
  'franchise.profile.update','franchise.lifecycle.manage','memberships.read','memberships.manage',
  'invitations.accept','memberships.bootstrap','operations.export','financial.export','audit.read','pricing.read','pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve','pricing.validate','customer.read','customer.list','customer.create','customer.update'];
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
  if ((['bookings.create','parcels.create','customer.snapshot.read','bookings.audit','bookings.events'].includes(input.action) || input.action.startsWith('eway.') || input.action.startsWith('receipts.') || input.action.startsWith('payments.') || input.action.startsWith('routes.') || input.action.startsWith('lots.') || input.action.startsWith('parcels.') || input.action.startsWith('tax.') || input.action.startsWith('pricing.') || ['customer.read','customer.list','customer.create','customer.update'].includes(input.action)) &&
    (input.provenance !== 'membership' || input.actor.type !== 'user' || input.organizationWide || input.permittedFranchiseIds.length !== 1)) {
    throw new HttpError('ACTION_FORBIDDEN');
  }
  if (input.action.startsWith('whatsapp.') && !['whatsapp.inbox.work','whatsapp.consent.work'].includes(input.action) && (input.provenance !== 'membership' || input.actor.type !== 'user' || input.organizationWide || input.permittedFranchiseIds.length !== 1)) throw new HttpError('ACTION_FORBIDDEN');
  if(input.action==='whatsapp.consent.work' && (input.provenance!=='trusted-event'||input.actor.type!=='service'||input.actor.id!=='whatsapp-consent-worker'||input.organizationWide||input.permittedFranchiseIds.length!==1))throw new HttpError('ACTION_FORBIDDEN');
  if(input.action==='whatsapp.inbox.work' && (input.provenance!=='trusted-event'||input.actor.type!=='service'||input.actor.id!=='whatsapp-inbox-worker'||input.organizationWide||input.permittedFranchiseIds.length!==1))throw new HttpError('ACTION_FORBIDDEN');
  if (input.action.startsWith('attachments.') && (input.permittedFranchiseIds.length !== 1 || input.organizationWide ||
    (input.action === 'attachments.cleanup' ? input.provenance !== 'trusted-event' || input.actor.type !== 'service' : input.provenance !== 'membership' || input.actor.type !== 'user'))) throw new HttpError('ACTION_FORBIDDEN');
  if (input.action.startsWith('outbox.') && (input.permittedFranchiseIds.length !== 1 || input.organizationWide ||
    (input.action === 'outbox.work' ? input.provenance !== 'trusted-event' || input.actor.type !== 'service' || input.actor.id !== 'outbox-worker'
      : input.provenance !== 'membership' || input.actor.type !== 'user'))) throw new HttpError('ACTION_FORBIDDEN');
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
  const writes = command !== 'SELECT' || /\bshipit\.(?:outbox_(?:relay|claim|receipt|finish|redrive)|whatsapp_consent_apply|whatsapp_inbox_process|append_(?:payment_audit|tenancy_audit|security_denial|customer_audit|pricing_audit|booking_audit|lot_audit|route_audit))\s*\(/i.test(sql);
  if (!command || sql.includes(';') ||
    ((writes || /FOR\s+(UPDATE|SHARE)/i.test(sql)) && !capabilities.get(access)!.transaction) || (writes && /(?:\.read|\.list|\.export)$/.test(context.action))) {
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
