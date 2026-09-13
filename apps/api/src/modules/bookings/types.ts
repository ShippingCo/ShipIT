import type { CustomerSnapshot, PricingQuoteDto, TaxCalculationDto } from '@shippingco/shared';
import type { TenantAccess } from '../security/scope.ts';
import type { ParcelInput } from './validation.ts';
export interface BookingScopes { bookings: TenantAccess; parcels: TenantAccess; customer: TenantAccess; pricing: TenantAccess; tax: TenantAccess; audit: TenantAccess; events: TenantAccess }
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
