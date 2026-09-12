import type { CustomerDto } from '@shippingco/shared';
export interface CustomerRow {
  id: string; organization_id: string; franchise_id: string;
  name: string; phone_normalized: string; phone_display: string; address: string;
  version: number; created_at: Date; updated_at: Date;
}
export interface ContactInput { name: string; phone_normalized: string; phone_display: string; address: string }
export interface CustomerBoundary { time: string; id: string }
export interface CustomerFilter { searchBy: 'name' | 'phone'; prefix: string; limit: number; cursor: string | null }
export type CustomerAction = 'customer.read' | 'customer.list' | 'customer.create' | 'customer.update';
export type CustomerOperation = 'api.v1.customers.create' | 'api.v1.customers.update';
function instant(value: Date) { return value.toISOString().replace(/\.000Z$/, 'Z').replace(/(\.\d*?[1-9])0+Z$/, '$1Z'); }
export function customerDto(row: CustomerRow): CustomerDto {
  return { id: row.id, name: row.name, phone: row.phone_normalized, phone_display: row.phone_display,
    address: row.address, version: row.version, created_at: instant(row.created_at), updated_at: instant(row.updated_at) };
}
