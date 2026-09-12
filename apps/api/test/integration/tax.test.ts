import { expect, it } from 'vitest';
import type { TaxFacts, TaxPolicyInput } from '@shippingco/shared';
import { policy, facts, intent } from '../../src/modules/tax/validation.ts';
import { calculate } from '../../src/modules/tax/calculation.ts';
import { calculate as price } from '../../src/modules/pricing/calculation.ts';
import type { PolicyRow } from '../../src/modules/tax/types.ts';
import { draft, input, start } from '../pricing-support.ts';

const fixture: TaxPolicyInput = { effective_from: start, effective_to: '2099-01-02T00:00:00Z', validity_seconds: 300,
  supplier_state: '27', supplier_gstin: '27ABCDE1234F1Z5', approval_ref: 'SYN_APPROVAL', source_ref: 'SYN_SOURCE', time_rule: 'contemporaneous_v1',
  rules: [{ id: 'SYN_RULE', service: 'standard', registration: 'unregistered', jurisdiction: 'intra', classification: 'SYN_COURIER',
    treatment: 'taxable', evidence_ref: 'SYN_RULE_EVIDENCE', taxable_lines: ['freight','packing'], components: [
      { id: 'A', kind: 'CGST', numerator: 1, denominator: 40 }, { id: 'B', kind: 'SGST', numerator: 1, denominator: 40 }] }] };
const observed: TaxFacts = { service_recipient_ref: 'SYN_BUYER', registration: 'unregistered', recipient_state: null,
  recipient_gstin: null, handover_state: '27', evidence_ref: 'SYN_HANDOVER', special_case: 'none' };
function run(freight: number, packing = 0, config: TaxPolicyInput = fixture, evidence = observed) {
  const quote = price({ ...draft, id: 'version', card_id: 'card', version: 2, version_number: 1, state: 'published',
    created_at: start, published_at: start, published_by: 'actor', rules: [{ ...draft.rules[0]!, id: 'rule', freight_paise: freight, packing_paise: packing }] },input,new Date(start),'quote','actor',false);
  const row: PolicyRow = { id: 'policy', revision: 2, version_number: 1, state: 'published', policy: policy(config) };
  return calculate(row,quote,facts(evidence),{ id: 'calculation', intentId: 'intent', resolutionId: null, expiresAt: quote.expires_at },new Date(start));
}
it('allocates an odd paise deterministically and reconciles once at the booking boundary', () => {
  const result = run(10101);
  expect([result.cgst_paise,result.sgst_paise,result.tax_total_paise,result.rounding_adjustment_paise,result.final_payable_paise]).toEqual([253,252,505,-6,10600]);
  const reordered = structuredClone(fixture); reordered.rules[0]!.components.reverse(); reordered.rules[0]!.taxable_lines.reverse();
  expect(run(10101,0,reordered)).toEqual(result);
});
it('supports explicit inter-state and zero treatment without substituting delivery destination', () => {
  const inter = structuredClone(fixture); inter.rules[0]!.jurisdiction = 'inter'; inter.rules[0]!.components = [{ id: 'I',kind: 'IGST',numerator: 1,denominator: 20 }];
  expect(run(10101,0,inter,{ ...observed,handover_state: '29' }).igst_paise).toBe(505);
  for (const treatment of ['nil_rated','exempt'] as const) {
    const zero = structuredClone(fixture); zero.rules[0]!.treatment = treatment; zero.rules[0]!.components = [];
    const result = run(49,49,zero);
    expect([result.tax_total_paise,result.final_payable_paise,result.rounding_adjustment_paise,result.treatment]).toEqual([0,100,2,treatment]);
    expect(() => run(49,49,zero,{ ...observed,handover_state: null })).toThrow('VALIDATION_FAILED');
  }
});
it('separates the taxable basis from commercial total and bounds arithmetic', () => {
  const mixed = structuredClone(fixture); mixed.rules[0]!.taxable_lines = ['freight'];
  const result = run(10000,1000,mixed);
  expect([result.pre_tax_paise,result.taxable_basis_paise,result.tax_total_paise,result.final_payable_paise]).toEqual([11000,10000,500,11500]);
  expect(() => run(Number.MAX_SAFE_INTEGER)).toThrow('VALIDATION_FAILED');
  for (let paise = 0; paise < 300; paise++) {
    const r = run(paise);
    expect(r.cgst_paise+r.sgst_paise+r.igst_paise).toBe(r.tax_total_paise);
    expect(r.pre_tax_paise+r.tax_total_paise+r.rounding_adjustment_paise).toBe(r.final_payable_paise);
    expect(r.rounding_adjustment_paise).toBeGreaterThanOrEqual(-49);
    expect(r.rounding_adjustment_paise).toBeLessThanOrEqual(50);
  }
});
it('rejects ambiguous, unsupported and browser-computed inputs', () => {
  expect(() => policy({ ...fixture,rules: [...fixture.rules,...fixture.rules] })).toThrow('VALIDATION_FAILED');
  expect(() => policy({ ...fixture,supplier_state: '04' })).toThrow('VALIDATION_FAILED');
  expect(() => facts({ ...observed,recipient_gstin: fixture.supplier_gstin })).toThrow('VALIDATION_FAILED');
  expect(() => run(100,0,fixture,{ ...observed,special_case: 'unsupported' })).toThrow('VALIDATION_FAILED');
  expect(() => intent({ quote_ids: [], tax_total_paise: 0 })).toThrow('VALIDATION_FAILED');
});
it('reproduces M01, M04 and M06 contract fixtures and large safe integer arithmetic', () => {
  const ten = structuredClone(fixture); ten.rules[0]!.components.forEach(c => { c.denominator = 20; });
  const m1 = run(10101,0,ten);
  expect([m1.cgst_paise,m1.sgst_paise,m1.tax_total_paise,m1.final_payable_paise]).toEqual([505,505,1010,11100]);
  const zero = structuredClone(fixture); zero.rules[0]!.treatment = 'exempt'; zero.rules[0]!.components = [];
  expect(run(10101,0,zero).final_payable_paise).toBe(10100);
  expect([12549,12550,12551].map(n => run(n,0,zero).final_payable_paise)).toEqual([12500,12600,12600]);
  const large = run(4_000_000_000_000_001);
  expect(large.tax_total_paise).toBe(Number((4_000_000_000_000_001n+10n)/20n));
  expect(large.components.reduce((sum,c) => sum+BigInt(c.amount_paise),0n)).toBe(BigInt(large.tax_total_paise));
});
