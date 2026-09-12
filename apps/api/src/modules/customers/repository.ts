import { randomUUID } from 'node:crypto';
import type { CustomerDto } from '@shippingco/shared';
import { scopedQuery, assertTenantAccess, assertFranchises, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { ContactInput, CustomerRow, CustomerBoundary, CustomerFilter, CustomerOperation } from './types.ts';
import { literalPrefix } from './validation.ts';
const columns = 'id,organization_id,franchise_id,name,phone_normalized,phone_display,address,version,created_at,updated_at';
export async function visibleFranchise(scope: TenantAccess, franchiseId: string, active = false) {
  assertFranchises(scope, [franchiseId]);
  const row = (await scopedQuery<{ lifecycle: string; parent_lifecycle: string }>(scope,
    ['customer.read','customer.list','customer.create','customer.update'], `SELECT f.lifecycle,o.lifecycle AS parent_lifecycle
      FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id
      WHERE {{franchise:f.organization_id:f.id}} AND f.id=$1`, [franchiseId])).rows[0];
  if (!row) throw new HttpError('RESOURCE_NOT_FOUND');
  if (active && row.parent_lifecycle !== 'active') throw new HttpError('ORGANIZATION_DISABLED');
  if (active && row.lifecycle !== 'active') throw new HttpError('FRANCHISE_DISABLED');
}
export async function find(scope: TenantAccess, franchiseId: string, id: string) {
  return (await scopedQuery<CustomerRow>(scope, ['customer.read','customer.create','customer.update'],
    `SELECT ${columns} FROM shipit.customers WHERE {{franchise:organization_id:franchise_id}} AND franchise_id=$1 AND id=$2`,
    [franchiseId, id])).rows[0];
}
export async function search(scope: TenantAccess, franchiseId: string, filter: CustomerFilter, boundary: CustomerBoundary | null) {
  // The only interpolation is a closed server-owned column choice. Search values are bound.
  const column = filter.searchBy === 'phone' ? 'phone_normalized' : 'name';
  return (await scopedQuery<CustomerRow>(scope, ['customer.list'], `SELECT ${columns} FROM shipit.customers
    WHERE {{franchise:organization_id:franchise_id}} AND franchise_id=$1 AND ${column} LIKE $2
      AND ($3::timestamptz IS NULL OR (created_at,id)>($3::timestamptz,$4::uuid))
    ORDER BY created_at ASC,id ASC LIMIT $5`,
  [franchiseId, literalPrefix(filter.prefix), boundary?.time ?? null, boundary?.id ?? null, filter.limit + 1])).rows;
}
export async function insert(scope: TenantAccess, franchiseId: string, input: ContactInput) {
  assertFranchises(scope, [franchiseId]);
  return (await scopedQuery<CustomerRow>(scope, ['customer.create'], `INSERT INTO shipit.customers
    (id,organization_id,franchise_id,name,phone_normalized,phone_display,address)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}} RETURNING ${columns}`,
  [randomUUID(), franchiseId, input.name, input.phone_normalized, input.phone_display, input.address, scope.context.organizationId])).rows[0]!;
}
export async function update(scope: TenantAccess, franchiseId: string, id: string, input: ContactInput & { expected_version: number }) {
  const row = (await scopedQuery<CustomerRow>(scope, ['customer.update'], `UPDATE shipit.customers
    SET name=$3,phone_normalized=$4,phone_display=$5,address=$6,version=version+1,
      updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE {{franchise:organization_id:franchise_id}} AND franchise_id=$1 AND id=$2 AND version=$7 RETURNING ${columns}`,
  [franchiseId,id,input.name,input.phone_normalized,input.phone_display,input.address,input.expected_version])).rows[0];
  if (!row) throw new HttpError('VERSION_CONFLICT');
  return row;
}
export async function receipt(scope: TenantAccess, franchiseId: string, operation: CustomerOperation, key: string) {
  const c = assertTenantAccess(scope, ['customer.create','customer.update']);
  return (await scopedQuery<{ fingerprint: string; customer_id: string; result: CustomerDto }>(scope,
    ['customer.create','customer.update'], `SELECT fingerprint,customer_id,result FROM shipit.customer_commands
      WHERE {{franchise:organization_id:franchise_id}} AND franchise_id=$1 AND actor_id=$2 AND operation_id=$3 AND key_digest=$4`,
    [franchiseId,c.actor.id,operation,key])).rows[0];
}
export async function saveReceipt(scope: TenantAccess, franchiseId: string, operation: CustomerOperation,
  key: string, fingerprint: string, result: CustomerDto) {
  const c = assertTenantAccess(scope, ['customer.create','customer.update']);
  await scopedQuery(scope, ['customer.create','customer.update'], `INSERT INTO shipit.customer_commands
    (command_id,actor_id,organization_id,franchise_id,operation_id,key_digest,fingerprint,normalization_version,customer_id,result)
    SELECT $1,$2,{{organization}},$3,$4,$5,$6,1,$7,$8 WHERE {{franchise:$9:$3}}`,
  [randomUUID(),c.actor.id,franchiseId,operation,key,fingerprint,result.id,result,c.organizationId]);
}
