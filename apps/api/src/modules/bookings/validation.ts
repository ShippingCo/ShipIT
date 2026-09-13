import type { TaxIntentInput } from '@shippingco/shared';
import { FieldValidationError } from '../../plugins/errors.ts';
import { createInput } from '../customers/validation.ts';
import { intent, integer, object, uuid } from '../tax/validation.ts';
export { idempotencyKey, selection } from '../tax/validation.ts';
export const MAX_PARCELS = 50;
export interface ParcelInput { weight_grams: number; docket: string|null; recipient: ReturnType<typeof createInput> }
export interface BookingInput { customer_id: string; expected_customer_version: number; tax_calculation_id: string; tax_intent: TaxIntentInput; parcels: ParcelInput[] }
export function docket(value: unknown): string {
  if (typeof value !== 'string') throw new FieldValidationError('docket','INVALID_TYPE');
  const normalized = value.replace(/^[ \t]+|[ \t]+$/g,'').replace(/[a-z]/g,c => c.toUpperCase());
  if (normalized.length > 32 || !/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/.test(normalized)) throw new FieldValidationError('docket','INVALID_FORMAT');
  return normalized;
}
export function create(value: unknown): BookingInput {
  const b = object(value,['customer_id','expected_customer_version','tax_calculation_id','tax_intent','parcels']);
  if (!Array.isArray(b.parcels) || b.parcels.length < 1 || b.parcels.length > MAX_PARCELS) throw new FieldValidationError('parcels','OUT_OF_RANGE');
  const parcels = b.parcels.map(value => {
    const p = object(value,['weight_grams','docket','recipient']);
    return { weight_grams: integer(p.weight_grams,'weight_grams',1),docket: p.docket === undefined ? null : docket(p.docket),recipient: createInput(p.recipient) };
  });
  const tax = intent(b.tax_intent);
  if (parcels.reduce((sum,p) => sum+BigInt(p.weight_grams),0n) !== BigInt(tax.pricing_input.weight_grams)) throw new FieldValidationError('weight_grams','OUT_OF_RANGE');
  return { customer_id: uuid(b.customer_id,'customer_id'),expected_customer_version: integer(b.expected_customer_version,'expected_customer_version',1,2147483647),
    tax_calculation_id: uuid(b.tax_calculation_id,'tax_calculation_id'),tax_intent: tax,parcels };
}
