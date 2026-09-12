import { randomUUID } from 'node:crypto';
import { appendTenancy } from '../audit/repository.ts';
import type { TenantAccess } from '../security/scope.ts';
import { DatabaseError, type DatabasePool, type QueryExecutor, type TransactionExecutor } from '@shippingco/db';
import { issueTenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { TenancyError } from './errors.ts';
import * as repository from './repository.ts';
import * as validate from './validation.ts';
import { tenancyTransaction } from './transaction.ts';
import { organizationDto, franchiseDto, utcInstant, type ApprovedTenancyContext, type TenancyAction,
  type TenancyAuthorizer, type TenancyAuditPort, type TenancyAuditFact, type Organization } from './types.ts';

export const denyTenancyAuthorization: TenancyAuthorizer = {
  authorize: async () => { throw new TenancyError('UNAUTHENTICATED'); },
};
interface Dependencies { database: DatabasePool; authorizer: TenancyAuthorizer; audit?: TenancyAuditPort }
const internalActions: readonly TenancyAction[] = ['organization.bootstrap', 'franchise.create',
  'organization.profile.update', 'organization.lifecycle.manage'];

export function createTenancyService({ database, authorizer, audit }: Dependencies) {
  async function approved(action: TenancyAction): Promise<ApprovedTenancyContext> {
    const context = await authorizer.authorize(action);
    const safeRef = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 &&
      /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value) && !/[^A-Za-z0-9:_-]/.test(value);
    try {
      if (context.action !== action || !['user', 'service'].includes(context.actor.type) ||
          !safeRef(context.actor.id) || !safeRef(context.correlationId) ||
          !Array.isArray(context.permittedFranchiseIds) ||
          (internalActions.includes(action) && context.actor.type !== 'service')) throw new Error();
      if (action === 'organization.bootstrap') {
        if (context.organizationId !== null || context.permittedFranchiseIds.length !== 0) throw new Error();
      } else validate.uuid(context.organizationId);
      context.permittedFranchiseIds.forEach(validate.uuid);
    } catch { throw new TenancyError('ACTION_FORBIDDEN'); }
    // Snapshot trusted approval so mutation by an adapter cannot widen in-flight scope.
    return { action, actor: { type: context.actor.type, id: context.actor.id },
      organizationId: context.organizationId, permittedFranchiseIds: [...context.permittedFranchiseIds],
      correlationId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(context.correlationId) ? context.correlationId : randomUUID() };
  }
  function access(executor: QueryExecutor, context: ApprovedTenancyContext, transaction = true) {
    return issueTenantAccess(executor, { ...context, organizationWide: context.actor.type === 'service',
      provenance: context.actor.type === 'service' ? 'internal-service' : 'membership' }, transaction);
  }
  function franchiseScope(context: ApprovedTenancyContext, id: unknown) {
    const franchiseId = validate.uuid(id);
    if (!context.permittedFranchiseIds.includes(franchiseId)) throw new TenancyError('RESOURCE_NOT_FOUND');
    return { organizationId: context.organizationId!, franchiseId };
  }
  async function dependency<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof HttpError) throw new TenancyError(error.code === 'RESOURCE_NOT_FOUND' ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN');
      if (error instanceof DatabaseError) throw new TenancyError('TEMPORARILY_UNAVAILABLE');
      throw error;
    }
  }
  function expected(record: Organization, value: number) {
    if (record.version !== value) throw new TenancyError('VERSION_CONFLICT');
  }
  function fact(context: ApprovedTenancyContext, record: Organization, franchiseId: string | null,
    previous: Organization | null, reasonCode: TenancyAuditFact['reason_code']): TenancyAuditFact {
    return { actor: { ...context.actor }, action: context.action,
      organization_id: context.organizationId ?? record.id, franchise_id: franchiseId,
      previous_lifecycle: previous?.lifecycle ?? null, new_lifecycle: record.lifecycle,
      expected_version: previous?.version ?? null, committed_version: record.version,
      correlation_id: context.correlationId, reason_code: reasonCode, occurred_at: utcInstant(record.updatedAt) };
  }
  async function report(scope: TenantAccess, value: TenancyAuditFact) {
    try { await appendTenancy(scope,value); await audit?.record(Object.freeze({ ...value, actor: Object.freeze({ ...value.actor }) })); }
    catch { throw new TenancyError('TEMPORARILY_UNAVAILABLE'); }
  }
  return {
    // Internal bootstrap only. #17 must add identity/membership/idempotency atomically.
    async bootstrap(input: unknown) {
      const context = await approved('organization.bootstrap');
      const body = validate.object(input, ['display_name', 'franchise']);
      const displayName = validate.displayName(body.display_name);
      const initial = validate.createFranchiseInput(body.franchise);
      const result = await tenancyTransaction(database, async tx => {
        const organization = await repository.insertOrganization(access(tx, context), displayName);
        const franchise = await repository.insertFranchise(access(tx, { ...context, organizationId: organization.id }), { organizationId: organization.id, ...initial });
        await report(access(tx,{...context,organizationId:organization.id}),fact({...context,organizationId:organization.id},franchise,franchise.id,null,'bootstrap'));
        return { organization, franchise };
      });
      return { organization: organizationDto(result.organization), franchise: franchiseDto(result.franchise) };
    },
    async createFranchise(input: unknown) {
      const context = await approved('franchise.create');
      const body = validate.createFranchiseInput(input);
      const result = await tenancyTransaction(database, async tx => {
        const parent = await repository.lockOrganization(access(tx, context), context.organizationId!);
        if (parent.lifecycle !== 'active') throw new TenancyError('ORGANIZATION_DISABLED');
        const franchise=await repository.insertFranchise(access(tx, context), { organizationId: parent.id, ...body });
        await report(access(tx,context),fact(context,franchise,franchise.id,null,'franchise_creation'));
        return franchise;
      });
      return franchiseDto(result);
    },
    async readOrganization() {
      const context = await approved('organization.profile.read');
      const result = await dependency(() => repository.findOrganization(access(database, context, false), context.organizationId!));
      if (!result) throw new TenancyError('RESOURCE_NOT_FOUND');
      return organizationDto(result);
    },
    async readFranchise(franchiseId: unknown) {
      const context = await approved('franchise.profile.read');
      const scope = franchiseScope(context, franchiseId);
      const result = await dependency(() => repository.findFranchise(access(database, context, false), scope));
      if (!result) throw new TenancyError('RESOURCE_NOT_FOUND');
      return franchiseDto(result);
    },
    async listFranchises(input: unknown = {}) {
      const context = await approved('franchise.profile.list');
      const body = validate.listInput(input);
      if (body.after) {
        // Internal boundary must refer to an existing currently permitted row. #23
        // owns opaque wire encoding, expiry and full query/scope integrity.
        if (!context.permittedFranchiseIds.includes(body.after.id)) throw new TenancyError('VALIDATION_FAILED');
        const boundary = await dependency(() => repository.findFranchise(access(database, context, false),
          { organizationId: context.organizationId!, franchiseId: body.after!.id }));
        if (!boundary || utcInstant(boundary.createdAt) !== body.after.created_at) throw new TenancyError('VALIDATION_FAILED');
      }
      const rows = await dependency(() => repository.listFranchises(access(database, context, false),
        { organizationId: context.organizationId!, permittedFranchiseIds: context.permittedFranchiseIds }, body));
      const hasMore = rows.length > body.limit;
      const items = rows.slice(0, body.limit).map(franchiseDto);
      const last = items.at(-1);
      return { items, page: { has_more: hasMore,
        next_boundary: hasMore && last ? { created_at: last.created_at, id: last.id } : null } };
    },
    async updateFranchiseProfile(franchiseId: unknown, input: unknown) {
      const context = await approved('franchise.profile.update');
      const scope = franchiseScope(context, franchiseId);
      const body = validate.profileInput(input);
      const result = await tenancyTransaction(database, async tx => {
        const parent = await repository.lockOrganization(access(tx, context), scope.organizationId);
        const previous = await repository.lockFranchise(access(tx, context), scope, true);
        expected(previous, body.expectedVersion);
        if (parent.lifecycle !== 'active') throw new TenancyError('ORGANIZATION_DISABLED');
        if (previous.lifecycle !== 'active') throw new TenancyError('FRANCHISE_DISABLED');
        const current=await repository.updateFranchiseProfile(access(tx, context), scope, body.displayName, body.expectedVersion);
        await report(access(tx,context),fact(context,current,scope.franchiseId,previous,'profile_correction'));
        return {previous,current};
      });
      return franchiseDto(result.current);
    },
    async changeFranchiseLifecycle(franchiseId: unknown, input: unknown) {
      const context = await approved('franchise.lifecycle.manage');
      const scope = franchiseScope(context, franchiseId);
      const body = validate.lifecycleInput(input);
      const result = await tenancyTransaction(database, async tx => {
        await repository.lockOrganization(access(tx, context), scope.organizationId);
        const previous = await repository.lockFranchise(access(tx, context), scope, true);
        expected(previous, body.expectedVersion);
        if (previous.lifecycle === body.lifecycle) return { previous, current: previous };
        const current=await repository.updateFranchiseLifecycle(access(tx, context), scope, body.lifecycle, body.expectedVersion);
        await report(access(tx,context),fact(context,current,scope.franchiseId,previous,body.reasonCode));
        return {previous,current};
      });
      return franchiseDto(result.current);
    },
    async updateOrganizationProfile(input: unknown) {
      const context = await approved('organization.profile.update');
      const body = validate.profileInput(input);
      const result = await tenancyTransaction(database, async tx => {
        const previous = await repository.lockOrganization(access(tx, context), context.organizationId!, true);
        expected(previous, body.expectedVersion);
        if (previous.lifecycle !== 'active') throw new TenancyError('ORGANIZATION_DISABLED');
        const current=await repository.updateOrganizationProfile(access(tx, context), previous.id, body.displayName, body.expectedVersion);
        await report(access(tx,context),fact(context,current,null,previous,'profile_correction'));
        return {previous,current};
      });
      return organizationDto(result.current);
    },
    async changeOrganizationLifecycle(input: unknown) {
      const context = await approved('organization.lifecycle.manage');
      const body = validate.lifecycleInput(input);
      const result = await tenancyTransaction(database, async tx => {
        const previous = await repository.lockOrganization(access(tx, context), context.organizationId!, true);
        expected(previous, body.expectedVersion);
        if (previous.lifecycle === body.lifecycle) return { previous, current: previous };
        const current=await repository.updateOrganizationLifecycle(access(tx, context), previous.id, body.lifecycle, body.expectedVersion);
        await report(access(tx,context),fact(context,current,null,previous,body.reasonCode));
        return {previous,current};
      });
      return organizationDto(result.current);
    },
  };
}

/** Trusted coordinator seam. The caller owns identity, membership and replay in this transaction. */
export async function bootstrapTenancyInTransaction(tx: TransactionExecutor, input: unknown,
  actorReference: string, correlationId: string) {
  const body = validate.object(input, ['display_name', 'franchise']);
  const displayName = validate.displayName(body.display_name);
  const initial = validate.createFranchiseInput(body.franchise);
  const context = { action: 'organization.bootstrap' as const, actor: { type: 'service' as const, id: actorReference },
    organizationId: null as string | null, permittedFranchiseIds: [] as string[], organizationWide: true,
    correlationId, provenance: 'internal-service' as const };
  const organization = await repository.insertOrganization(issueTenantAccess(tx, context), displayName);
  const scope = issueTenantAccess(tx, { ...context, organizationId: organization.id });
  const franchise = await repository.insertFranchise(scope, { organizationId: organization.id, ...initial });
  for (const record of [organization, franchise]) {
    await appendTenancy(scope, { actor: context.actor, action: context.action, organization_id: organization.id,
      franchise_id: record === franchise ? franchise.id : null, previous_lifecycle: null, new_lifecycle: 'active',
      expected_version: null, committed_version: 1, correlation_id: correlationId, reason_code: 'bootstrap',
      occurred_at: utcInstant(record.createdAt) });
  }
  return { organization, franchise };
}
