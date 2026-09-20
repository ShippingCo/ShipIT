import type { PricingQuoteInput, TaxIntentInput, TaxCalculationDto } from '@shippingco/shared';
import { object, uuid, text, integer, instant, choice, nullable, array } from './dto';
import type { ScopedApi } from './scoped-api';
export const service = choice('standard', 'express', 'same_city');
export const quoteDto = object({ id: uuid, proposal: choice(true), rate_version_id: uuid, rate_version_number: integer(1), rule_id: uuid,
  freight_suggestion_paise: integer(), freight_paise: integer(), packing_paise: integer(), variance_paise: integer(),
  subtotal_paise: integer(), override_status: choice('none', 'within_tolerance', 'privileged'), expires_at: instant });
export type Quote = ReturnType<typeof quoteDto>;
export const taxAmounts = {
  pre_tax_paise: integer(), taxable_basis_paise: integer(), cgst_paise: integer(), sgst_paise: integer(), igst_paise: integer(),
  tax_total_paise: integer(), unrounded_payable_paise: integer(), rounding_adjustment_paise: integer(-99), final_payable_paise: integer(),
};
export const taxEvidence = {
  policy_id: uuid, policy_version: integer(1), rule_id: text, classification: text, treatment: choice('taxable', 'nil_rated', 'exempt'),
  supplier_state: text, place_of_supply: text, jurisdiction: choice('intra', 'inter'), ...taxAmounts,
  components: array(object({ id: text, kind: choice('CGST', 'SGST', 'IGST'), numerator: integer(1), denominator: integer(1),
    exact_numerator: text, exact_denominator: text, amount_paise: integer() }), 2), allocation: choice('largest_remainder_v1'),
};
export const taxDto: (value: unknown) => TaxCalculationDto = object({ ...taxEvidence,
  id: uuid, proposal: choice(true), intent_id: uuid, quote_id: uuid, resolution_id: nullable(uuid), registration: choice('registered', 'unregistered'),
  approval_ref: text, source_ref: text, rule_evidence_ref: text, time_rule: choice('contemporaneous_v1'),
  proposed_tax_point_at: instant, created_at: instant, expires_at: instant, fingerprint: text,
});
export const taxIntentDto = object({ id: uuid, quote_id: uuid, fingerprint: text, created_at: instant, expires_at: instant,
  jurisdiction_status: choice('known', 'resolution_required') });
export function commercial(api: ScopedApi) {
  return {
    quote: (input: PricingQuoteInput) => api.intent('api.v1.pricing.quote', api.path('/api/v1/pricing/quote'), input),
    prepare: (input: TaxIntentInput) => api.intent('api.v1.tax.prepare', api.path('/api/v1/tax/intents'), input),
    calculate: (intentId: string) => api.intent('api.v1.tax.calculate', api.path('/api/v1/tax/calculations'), { intent_id: uuid(intentId) }),
    executeQuote: (intent: Parameters<ScopedApi['execute']>[0]) => api.execute(intent, quoteDto, ['destination_key', 'service', 'weight_grams', 'freight_paise', 'reason_code']),
    executePrepare: (intent: Parameters<ScopedApi['execute']>[0]) => api.execute(intent, taxIntentDto, ['tax', 'tax.jurisdiction']),
    executeCalculation: (intent: Parameters<ScopedApi['execute']>[0]) => api.execute(intent, taxDto, ['tax', 'tax.jurisdiction']),
  };
}
