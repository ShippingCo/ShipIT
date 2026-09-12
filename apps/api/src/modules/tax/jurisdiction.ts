import type { TaxFacts, TaxRegistration } from '@shippingco/shared';
import { FieldValidationError } from '../../plugins/errors.ts';
export function placeOfSupply(facts: TaxFacts): { place: string; registration: TaxRegistration } {
  const place = facts.registration === 'registered' ? facts.recipient_state : facts.registration === 'unregistered' ? facts.handover_state : null;
  if (facts.special_case !== 'none' || !facts.evidence_ref || !place || facts.registration === 'unknown' ||
    (facts.registration === 'registered' && !facts.recipient_gstin)) throw new FieldValidationError('tax.jurisdiction','REQUIRED');
  return { place, registration: facts.registration };
}
export function jurisdiction(facts: TaxFacts, supplier: string): { place: string; registration: TaxRegistration; jurisdiction: 'intra'|'inter' } {
  const resolved = placeOfSupply(facts);
  return { ...resolved,jurisdiction: resolved.place === supplier ? 'intra' : 'inter' };
}
