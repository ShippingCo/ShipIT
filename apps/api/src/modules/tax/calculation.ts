import type { PricingQuoteDto, TaxCalculationDto, TaxFacts } from '@shippingco/shared';
import { FieldValidationError, HttpError } from '../../plugins/errors.ts';
import { digest } from '../pricing/idempotency.ts';
import type { PolicyRow } from './types.ts';
import { jurisdiction } from './jurisdiction.ts';
import { policy as normalizedPolicy } from './validation.ts';

export function checked(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new FieldValidationError('tax','OUT_OF_RANGE');
  return Number(value);
}
function gcd(a: bigint, b: bigint): bigint { while (b !== 0n) { const remainder = a % b; a = b; b = remainder; } return a; }
function fraction(n: bigint, d: bigint) { const divisor = gcd(n,d); return { n: n/divisor, d: d/divisor }; }

/** One commercial quote is the complete rounding boundary. No floating-point money. */
export function calculate(row: PolicyRow, quote: PricingQuoteDto, facts: TaxFacts,
  binding: { id: string; intentId: string; resolutionId: string|null; expiresAt: string }, now: Date): TaxCalculationDto {
  const p = normalizedPolicy(row.policy), at = now.getTime();
  if (!Number.isFinite(at) || row.state !== 'published' || at < Date.parse(p.effective_from) || at >= Date.parse(p.effective_to)) throw new HttpError('TAX_POLICY_UNAVAILABLE');
  const place = jurisdiction(facts,p.supplier_state);
  const matches = p.rules.filter(r => r.service === quote.inputs.service && r.registration === place.registration && r.jurisdiction === place.jurisdiction);
  if (matches.length !== 1) throw new HttpError('TAX_POLICY_UNAVAILABLE');
  const rule = matches[0]!;
  const lines = { freight: BigInt(quote.freight_paise), packing: BigInt(quote.packing_paise) };
  const preTax = checked(lines.freight + lines.packing);
  if (preTax !== quote.subtotal_paise) throw new HttpError('QUOTE_STALE');
  const basis = rule.taxable_lines.reduce((sum,line) => sum + lines[line],0n);
  const exact = rule.components.map(c => ({ ...c, ...fraction(basis*BigInt(c.numerator),BigInt(c.denominator)) }));
  const sum = exact.reduce((a,b) => fraction(a.n*b.d+b.n*a.d,a.d*b.d),{ n: 0n,d: 1n });
  const total = (sum.n*2n+sum.d)/(sum.d*2n);
  let remaining = total - exact.reduce((a,c) => a+c.n/c.d,0n);
  const allocated = exact.sort((a,b) => {
    const delta = (b.n%b.d)*a.d-(a.n%a.d)*b.d;
    return delta < 0n ? -1 : delta > 0n ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }).map(c => {
    const extra = remaining > 0n ? 1n : 0n; remaining -= extra;
    return { id: c.id, kind: c.kind, numerator: c.numerator, denominator: c.denominator,
      exact_numerator: c.n.toString(), exact_denominator: c.d.toString(), amount_paise: checked(c.n/c.d+extra) };
  }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const before = BigInt(preTax)+total, final = ((before+50n)/100n)*100n;
  const expires = Math.min(Date.parse(binding.expiresAt),Date.parse(quote.expires_at),Date.parse(p.effective_to),at+p.validity_seconds*1000);
  if (!Number.isFinite(expires) || at < Date.parse(quote.created_at) || at >= expires) throw new HttpError('TAX_STALE');
  const value: Omit<TaxCalculationDto,'fingerprint'> = { id: binding.id, proposal: true, intent_id: binding.intentId, quote_id: quote.id,
    policy_id: row.id, policy_version: row.version_number, rule_id: rule.id, resolution_id: binding.resolutionId,
    supplier_state: p.supplier_state, place_of_supply: place.place, jurisdiction: place.jurisdiction, registration: place.registration,
    classification: rule.classification, treatment: rule.treatment, pre_tax_paise: preTax, taxable_basis_paise: checked(basis),
    cgst_paise: allocated.find(c => c.kind === 'CGST')?.amount_paise ?? 0, sgst_paise: allocated.find(c => c.kind === 'SGST')?.amount_paise ?? 0,
    igst_paise: allocated.find(c => c.kind === 'IGST')?.amount_paise ?? 0, tax_total_paise: checked(total), unrounded_payable_paise: checked(before),
    rounding_adjustment_paise: Number(final-before), final_payable_paise: checked(final), components: allocated,
    approval_ref: p.approval_ref, source_ref: p.source_ref, rule_evidence_ref: rule.evidence_ref, allocation: 'largest_remainder_v1',
    time_rule: p.time_rule, proposed_tax_point_at: now.toISOString(), created_at: now.toISOString(), expires_at: new Date(expires).toISOString() };
  return { ...value, fingerprint: digest(value) };
}
