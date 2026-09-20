import type { PaymentCollectionInput, PaymentEntryDto } from '@shippingco/shared';
import { object, uuid, integer, instant, choice, nullable, protocol } from './dto';
import type { ScopedApi } from './scoped-api';
export const paymentEntry: (value: unknown) => PaymentEntryDto = object({ id: uuid, kind: choice('collection', 'reversal'), amount_paise: integer(1), currency: choice('INR'),
  context: choice('paid_counter', 'to_pay'), method: choice('cash', 'upi'), collection_reference: nullable(uuid), reversal_of: nullable(uuid),
  reason_code: nullable(choice('duplicate_recording', 'incorrect_amount', 'collection_not_received')), version: integer(1), occurred_at: instant });
const projection = object({ booking_id: uuid, obligation_id: uuid, currency: choice('INR'), gross_paise: integer(), collected_paise: integer(),
  outstanding_paise: integer(), state: choice('uncollected', 'partially_collected', 'settled'), version: integer() });
export function payments(api: ScopedApi, bookingId: string) {
  const path = api.path(`/api/v1/bookings/${uuid(bookingId)}/payments`);
  const decode = (value: unknown) => { const p = projection(value);
    if (p.booking_id !== bookingId || BigInt(p.collected_paise) + BigInt(p.outstanding_paise) !== BigInt(p.gross_paise)) return protocol(); return p; };
  return {
    collect: (input: PaymentCollectionInput) => api.intent('api.v1.payments.collect', path, input),
    execute: (intent: Parameters<ScopedApi['execute']>[0]) => api.execute(intent, value => {
      const result = object({ payment: decode, entry: paymentEntry })(value);
      const sent = object({ amount_paise: integer(1), context: choice('paid_counter', 'to_pay'), method: choice('cash', 'upi'), collection_reference: uuid })(JSON.parse(intent.bodyJson));
      const e = result.entry;
      if (e.kind !== 'collection' || e.amount_paise !== sent.amount_paise || e.context !== sent.context || e.method !== sent.method || e.collection_reference !== sent.collection_reference || e.reversal_of !== null || e.reason_code !== null) return protocol();
      return result;
    }),
    read: () => api.read(path, decode),
  };
}
