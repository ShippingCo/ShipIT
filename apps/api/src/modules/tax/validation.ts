import type { TaxPolicyInput, TaxRule, TaxComponent, TaxFacts, TaxIntentInput, TaxResolutionInput, TaxCalculationInput } from '@shippingco/shared';
import { FieldValidationError } from '../../plugins/errors.ts';
import { object, integer, timestamp, quote, uuid } from '../pricing/validation.ts';
export { object, integer, uuid, selection, publish, idempotencyKey, noQuery } from '../pricing/validation.ts';

// State-only pilot. This is an admission boundary, not a claim that other cases are exempt.
const states = new Set('02 03 05 06 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 27 29 30 32 33 36 37'.split(' '));
function invalid(): never { throw new FieldValidationError('tax', 'INVALID_FORMAT'); }
function reference(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value) || value.includes('\n')) invalid();
  return value;
}
function state(value: unknown): string {
  if (typeof value !== 'string' || !states.has(value)) invalid();
  return value;
}
function gstin(value: unknown, location: string | null): string {
  // Regular PAN-based structural validation only; neither checksum nor active-registration verification.
  if (typeof value !== 'string') invalid();
  const normalized = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized) || normalized.length !== 15 ||
    (location !== null && !normalized.startsWith(location))) invalid();
  state(normalized.slice(0, 2));
  return normalized;
}
export function facts(value: unknown): TaxFacts {
  const b = object(value, ['service_recipient_ref','registration','recipient_state','recipient_gstin','handover_state','evidence_ref','special_case']);
  if (!['registered','unregistered','unknown'].includes(b.registration as string) || !['none','unsupported'].includes(b.special_case as string)) invalid();
  const recipient = b.recipient_state === null ? null : state(b.recipient_state);
  const registration = b.registration as TaxFacts['registration'];
  if (registration === 'unregistered' && b.recipient_gstin !== null) invalid();
  return { service_recipient_ref: reference(b.service_recipient_ref), registration, recipient_state: recipient,
    recipient_gstin: b.recipient_gstin === null ? null : gstin(b.recipient_gstin, recipient),
    handover_state: b.handover_state === null ? null : state(b.handover_state),
    evidence_ref: b.evidence_ref === null ? null : reference(b.evidence_ref), special_case: b.special_case as TaxFacts['special_case'] };
}
function component(value: unknown): TaxComponent {
  const b = object(value, ['id','kind','numerator','denominator']);
  if (!['CGST','SGST','IGST'].includes(b.kind as string)) invalid();
  const numerator = integer(b.numerator, 'tax', 1, 1_000_000), denominator = integer(b.denominator, 'tax', 1, 1_000_000);
  if (numerator > denominator) invalid();
  return { id: reference(b.id), kind: b.kind as TaxComponent['kind'], numerator, denominator };
}
function rule(value: unknown): TaxRule {
  const b = object(value, ['id','service','registration','jurisdiction','classification','treatment','evidence_ref','taxable_lines','components']);
  if (!['standard','express','same_city'].includes(b.service as string) || !['registered','unregistered'].includes(b.registration as string) ||
    !['intra','inter'].includes(b.jurisdiction as string) || !['taxable','nil_rated','exempt'].includes(b.treatment as string)) invalid();
  if (!Array.isArray(b.taxable_lines) || b.taxable_lines.length > 2 || new Set(b.taxable_lines).size !== b.taxable_lines.length ||
    b.taxable_lines.some(line => line !== 'freight' && line !== 'packing') || !Array.isArray(b.components) || b.components.length > 2) invalid();
  const components = b.components.map(component).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(components.map(c => c.id)).size !== components.length || new Set(components.map(c => c.kind)).size !== components.length) invalid();
  if (b.treatment === 'taxable') {
    if (!b.taxable_lines.length) invalid();
    if (b.jurisdiction === 'inter') { if (components.length !== 1 || components[0]!.kind !== 'IGST') invalid(); }
    else {
      if (components.length !== 2 || !components.some(c => c.kind === 'CGST') || !components.some(c => c.kind === 'SGST')) invalid();
      const [a,c] = components as [TaxComponent,TaxComponent];
      if (BigInt(a.numerator)*BigInt(c.denominator) !== BigInt(c.numerator)*BigInt(a.denominator)) invalid();
    }
  } else if (components.length !== 0) invalid();
  return { id: reference(b.id), service: b.service as TaxRule['service'], registration: b.registration as TaxRule['registration'],
    jurisdiction: b.jurisdiction as TaxRule['jurisdiction'], classification: reference(b.classification), treatment: b.treatment as TaxRule['treatment'],
    evidence_ref: reference(b.evidence_ref), taxable_lines: [...b.taxable_lines].sort() as TaxRule['taxable_lines'], components };
}
export function policy(value: unknown): TaxPolicyInput {
  const b = object(value, ['effective_from','effective_to','validity_seconds','supplier_state','supplier_gstin','approval_ref','source_ref','time_rule','rules']);
  const from = timestamp(b.effective_from,'effective_from'), to = timestamp(b.effective_to,'effective_to');
  if (Date.parse(from) >= Date.parse(to) || b.time_rule !== 'contemporaneous_v1' || !Array.isArray(b.rules) || b.rules.length < 1 || b.rules.length > 12) invalid();
  const rules = b.rules.map(rule).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(rules.map(r => r.id)).size !== rules.length || new Set(rules.map(r => `${r.service}:${r.registration}:${r.jurisdiction}`)).size !== rules.length) invalid();
  const supplier = state(b.supplier_state);
  return { effective_from: from, effective_to: to, validity_seconds: integer(b.validity_seconds,'tax',1,86400), supplier_state: supplier,
    supplier_gstin: gstin(b.supplier_gstin,supplier), approval_ref: reference(b.approval_ref), source_ref: reference(b.source_ref), time_rule: 'contemporaneous_v1', rules };
}
export function intent(value: unknown): TaxIntentInput {
  const b = object(value,['quote_id','pricing_input','facts']);
  return { quote_id: uuid(b.quote_id,'quote_id'), pricing_input: quote(b.pricing_input), facts: facts(b.facts) };
}
export function resolution(value: unknown): TaxResolutionInput {
  const b = object(value,['intent_id','policy_id','facts','evidence_ref']);
  return { intent_id: uuid(b.intent_id), policy_id: uuid(b.policy_id), facts: facts(b.facts), evidence_ref: reference(b.evidence_ref) };
}
export function calculation(value: unknown): TaxCalculationInput {
  const b = object(value,['intent_id','resolution_id']);
  return { intent_id: uuid(b.intent_id), ...(b.resolution_id === undefined ? {} : { resolution_id: uuid(b.resolution_id) }) };
}
