import type { PricingQuoteInput, TaxFacts } from '@shippingco/shared';
export const emptyDraft = () => ({
  name: '', phone: '', address: '', recipientName: '', recipientPhone: '', recipientAddress: '',
  serviceOptionId:'', recipientCountry:'IN',recipientPin:'',recipientCity:'',recipientRegion:'',contentsType:'solid',contentsDescription:'',liquidQuantity:'',declaredValue:'',
  destination: '', weight: '', service: '', docket: '', override: '', packing: '', reason: 'customer_agreement',
  // Outside dimensions in whole centimetres. Optional: a parcel that is heavy for its size is
  // priced on the scale and needs none of this. They are counter arithmetic for the chargeable
  // weight and are not sent to the server, which records what the scale actually read.
  lengthCm: '', widthCm: '', heightCm: '',
  // Which unit the operator is typing in. The stored weight is always whole grams; this only
  // decides what the field shows, so switching it never changes the parcel.
  weightUnit: 'kg',
  registration: 'unregistered', recipientState: '', gstin: '', handoverState: '', recipientRef: '', evidenceRef: '',
  specialCase: 'none', paymentMode: 'to_pay', method: '',
  // Counter arithmetic only. It is kept with the draft so a resumed booking still knows what
  // the customer handed over, and it is never part of the booking sent to the server: what was
  // actually received is recorded as a receipt, against its own ledger.
  cashGiven: '',
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
    {
      const dims=[['lengthCm',d.lengthCm],['widthCm',d.widthCm],['heightCm',d.heightCm]] as const;
      if(dims.some(([,value])=>value!=='')){
        for(const [field,value] of dims){
          if(!/^[1-9][0-9]{0,2}$/.test(value))e[field]='Enter all three sides in whole centimetres, 1 to 999.';
        }
      }
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

export type ParcelDraft = Pick<Draft, 'recipientName' | 'recipientPhone' | 'recipientAddress' | 'recipientCountry' | 'recipientPin' | 'recipientCity' | 'recipientRegion' | 'weight' | 'weightUnit' | 'lengthCm' | 'widthCm' | 'heightCm' | 'docket' | 'contentsType' | 'contentsDescription' | 'liquidQuantity' | 'declaredValue'>;
export const emptyParcel = (): ParcelDraft => ({recipientName:'',recipientPhone:'',recipientAddress:'',recipientCountry:'IN',recipientPin:'',recipientCity:'',recipientRegion:'',weight:'',weightUnit:'kg',lengthCm:'',widthCm:'',heightCm:'',docket:'',contentsType:'solid',contentsDescription:'',liquidQuantity:'',declaredValue:''});
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
const optionalForBooking = ['recipientRef', 'evidenceRef', 'handoverState', 'recipientState', 'gstin', 'specialCase', 'method', 'cashGiven'] as const;

/** Short, concrete words for what is still missing. Shown to the operator, so no field names. */
const needLabels: Partial<Record<Field, string>> = {
  name: 'customer name', phone: 'phone number', address: 'customer address',
  recipientName: 'receiver name', recipientPhone: 'receiver phone', recipientAddress: 'delivery address',
  recipientCountry: 'delivery country', recipientPin: 'PIN code', recipientCity: 'receiver city',
  recipientRegion: 'receiver state', contentsType: 'what is inside', contentsDescription: 'what is inside',
  liquidQuantity: 'liquid quantity', declaredValue: 'declared value',
  docket: 'docket number', service: 'delivery service', destination: 'destination',
  weight: 'weight', packing: 'packing amount', override: 'freight amount',
  lengthCm: 'parcel size', widthCm: 'parcel size', heightCm: 'parcel size',
};

/**
 * What stops this form from becoming a real booking with dockets, in the operator's words.
 * An empty list means "Save booking" will produce parcels; anything else means the counter can
 * only keep a draft, and the operator is told exactly that before pressing the button.
 */
/**
 * What is still missing, each item carrying the field it belongs to.
 *
 * The counter used to render these as a sentence — "Needs: customer name, phone number,
 * docket number" — which tells an operator what is wrong but not where it is. On a form this
 * long that is a hunt. Returning the field key lets the counter make each one a press that
 * moves the cursor to the field.
 */
export interface BookingNeed { field: Field | null; label: string }
export function bookingNeedFields(draft: Draft, additional: ParcelDraft[], priced: boolean): BookingNeed[] {
  const errors = validate(draft, 'booking');
  for (const key of optionalForBooking) delete errors[key];
  const needs: BookingNeed[] = [];
  for (const [field, label] of Object.entries(needLabels)) {
    if (errors[field as Field] && !needs.some(need => need.label === label)) needs.push({ field: field as Field, label });
  }
  additionalParcelErrors(draft, additional).forEach((parcel, index) => {
    if (Object.values(parcel).some(Boolean)) needs.push({ field: null, label: `details for parcel ${index + 2}` });
  });
  if (!priced) needs.push({ field: 'override', label: 'a price' });
  return needs;
}

export function bookingNeeds(draft: Draft, additional: ParcelDraft[], priced: boolean): string[] {
  return bookingNeedFields(draft, additional, priced).map(need => need.label);
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
/**
 * Cubic centimetres that count as one kilogram. Shop-wide, not per-carrier — see the PRD's Q3.
 * 5000 is the figure every Indian surface network this product talks to publishes.
 */
export const volumetricDivisor = 5000;

export interface BilledWeight { grams: string; basis: 'actual' | 'size'; actual: string; volumetric: string | null }

/**
 * What the parcel is charged on.
 *
 * A courier bills the greater of what the scale reads and what the parcel takes up on the
 * vehicle. The operator is never shown the division: they are shown the number that won and
 * told which of the two it was, because that is the sentence they have to say to a customer
 * who is looking at a light box and a large price.
 */
export function billedWeight(parcel: Pick<ParcelDraft,'weight'|'lengthCm'|'widthCm'|'heightCm'>): BilledWeight | null {
  if (!/^[1-9][0-9]*$/.test(parcel.weight) || !Number.isSafeInteger(Number(parcel.weight))) return null;
  const actual = BigInt(parcel.weight);
  const sides = [parcel.lengthCm, parcel.widthCm, parcel.heightCm];
  if (!sides.every(side => /^[1-9][0-9]{0,2}$/.test(side))) return { grams: String(actual), basis: 'actual', actual: String(actual), volumetric: null };
  const divisor = BigInt(volumetricDivisor);
  // Rounded up to the next whole gram: a part gram is never given away, and never charged twice.
  const volumetric = (sides.reduce((product, side) => product * BigInt(side), 1000n) + divisor - 1n) / divisor;
  const grams = volumetric > actual ? volumetric : actual;
  if (grams > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { grams: String(grams), basis: volumetric > actual ? 'size' : 'actual', actual: String(actual), volumetric: String(volumetric) };
}

/** Chargeable grams for the whole booking. Empty when any parcel cannot be weighed or totalled. */
export function totalWeight(first: Draft, additional: ParcelDraft[]): string {
  const billed = [first, ...additional].map(billedWeight);
  if (billed.some(value => value === null)) return '';
  const total = billed.reduce((sum, value) => sum + BigInt(value!.grams), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? String(total) : '';
}
