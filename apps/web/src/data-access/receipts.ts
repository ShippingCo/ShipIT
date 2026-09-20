import type { ReceiptDto } from '@shippingco/shared';
import { object, uuid, text, integer, instant, choice, array, protocol } from './dto';
import { service, taxEvidence } from './commercial';
import { paymentEntry } from './payments';
import type { ScopedApi } from './scoped-api';
const base = object({ id: uuid, number: text, schema_version: choice(1), version: integer(1), booking_id: uuid, issued_at: instant, currency: choice('INR'),
  issuer: object({ organization_name: text, franchise_name: text, franchise_code: text, supplier_gstin: text, supplier_state: text }),
  booking: object({ customer_name: text, confirmed_at: instant, service, parcels: array(object({ docket: text, weight_grams: integer(1) }), 50) }),
});
export function receiptDto(value: unknown): ReceiptDto {
  const b = base(value), kind = object({ kind: choice('booking_charge', 'collection_acknowledgement', 'collection_reversal') })(value).kind;
  if (!/^RCT-[0-9]{19}$/.test(b.number) || !b.booking.parcels.length) return protocol();
  if (kind === 'booking_charge') {
    const rest = object({ charges: object({ freight_paise: integer(), packing_paise: integer(), tax: object(taxEvidence) }),
      booking_receipt_id: v => v === null ? null : protocol(), correction_of: v => v === null ? null : protocol() })(value);
    if (b.version !== 1) return protocol(); return { ...b, ...rest, kind, version: 1 };
  }
  const rest = object({ entry: paymentEntry, booking_receipt_id: uuid })(value);
  if (kind === 'collection_acknowledgement' && rest.entry.kind === 'collection') {
    object({ correction_of: v => v === null ? null : protocol() })(value);
    return { ...b, ...rest, kind, correction_of: null, entry: { ...rest.entry, kind: 'collection' } };
  }
  if (kind === 'collection_reversal' && rest.entry.kind === 'reversal') return { ...b, ...rest, kind,
    correction_of: object({ correction_of: uuid })(value).correction_of, entry: { ...rest.entry, kind: 'reversal' } };
  return protocol();
}
export function receipts(api: ScopedApi) {
  const read = async (path: string, bookingId?: string, signal?: AbortSignal) => {
    const dto = await api.read(api.path(path), receiptDto, signal);
    if (bookingId && dto.booking_id !== bookingId) return protocol(); return dto;
  };
  return {
    booking: (id: string, signal?: AbortSignal) => read(`/api/v1/bookings/${uuid(id)}/receipt`, id, signal),
    payment: async (bookingId: string, paymentId: string, signal?: AbortSignal) => {
      const dto = await read(`/api/v1/bookings/${uuid(bookingId)}/payments/${uuid(paymentId)}/receipt`, bookingId, signal);
      if (dto.kind === 'booking_charge' || dto.entry.id !== paymentId) return protocol(); return dto;
    },
    byId: async (id: string) => { const dto = await read(`/api/v1/receipts/${uuid(id)}`); if (dto.id !== id) return protocol(); return dto; },
  };
}
