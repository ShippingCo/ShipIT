import type { CustomerCreateRequest, CustomerUpdateRequest, CustomerDto } from '@shippingco/shared';
import { object, uuid, text, integer, instant, list } from './dto';
import type { ScopedApi } from './scoped-api';
export const customerDto = object({ id: uuid, name: text, phone: text, phone_display: text, address: text,
  version: integer(1), created_at: instant, updated_at: instant });
export function customers(api: ScopedApi) {
  const base = `/api/v1/organizations/${api.organization}/franchises/${api.franchise}/customers`;
  return {
    search: (searchBy: 'name' | 'phone', q: string, signal: AbortSignal, cursor?: string) => api.read(base + '?' + new URLSearchParams({ search_by: searchBy, q, limit: '20', ...(cursor ? { cursor } : {}) }).toString().replaceAll('+', '%20'), list(customerDto), signal),
    read: (id: string) => api.read(base + '/' + uuid(id), customerDto),
    create: (body: CustomerCreateRequest) => api.intent('api.v1.customers.create', base, body),
    update: (customer: CustomerDto, body: CustomerUpdateRequest) => api.intent('api.v1.customers.update', base + '/' + uuid(customer.id), body, 'PATCH'),
    execute: (intent: Parameters<ScopedApi['execute']>[0]) => api.execute(intent, customerDto, ['name', 'phone', 'address', 'expected_version']),
  };
}
