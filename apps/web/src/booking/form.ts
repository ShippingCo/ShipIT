import type { PricingQuoteInput, TaxFacts } from '@shippingco/shared';
export const emptyDraft = () => ({
  name: '', phone: '', address: '', recipientName: '', recipientPhone: '', recipientAddress: '',
  destination: '', weight: '', service: 'standard', docket: '', override: '', reason: 'customer_agreement',
  registration: 'unregistered', recipientState: '', gstin: '', handoverState: '', recipientRef: '', evidenceRef: '',
  specialCase: 'none', paymentMode: 'to_pay', method: '',
});
export type Draft = ReturnType<typeof emptyDraft>;
export type Field = keyof Draft;
export type Errors = Partial<Record<Field, string>>;
export const commercialFields: Field[] = ['destination', 'weight', 'service', 'override', 'reason', 'registration', 'recipientState', 'gstin', 'handoverState', 'recipientRef', 'evidenceRef', 'specialCase'];
export function validPhone(value: string) {
  const display = value.replace(/^ +| +$/g, '');
  return value.length <= 40 && /^\+[1-9][0-9]*(?:[ -][0-9]+)*$/.test(display) && /^\+[1-9][0-9]{7,14}$/.test(display.replace(/[ -]/g, ''));
}
const validText = (value: string, max: number, required: boolean) => (!required || !!value.trim()) && [...value.trim()].length <= max &&
  ![...value].some(c => { const n = c.codePointAt(0)!; return n < 32 || (n >= 127 && n <= 159) || (n >= 0xd800 && n <= 0xdfff); });
export function validate(d: Draft, section: 'customer' | 'commercial' | 'booking'): Errors {
  const e: Errors = {};
  if (section === 'customer' || section === 'booking') {
    if (!validText(d.name, 120, true)) e.name = 'Enter a customer name, up to 120 characters.';
    if (!validPhone(d.phone)) e.phone = 'Use an international number, for example +1 202-555-0100.';
    if (!validText(d.address, 500, false)) e.address = 'Use a single-line address up to 500 characters.';
  }
  if (section === 'booking') {
    if (!validText(d.recipientName, 120, true)) e.recipientName = 'Enter the recipient name.';
    if (!validPhone(d.recipientPhone)) e.recipientPhone = 'Enter an international recipient number.';
    if (!validText(d.recipientAddress, 500, false)) e.recipientAddress = 'Use a single-line address up to 500 characters.';
    const docket = d.docket.replace(/^[ \t]+|[ \t]+$/g, '').toUpperCase();
    if (d.docket && (docket.length > 32 || !/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/.test(docket))) e.docket = 'Use up to 32 letters, digits and internal hyphens, or leave blank for allocation.';
    if (d.paymentMode === 'paid_counter' && !['cash', 'upi'].includes(d.method)) e.method = 'Select how the payment was received.';
  }
  if (section !== 'customer') {
    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(d.destination)) e.destination = 'Enter the configured destination key.';
    if (!/^[1-9][0-9]*$/.test(d.weight) || !Number.isSafeInteger(Number(d.weight))) e.weight = 'Enter a positive whole number of grams.';
    if (d.override && (!/^(0|[1-9][0-9]*)$/.test(d.override) || !Number.isSafeInteger(Number(d.override)))) e.override = 'Enter whole paise, zero or greater.';
    for (const key of ['recipientRef', 'evidenceRef'] as const) if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(d[key])) e[key] = 'Enter the actual record reference (letters, digits, colon, underscore or hyphen).';
    if (d.registration === 'registered' && !d.recipientState) e.recipientState = 'Select the registered service recipient state.';
    if (d.registration === 'registered' && (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(d.gstin.trim().toUpperCase()) || !d.gstin.trim().startsWith(d.recipientState))) e.gstin = 'Enter a regular GSTIN matching that state. Server validation is required.';
    if (d.registration === 'unregistered' && !d.handoverState && !d.recipientState) e.handoverState = 'Supply the actual handover state or service recipient state.';
    if (d.specialCase !== 'none') e.specialCase = 'This tax case needs authorized review; booking cannot be confirmed here.';
  }
  return e;
}
export function pricingInput(d: Draft): PricingQuoteInput {
  return { destination_key: d.destination, service: d.service as PricingQuoteInput['service'], weight_grams: Number(d.weight),
    ...(d.override ? { override: { freight_paise: Number(d.override), reason_code: d.reason as NonNullable<PricingQuoteInput['override']>['reason_code'] } } : {}) };
}
export function taxFacts(d: Draft): TaxFacts {
  return { service_recipient_ref: d.recipientRef, registration: d.registration as TaxFacts['registration'], recipient_state: d.recipientState || null,
    recipient_gstin: d.registration === 'registered' ? d.gstin.trim().toUpperCase() : null, handover_state: d.handoverState || null,
    evidence_ref: d.evidenceRef || null, special_case: d.specialCase as TaxFacts['special_case'] };
}
