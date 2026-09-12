import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { TaxFacts, TaxPolicyInput, TaxIntentInput } from '@shippingco/shared';
import { pricingSetup, input, start } from './pricing-support.ts';
import { org, A } from './audit-support.ts';
import { createTaxService } from '../src/modules/tax/service.ts';
export const taxPolicy: TaxPolicyInput = { effective_from: start,effective_to: '2099-01-02T00:00:00Z',validity_seconds: 300,
  supplier_state: '27',supplier_gstin: '27ABCDE1234F1Z5',approval_ref: 'SYN_APPROVAL',source_ref: 'SYN_SOURCE',time_rule: 'contemporaneous_v1',
  rules: [{ id: 'SYN_RULE',service: 'standard',registration: 'unregistered',jurisdiction: 'intra',classification: 'SYN_CLASS',treatment: 'taxable',
    evidence_ref: 'SYN_RULE_EVIDENCE',taxable_lines: ['freight','packing'],components: [
      { id: 'C',kind: 'CGST',numerator: 1,denominator: 40 },{ id: 'S',kind: 'SGST',numerator: 1,denominator: 40 }] }] };
export const taxFacts: TaxFacts = { service_recipient_ref: 'SYN_BUYER',registration: 'unregistered',recipient_state: null,recipient_gstin: null,
  handover_state: '27',evidence_ref: 'SYN_HANDOVER',special_case: 'none' };
export const taxPath = (franchise = A,organization = org) => `/api/v1/organizations/${organization}/franchises/${franchise}/tax/versions`;
export async function taxSetup(t: TestContext) {
  const s = await pricingSetup(t); await s.db.prepareTax();
  const tax = createTaxService(s.pool,s.clock);
  const post = (path: string,body: unknown,token = s.operator.token,key = randomUUID(),franchise = A,organization = org) => s.app.inject({ method: 'POST',
    url: '/api/v1/tax/'+path+'?'+new URLSearchParams({ organization_id: organization,franchise_id: franchise }),
    headers: { ...s.headers,'idempotency-key': key },cookies: s.cookies(token),payload: JSON.stringify(body) });
  async function published() {
    await s.published();
    const p = await tax.create(s.local.token,org,A,randomUUID(),taxPolicy,randomUUID());
    const result = await tax.publish(s.local.token,org,A,p.id,randomUUID(),{ expected_version: 1 },randomUUID());
    s.setNow(start); return result;
  }
  async function prepared(facts: TaxFacts = taxFacts) {
    const quote = (await s.quote()).json();
    const body: TaxIntentInput = { quote_id: quote.id,pricing_input: input,facts };
    const response = await post('intents',body); if (response.statusCode !== 200) throw new Error('SYN_INTENT_FAILED_'+response.body);
    return { body,intent: response.json() as { id: string },quote };
  }
  return { ...s,tax,post,published,prepared };
}
