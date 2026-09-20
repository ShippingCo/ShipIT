import type { TaxIntentInput } from '@shippingco/shared';
import { object, uuid, text, integer, instant, choice, array, list, protocol } from './dto';
import { taxAmounts } from './commercial';
import type { ScopedApi } from './scoped-api';
export interface BookingInput {
  customer_id: string; expected_customer_version: number; tax_calculation_id: string; tax_intent: TaxIntentInput;
  parcels: { weight_grams: number; docket?: string; recipient: { name: string; phone: string; address: string } }[];
}
const confirmation = object({ id: uuid, version: choice(1), state: choice('active'), organization_id: uuid, franchise_id: uuid,
  customer: object({ source_customer_id: uuid, source_customer_version: integer(1), name: text }),
  charges: object({ confirmed_at: instant, tax: object(taxAmounts) }),
  payment_obligation: object({ id: uuid, currency: choice('INR'), total_paise: integer(), collected_paise: choice(0), outstanding_paise: integer(), state: choice('uncollected') }),
  parcels: array(object({ id: uuid, docket: text, weight_grams: integer(1), status: choice('booked') }), 50),
});
export type BookingConfirmation = ReturnType<typeof confirmation>;
/** A minimum screen projection of BookingDto; unused contact/evidence fields are discarded. */
export function bookings(api: ScopedApi) {
  return {
    create: (body: BookingInput) => api.intent('api.v1.bookings.create', api.path('/api/v1/bookings'), body),
    execute: (intent: Parameters<ScopedApi['execute']>[0]) => api.execute(intent, value => {
      const b = confirmation(value), o = b.payment_obligation;
      const sent = object({ customer_id: uuid, expected_customer_version: integer(1), parcels: array(object({ weight_grams: integer(1) }), 50) })(JSON.parse(intent.bodyJson));
      if (b.organization_id !== api.organization || b.franchise_id !== api.franchise || !b.parcels.length || b.customer.source_customer_id !== sent.customer_id || b.customer.source_customer_version !== sent.expected_customer_version ||
        b.parcels.length !== sent.parcels.length || b.parcels.some((p, i) => p.weight_grams !== sent.parcels[i].weight_grams) ||
        o.total_paise !== b.charges.tax.final_payable_paise || o.outstanding_paise !== o.total_paise) return protocol();
      return b;
    }, ['customer_id', 'expected_customer_version', 'tax_calculation_id', 'weight_grams', 'docket', 'tax', 'tax.jurisdiction', 'name', 'phone', 'address']),
  };
}
const parcelReference = object({ id: uuid, booking_id: uuid, docket: text, confirmed_at: instant });
export type ReceiptReference = ReturnType<typeof parcelReference>;
/** #23 discovery only: no lifecycle, bulk, lot or route operations. */
export function receiptDiscovery(api: ScopedApi) {
  return (docket = '', cursor?: string, signal?: AbortSignal) => api.read(api.path('/api/v1/parcels') + '&' + new URLSearchParams({
    limit: '20', ...(docket ? { docket } : {}), ...(cursor ? { cursor } : {}),
  }).toString().replaceAll('+', '%20'), list(parcelReference), signal);
}
