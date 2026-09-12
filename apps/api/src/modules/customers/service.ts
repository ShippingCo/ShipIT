import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { withStaffTenantScope } from '../memberships/service.ts';
import { lockActiveFranchiseForOperationalWrite } from '../tenancy/repository.ts';
import { TenancyError } from '../tenancy/errors.ts';
import { appendCustomer } from '../audit/repository.ts';
import { HttpError } from '../../plugins/errors.ts';
import { customerDto } from './types.ts';
import type { CustomerAction } from './types.ts';
import type { TenantAccess } from '../security/scope.ts';
import * as validate from './validation.ts';
import * as repository from './repository.ts';
import { keyDigest, fingerprint } from './idempotency.ts';
import { customerCursorCodec } from './cursor.ts';

export function createCustomerService(database: DatabasePool, key: Buffer) {
  const codec = customerCursorCodec(key);
  function scoped<T>(session: string, organization: unknown, franchise: unknown, action: CustomerAction,
    correlationId: string, work: (scope: TenantAccess, franchiseId: string, revision: string) => Promise<T>) {
    const organizationId = validate.uuid(organization, 'organization_id'), franchiseId = validate.uuid(franchise, 'franchise_id');
    return withStaffTenantScope(database, session, organizationId, action, async (scope, revision) => {
      await repository.visibleFranchise(scope, franchiseId, action === 'customer.list');
      return work(scope, franchiseId, revision);
    }, { franchiseId, correlationId, object: action === 'customer.read' || action === 'customer.update' });
  }
  async function active(scope: TenantAccess, franchiseId: string) {
    try { await lockActiveFranchiseForOperationalWrite(scope, { organizationId: scope.context.organizationId!, franchiseId }); }
    catch (error) { if (error instanceof TenancyError) throw new HttpError(error.code); throw error; }
  }
  async function command(scope: TenantAccess, franchiseId: string, keyInput: unknown,
    id: string | null, input: unknown) {
    // Resolve object visibility before replay/conflicts; never look up a global ID.
    if (id && !await repository.find(scope, franchiseId, id)) throw new HttpError('RESOURCE_NOT_FOUND');
    const body = id === null ? validate.createInput(input) : validate.updateInput(input);
    const operation = id === null ? 'api.v1.customers.create' : 'api.v1.customers.update';
    const keyHash = keyDigest(validate.idempotencyKey(keyInput)), intent = fingerprint(operation, id, body);
    const previous = await repository.receipt(scope, franchiseId, operation, keyHash);
    if (previous) {
      if (!await repository.find(scope, franchiseId, previous.customer_id)) throw new HttpError('RESOURCE_NOT_FOUND');
      if (previous.fingerprint !== intent) throw new HttpError('IDEMPOTENCY_CONFLICT');
      // Explicit projection also on stored replay. Do not return future receipt columns.
      const r = previous.result;
      return { id:r.id,name:r.name,phone:r.phone,phone_display:r.phone_display,address:r.address,
        version:r.version,created_at:r.created_at,updated_at:r.updated_at };
    }
    await active(scope, franchiseId);
    const row = id === null ? await repository.insert(scope, franchiseId, body)
      : await repository.update(scope, franchiseId, id, body as ReturnType<typeof validate.updateInput>);
    const result = customerDto(row);
    await appendCustomer(scope, franchiseId, result.id, result.version);
    await repository.saveReceipt(scope, franchiseId, operation, keyHash, intent, result);
    return result;
  }
  return {
    list(session: string, organization: unknown, franchise: unknown, input: unknown, correlationId: string) {
      const filter = validate.searchInput(input);
      return scoped(session, organization, franchise, 'customer.list', correlationId, async (scope, franchiseId, revision) => {
        const binding = createHash('sha256').update(JSON.stringify({ actor:scope.context.actor,organization:scope.context.organizationId,
          franchise:franchiseId,revision,filter:{...filter,cursor:null},sort:'created_at_id_asc',version:1 })).digest('hex');
        const boundary = filter.cursor ? codec.decode(filter.cursor, binding) : null;
        const rows = await repository.search(scope, franchiseId, filter, boundary);
        const visible = rows.slice(0, filter.limit), last = visible.at(-1), hasMore = rows.length > filter.limit;
        return { items:visible.map(customerDto),page:{has_more:hasMore,next_cursor:hasMore && last
          ? codec.encode(binding,{id:last.id,time:last.created_at.toISOString()}) : null} };
      });
    },
    read(session: string, organization: unknown, franchise: unknown, customer: unknown, correlationId: string) {
      const id = validate.uuid(customer, 'customer_id');
      return scoped(session, organization, franchise, 'customer.read', correlationId, async (scope, franchiseId) => {
        const row = await repository.find(scope, franchiseId, id);
        if (!row) throw new HttpError('RESOURCE_NOT_FOUND');
        return customerDto(row);
      });
    },
    create(session: string, organization: unknown, franchise: unknown, key: unknown, input: unknown, correlationId: string) {
      return scoped(session, organization, franchise, 'customer.create', correlationId,
        (scope, franchiseId) => command(scope, franchiseId, key, null, input));
    },
    update(session: string, organization: unknown, franchise: unknown, customer: unknown, key: unknown, input: unknown, correlationId: string) {
      const id = validate.uuid(customer, 'customer_id');
      return scoped(session, organization, franchise, 'customer.update', correlationId,
        (scope, franchiseId) => command(scope, franchiseId, key, id, input));
    },
  };
}
