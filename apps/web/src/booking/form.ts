import type { PricingQuoteInput, TaxFacts } from '@shippingco/shared';
export const emptyDraft = () => ({
  name: '', phone: '', address: '', recipientName: '', recipientPhone: '', recipientAddress: '',
  serviceOptionId:'', recipientCountry:'IN',recipientPin:'',recipientCity:'',recipientRegion:'',contentsType:'solid',contentsDescription:'',liquidQuantity:'',declaredValue:'',
  destination: '', weight: '', service: 'standard', docket: '', override: '', packing: '', reason: 'customer_agreement',
  registration: 'unregistered', recipientState: '', gstin: '', handoverState: '', recipientRef: '', evidenceRef: '',
  specialCase: 'none', paymentMode: 'to_pay', method: '',
});
export type Draft = ReturnType<typeof emptyDraft>;
export type Field = keyof Draft;
export type Errors = Partial<Record<Field, string>>;
export const commercialFields: Field[] = ['serviceOptionId', 'destination', 'weight', 'service', 'override', 'packing', 'reason', 'registration', 'recipientState', 'gstin', 'handoverState', 'recipientRef', 'evidenceRef', 'specialCase'];
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
    if (!validPhone(d.phone)) e.phone = 'Choose the country code and enter the phone number, or paste the full number with +.';
    if (!validText(d.address, 500, false)) e.address = 'Use a single-line address up to 500 characters.';
  }
  if (section === 'booking') {
    if (!validText(d.recipientName, 120, false)) e.recipientName = 'Use a single-line name up to 120 characters.';
    if (d.recipientPhone.trim() && !validPhone(d.recipientPhone)) e.recipientPhone = 'Choose the country code and enter the receiver’s phone number.';
    if (!validText(d.recipientAddress, 500, false)) e.recipientAddress = 'Use a single-line address up to 500 characters.';
    if(d.recipientCountry!=='IN')e.recipientCountry='Only India is supported for this booking.';
    if(d.recipientPin||d.recipientCity||d.recipientRegion||d.contentsDescription||d.liquidQuantity||d.contentsType!=='solid'){
    if(!/^[1-9][0-9]{5}$/.test(d.recipientPin))e.recipientPin='Enter a six-digit PIN code.';
    if(!validText(d.recipientCity,80,true))e.recipientCity='Enter the receiver city.';
    if(!validText(d.recipientRegion,80,true))e.recipientRegion='Enter the receiver state.';
    if(!validText(d.recipientAddress,500,true))e.recipientAddress='Enter the delivery address.';
    if(!validText(d.contentsDescription,200,true))e.contentsDescription='Enter a short contents description.';
    if(!['solid','documents','liquid','semi_liquid','other'].includes(d.contentsType))e.contentsType='Choose a contents type.';
    if(['liquid','semi_liquid'].includes(d.contentsType)&&(!/^[1-9][0-9]*$/.test(d.liquidQuantity)||Number(d.liquidQuantity)>100000000))e.liquidQuantity='Enter a positive quantity up to 100,000 litres, with up to three decimal places.';
    }
    if(d.declaredValue&&(!/^(0|[1-9][0-9]*)$/.test(d.declaredValue)||!Number.isSafeInteger(Number(d.declaredValue))))e.declaredValue='Enter zero or a positive amount with up to two decimal places.';
    const docket = d.docket.replace(/^[ \t]+|[ \t]+$/g, '').toUpperCase();
    if (!docket) e.docket = 'Enter the docket number on this parcel.';
    else if (docket.length > 32 || !/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/.test(docket)) e.docket = 'Use up to 32 letters, numbers or hyphens. Start and end with a letter or number.';
    if (d.paymentMode === 'paid_counter' && !['cash', 'upi'].includes(d.method)) e.method = 'Select how the payment was received.';
  }
  if (section !== 'customer') {
    if(!['standard','express','same_city'].includes(d.service))e.service='Choose a delivery service.';
    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(d.destination)) e.destination = 'Enter a destination city using letters, numbers or spaces.';
    if (!/^[1-9][0-9]*$/.test(d.weight) || !Number.isSafeInteger(Number(d.weight))) e.weight = 'Enter a positive whole number of grams.';
    if (d.packing && (!/^(0|[1-9][0-9]*)$/.test(d.packing) || !Number.isSafeInteger(Number(d.packing)))) e.packing = 'Enter zero or a positive packing amount.';
    if(d.packing!==''&&d.override==='')e.override='Enter the freight amount as well as packing.';
    if (d.override && (!/^(0|[1-9][0-9]*)$/.test(d.override) || !Number.isSafeInteger(Number(d.override)))) e.override = 'Enter whole paise, zero or greater.';
    for (const key of ['recipientRef', 'evidenceRef'] as const) if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(d[key])) e[key] = 'Enter the actual record reference (letters, digits, colon, underscore or hyphen).';
    if (d.registration === 'registered' && !d.recipientState) e.recipientState = 'Select the registered service recipient state.';
    if (d.registration === 'registered' && (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(d.gstin.trim().toUpperCase()) || !d.gstin.trim().startsWith(d.recipientState))) e.gstin = 'Enter a regular GSTIN matching that state. Server validation is required.';
    if (d.registration === 'unregistered' && !d.handoverState && !d.recipientState) e.handoverState = 'Supply the actual handover state or service recipient state.';
    if (d.specialCase !== 'none') e.specialCase = 'This tax case needs authorized review; booking cannot be confirmed here.';
  }
  return e;
}
export function pricingInput(d: Draft, account=false): PricingQuoteInput {
  return { ...(d.serviceOptionId?{service_option_id:d.serviceOptionId}:{}),destination_key: d.destination, service: d.service as PricingQuoteInput['service'], weight_grams: Number(d.weight),
    ...(d.override!==''&&!d.serviceOptionId&&!account?{charges:{freight_paise:Number(d.override),packing_paise:Number(d.packing||'0')}}:d.override ? { override: { freight_paise: Number(d.override), ...(d.packing!==''?{packing_paise:Number(d.packing)}:{}), reason_code: d.reason as NonNullable<PricingQuoteInput['override']>['reason_code'] } } : {}) };
}
export function taxFacts(d: Draft): TaxFacts {
  return { service_recipient_ref: d.recipientRef, registration: d.registration as TaxFacts['registration'], recipient_state: d.recipientState || null,
    recipient_gstin: d.registration === 'registered' ? d.gstin.trim().toUpperCase() : null, handover_state: d.handoverState || null,
    evidence_ref: d.evidenceRef || null, special_case: d.specialCase as TaxFacts['special_case'] };
}

export type ParcelDraft = Pick<Draft, 'recipientName' | 'recipientPhone' | 'recipientAddress' | 'recipientCountry' | 'recipientPin' | 'recipientCity' | 'recipientRegion' | 'weight' | 'docket' | 'contentsType' | 'contentsDescription' | 'liquidQuantity' | 'declaredValue'>;
export const emptyParcel = (): ParcelDraft => ({recipientName:'',recipientPhone:'',recipientAddress:'',recipientCountry:'IN',recipientPin:'',recipientCity:'',recipientRegion:'',weight:'',docket:'',contentsType:'solid',contentsDescription:'',liquidQuantity:'',declaredValue:''});
export const receiverFields = ['recipientName','recipientPhone','recipientAddress','recipientCountry','recipientPin','recipientCity','recipientRegion'] as const;
/**
 * A draft's own number, short enough to read out on the phone or write in a paper book,
 * instead of showing the operator a 36-character identifier they cannot use.
 *
 * Derived from the record's identifier, so it is stable and needs no storage, but it is a
 * one-way shortening, not a replacement: the full identifier stays authoritative for support
 * and for every request. Letters that are misread when spoken or handwritten (I, O) are
 * excluded. Two drafts in one franchise's list of at most 100 colliding is ~3 in a million.
 */
export function draftCode(id: string): string {
  const source = id.replace(/-/g, '').toUpperCase();
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
  let value = 0n;
  for (const character of source.slice(0, 12)) value = value * 16n + BigInt(parseInt(character, 16) || 0);
  let code = '';
  for (let i = 0; i < 6; i++) { code = alphabet[Number(value % 34n)] + code; value /= 34n; }
  return 'D-' + code;
}

/**
 * Fields a real booking needs but a draft does not. They are excluded from the "can this be
 * booked" question so a missing tax detail does not read to the operator as a missing parcel.
 */
const optionalForBooking = ['recipientRef', 'evidenceRef', 'handoverState', 'recipientState', 'gstin', 'specialCase', 'method'] as const;

/** Short, concrete words for what is still missing. Shown to the operator, so no field names. */
const needLabels: Partial<Record<Field, string>> = {
  name: 'customer name', phone: 'phone number', address: 'customer address',
  recipientName: 'receiver name', recipientPhone: 'receiver phone', recipientAddress: 'delivery address',
  recipientCountry: 'delivery country', recipientPin: 'PIN code', recipientCity: 'receiver city',
  recipientRegion: 'receiver state', contentsType: 'what is inside', contentsDescription: 'what is inside',
  liquidQuantity: 'liquid quantity', declaredValue: 'declared value',
  docket: 'docket number', service: 'delivery service', destination: 'destination',
  weight: 'weight', packing: 'packing amount', override: 'freight amount',
};

/**
 * What stops this form from becoming a real booking with dockets, in the operator's words.
 * An empty list means "Save booking" will produce parcels; anything else means the counter can
 * only keep a draft, and the operator is told exactly that before pressing the button.
 */
export function bookingNeeds(draft: Draft, additional: ParcelDraft[], priced: boolean): string[] {
  const errors = validate(draft, 'booking');
  for (const key of optionalForBooking) delete errors[key];
  const needs: string[] = [];
  for (const [field, label] of Object.entries(needLabels)) {
    if (errors[field as Field] && !needs.includes(label)) needs.push(label);
  }
  additionalParcelErrors(draft, additional).forEach((parcel, index) => {
    if (Object.values(parcel).some(Boolean)) needs.push(`details for parcel ${index + 2}`);
  });
  if (!priced) needs.push('a price');
  return needs;
}

export function parcelErrors(parcel: ParcelDraft): Errors {
  const errors = validate({...emptyDraft(), ...parcel}, 'booking');
  const fields=emptyParcel();
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key in fields)) as Errors;
}
export function additionalParcelErrors(first: Draft, parcels: ParcelDraft[]): Errors[] {
  const seen = new Set([first.docket.trim().toUpperCase()]);
  return parcels.map(parcel => {
    const errors = parcelErrors(parcel);
    const docket = parcel.docket.trim().toUpperCase();
    if (docket && seen.has(docket)) errors.docket = 'Another parcel in this booking already has this docket number.';
    seen.add(docket);
    return errors;
  });
}
export function totalWeight(first: Draft, additional: ParcelDraft[]): string {
  const weights = [first, ...additional].map(p => p.weight);
  if(weights.some(w => !/^[1-9][0-9]*$/.test(w))) return '';
  const total = weights.reduce((sum,w) => sum + BigInt(w), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? String(total) : '';
}
