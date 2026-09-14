import type { CustomerSnapshot, PricingQuoteDto, TaxCalculationDto } from '@shippingco/shared';
import type { TenantAccess } from '../security/scope.ts';
import type { ParcelInput } from './validation.ts';
export interface BookingScopes { bookings: TenantAccess; parcels: TenantAccess; customer: TenantAccess; pricing: TenantAccess; tax: TenantAccess; audit: TenantAccess; events: TenantAccess }
export type ParcelStatus = 'booked'|'checked_in'|'dispatched'|'in_transit'|'out_for_delivery'|'failed_attempt'|'held_at_office'|'delivered'|'rto';
export type ParcelSort = 'created_at_desc'|'created_at_asc'|'docket_asc'|'docket_desc';
export interface ParcelFilter {
  organizationId:string;franchiseId:string|null;docket:string|null;status:ParcelStatus|null;
  customerId:string|null;from:string|null;to:string|null;sort:ParcelSort;limit:number;cursor:string|null;
}
export interface ParcelBoundary { value:string;id:string }
export interface ParcelReadRow {
  id:string;booking_id:string;organization_id:string;franchise_id:string;version:number;status:ParcelStatus;custody:string;
  docket:string;weight_grams:string|number;sender_snapshot:CustomerSnapshot;recipient_snapshot:ParcelInput['recipient'];confirmed_at:Date;
}
export interface ParcelReadDto {
  id:string;booking_id:string;version:number;status:ParcelStatus;custody:string;docket:string;weight_grams:number;confirmed_at:string;
  sender:CustomerSnapshot;recipient:ParcelInput['recipient'];
}
export interface TimelineRow { event_id:string;event_type:string;aggregate_sequence:string|number;occurred_at:Date }
export interface TimelineDto { event_id:string;sequence:number;occurred_at:string;code:string;status:ParcelStatus;label:string }
export interface ParcelDto { id: string; version: 1; status: 'booked'; custody: 'awaiting_intake'; docket: string; weight_grams: number; sender: CustomerSnapshot; recipient: ParcelInput['recipient']; event_id: string }
export interface BookingDto {
  id: string; version: 1; state: 'active'; organization_id: string; franchise_id: string; customer: CustomerSnapshot;
  charges: { pricing: Omit<PricingQuoteDto,'fingerprint'>; tax: Omit<TaxCalculationDto,'fingerprint'|'proposal'>; confirmed_at: string };
  payment_obligation: { id: string; currency: 'INR'; total_paise: number; collected_paise: 0; outstanding_paise: number; state: 'uncollected' };
  parcels: ParcelDto[]; event_id: string;
}
export function charges(pricing: PricingQuoteDto, tax: TaxCalculationDto, confirmedAt: string): BookingDto['charges'] {
  const { fingerprint: _pricingFingerprint, ...p } = pricing;
  const { fingerprint: _taxFingerprint, proposal: _proposal, ...t } = tax;
  void _pricingFingerprint; void _taxFingerprint; void _proposal;
  return { pricing: p,tax: t,confirmed_at: confirmedAt };
}
export function obligation(id: string, total: number): BookingDto['payment_obligation'] {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('BOOKING_AMOUNT_INVALID');
  return { id,currency:'INR',total_paise:total,collected_paise:0,outstanding_paise:total,state:'uncollected' };
}

function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T,K> {
  return Object.fromEntries(keys.map(key=>[key,value[key]])) as Pick<T,K>;
}
function party(value: CustomerSnapshot): CustomerSnapshot {
  return pick(value,['source_customer_id','source_customer_version','name','phone','phone_display','address']);
}
/** Explicit public projection on initial response and replay, including nested evidence.
 * Adding private stored columns/JSON fields cannot expand the operator DTO. */
export function bookingDto(value: BookingDto): BookingDto {
  const pricing=value.charges.pricing,tax=value.charges.tax;
  return { ...pick(value,['id','version','state','organization_id','franchise_id','event_id']),customer:party(value.customer),
    charges:{confirmed_at:value.charges.confirmed_at,
      pricing:{...pick(pricing,['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at']),
        policy:pick(pricing.policy,['effective_from','effective_to','quote_validity_seconds','override_tolerance_paise','approval_ref','source_ref']),
        inputs:{...pick(pricing.inputs,['destination_key','service','weight_grams']),...(pricing.inputs.override?{override:pick(pricing.inputs.override,['freight_paise','reason_code'])}:{})},
        breakdown:pick(pricing.breakdown,['calculation','min_weight_grams','max_weight_grams','excluded'])},
      tax:{...pick(tax,['id','intent_id','quote_id','policy_id','policy_version','rule_id','resolution_id','supplier_state','place_of_supply','jurisdiction','registration','classification','treatment','pre_tax_paise','taxable_basis_paise','cgst_paise','sgst_paise','igst_paise','tax_total_paise','unrounded_payable_paise','rounding_adjustment_paise','final_payable_paise','approval_ref','source_ref','rule_evidence_ref','allocation','time_rule','proposed_tax_point_at','created_at','expires_at']),
        components:tax.components.map(c=>pick(c,['id','kind','numerator','denominator','exact_numerator','exact_denominator','amount_paise']))}},
    payment_obligation:pick(value.payment_obligation,['id','currency','total_paise','collected_paise','outstanding_paise','state']),
    parcels:value.parcels.map(p=>({...pick(p,['id','version','status','custody','docket','weight_grams','event_id']),sender:party(p.sender),
      recipient:pick(p.recipient,['name','phone_normalized','phone_display','address'])})) };
}

function safeInteger(value:string|number) {
  const parsed=typeof value==='number'?value:Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error('PARCEL_PROJECTION_INVALID');
  return parsed;
}
export function parcelReadDto(row:ParcelReadRow):ParcelReadDto {
  return {id:row.id,booking_id:row.booking_id,version:row.version,status:row.status,custody:row.custody,docket:row.docket,
    weight_grams:safeInteger(row.weight_grams),confirmed_at:row.confirmed_at.toISOString(),sender:party(row.sender_snapshot),
    recipient:pick(row.recipient_snapshot,['name','phone_normalized','phone_display','address'])};
}
const timelineProjection:Readonly<Record<string,{status:ParcelStatus;label:string}>>={
  'parcel.booked':{status:'booked',label:'Booking received'},'parcel.checked_in':{status:'checked_in',label:'Received at office'},
  'parcel.dispatched':{status:'dispatched',label:'Dispatched'},'parcel.in_transit':{status:'in_transit',label:'In transit'},
  'delivery.attempt_started':{status:'out_for_delivery',label:'Out for delivery'},
  'delivery.attempt_failed':{status:'failed_attempt',label:'Delivery attempt unsuccessful'},
  'delivery.retry_started':{status:'out_for_delivery',label:'Another delivery attempt arranged'},
  'parcel.held_at_office':{status:'held_at_office',label:'Available for collection'},
  'delivery.completed':{status:'delivered',label:'Delivered'},'delivery.collected':{status:'delivered',label:'Collected at office'},
  'parcel.rto_approved':{status:'rto',label:'Return to sender initiated'},
  'delivery.reversed':{status:'held_at_office',label:'Delivery record corrected; available for collection'},
};
export function timelineDto(row:TimelineRow):TimelineDto {
  const projection=timelineProjection[row.event_type];
  if(!projection)throw new Error('TIMELINE_EVENT_UNSUPPORTED');
  return {event_id:row.event_id,sequence:safeInteger(row.aggregate_sequence),occurred_at:row.occurred_at.toISOString(),
    code:row.event_type,status:projection.status,label:projection.label};
}
