import { randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import type { TaxIntentInput, TaxIntentDto, TaxResolutionDto, TaxCalculationDto } from '@shippingco/shared';
import { withTaxTenantScope } from '../memberships/service.ts';
import { assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { validatePricingSnapshot } from '../pricing/service.ts';
import { quote as storedQuote } from '../pricing/repository.ts';
import { digest, keyDigest } from '../pricing/idempotency.ts';
import { FieldValidationError, HttpError } from '../../plugins/errors.ts';
import { policyDto, type TaxAction, type TaxOperation, type TaxResult, type IntentRow } from './types.ts';
import { calculate } from './calculation.ts';
import { jurisdiction, placeOfSupply } from './jurisdiction.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';

interface Scopes { tax: TenantAccess; pricing: TenantAccess|null }
function pricing(scopes: Scopes): TenantAccess { if (!scopes.pricing) throw new HttpError('ACTION_FORBIDDEN'); return scopes.pricing; }
function fresh(value: { created_at: string; expires_at: string }, now: Date) {
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(value.created_at) || now.getTime() >= Date.parse(value.expires_at)) throw new HttpError('TAX_STALE');
}
async function loadPolicy(scope: TenantAccess, id: string) { const row = await r.find(scope,id); if (!row) throw new HttpError('RESOURCE_NOT_FOUND'); return row; }
async function loadIntent(scope: TenantAccess, id: string) { const row = await r.intent(scope,id); if (!row) throw new HttpError('RESOURCE_NOT_FOUND'); return row; }
function unresolved(input: TaxIntentInput) {
  try { placeOfSupply(input.facts); return false; }
  catch (error) { if (error instanceof FieldValidationError) return true; throw error; }
}
async function evidence(scope: TenantAccess, intent: IntentRow, policyId: string, resolutionId: string|undefined, now: Date) {
  fresh(intent.result,now);
  if (!resolutionId) return { facts: intent.input.facts, expiresAt: intent.result.expires_at };
  const resolution = await r.resolution(scope,intent.id);
  if (!resolution || resolution.id !== resolutionId) throw new HttpError('RESOURCE_NOT_FOUND');
  if (resolution.input.policy_id !== policyId) throw new HttpError('TAX_STALE');
  fresh(resolution.result,now);
  return { facts: resolution.input.facts, expiresAt: resolution.result.expires_at };
}

/** Internal Issue 22 port; NEVER take this evidence from a request body. The future
 * coordinator must obtain it from trusted invoice/payment/service records. No HTTP
 * confirmation endpoint or production timing attestor is supplied by Issue 21.
 */
export interface ConfirmationTimeEvidence {
  source: 'trusted-contemporaneous-records'; evidenceRef: string;
  serviceAt: Date; invoiceAt: Date; paymentAt: Date|null;
}
export async function validateTaxSnapshot(scopes: Scopes, id: string, expected: TaxIntentInput,
  timing: ConfirmationTimeEvidence|undefined, now: Date): Promise<TaxCalculationDto> {
  assertTenantAccess(scopes.tax,['tax.validate']);
  await r.visible(scopes.tax,true);
  const stored = await r.calculation(scopes.tax,v.uuid(id));
  if (!stored) throw new HttpError('RESOURCE_NOT_FOUND');
  const intent = await loadIntent(scopes.tax,stored.intent_id);
  if (digest(v.intent(expected)) !== digest(intent.input)) throw new HttpError('TAX_STALE');
  fresh(stored,now);
  // Deliberately narrow: historical invoices, prior payment and cross-time supplies
  // require another reviewed selector. A proposal timestamp is not legal evidence.
  if (!timing || timing.source !== 'trusted-contemporaneous-records' || !/^[A-Za-z0-9:_-]{1,128}$/.test(timing.evidenceRef) ||
    timing.serviceAt.getTime() !== now.getTime() || timing.invoiceAt.getTime() !== now.getTime() ||
    (timing.paymentAt !== null && timing.paymentAt.getTime() !== now.getTime())) throw new HttpError('TAX_TIME_UNSUPPORTED');
  const quote = await validatePricingSnapshot(pricing(scopes),intent.input.quote_id,intent.input.pricing_input,now);
  const policy = await r.current(scopes.tax,now);
  if (policy.id !== stored.policy_id) throw new HttpError('TAX_STALE');
  const resolved = await evidence(scopes.tax,intent,policy.id,stored.resolution_id ?? undefined,now);
  const recomputed = calculate(policy,quote,resolved.facts,{ id: stored.id,intentId: intent.id,resolutionId: stored.resolution_id,expiresAt: resolved.expiresAt },new Date(stored.created_at));
  if (digest(recomputed) !== digest(stored)) throw new HttpError('TAX_STALE');
  return structuredClone(recomputed);
}

export function createTaxService(database: DatabasePool, clock: () => Date = () => new Date()) {
  function scoped<T>(session: string, organization: string, franchise: string, action: TaxAction, correlation: string, work: (s: Scopes) => Promise<T>) {
    return withTaxTenantScope(database,session,v.uuid(organization),v.uuid(franchise),action,correlation,async s => { await r.visible(s.tax); return work(s); });
  }
  async function command<T extends TaxResult>(s: Scopes, operation: TaxOperation, key: unknown, body: unknown, work: () => Promise<T>): Promise<T> {
    const normalizedKey = keyDigest(v.idempotencyKey(key)), fingerprint = digest({ operation,body,normalization: 1 });
    const previous = await r.receipt(s.tax,operation,normalizedKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new HttpError('IDEMPOTENCY_CONFLICT');
      // Live role/tenant authority precedes replay. Receipt is an explicit public projection.
      // Pricing approval is checked again without extending proposal expiry.
      if ('quote_id' in previous.result && s.pricing) {
        const quote = await storedQuote(pricing(s),previous.result.quote_id);
        if (!quote) throw new HttpError('RESOURCE_NOT_FOUND');
        if (quote.override_status === 'privileged' && s.pricing.context.action !== 'pricing.override.approve') throw new HttpError('ACTION_FORBIDDEN');
      }
      return structuredClone(previous.result) as T;
    }
    await r.visible(s.tax,true);
    const result = await work();
    await r.saveReceipt(s.tax,operation,normalizedKey,fingerprint,result);
    return result;
  }
  return {
    effective(session: string, org: string, franchise: string, correlation: string) {
      return scoped(session,org,franchise,'tax.read',correlation,async s => policyDto(await r.current(s.tax,clock())));
    },
    read(session: string, org: string, franchise: string, id: string, correlation: string) {
      return scoped(session,org,franchise,'tax.draft',correlation,async s => policyDto(await loadPolicy(s.tax,v.uuid(id))));
    },
    create(session: string, org: string, franchise: string, key: unknown, input: unknown, correlation: string) {
      return scoped(session,org,franchise,'tax.draft',correlation,async s => {
        const body = v.policy(input); return command(s,'draft',key,body,async () => policyDto(await r.create(s.tax,body)));
      });
    },
    replace(session: string, org: string, franchise: string, id: string, key: unknown, input: unknown, correlation: string) {
      return scoped(session,org,franchise,'tax.draft',correlation,async s => {
        await loadPolicy(s.tax,v.uuid(id)); const b = v.object(input,['expected_version','policy']);
        const body = { expected_version: v.integer(b.expected_version,'expected_version',1,2147483646),policy: v.policy(b.policy) };
        return command(s,'replace',key,{ id,...body },async () => policyDto(await r.replace(s.tax,id,body.expected_version,body.policy)));
      });
    },
    publish(session: string, org: string, franchise: string, id: string, key: unknown, input: unknown, correlation: string) {
      return scoped(session,org,franchise,'tax.publish',correlation,async s => {
        await loadPolicy(s.tax,v.uuid(id)); const body = v.publish(input);
        return command(s,'publish',key,{ id,...body },async () => {
          const row = await loadPolicy(s.tax,id); v.policy(row.policy);
          if (Date.parse(row.policy.effective_from) < clock().getTime()) throw new HttpError('TAX_CONFLICT');
          try { return policyDto(await r.publish(s.tax,id,body.expected_version)); }
          catch (error) { if (error instanceof DatabaseError && error.sqlState === '23514') throw new HttpError('TAX_CONFLICT'); throw error; }
        });
      });
    },
    prepare(session: string, org: string, franchise: string, key: unknown, input: unknown, correlation: string) {
      return scoped(session,org,franchise,'tax.prepare',correlation,async s => {
        const body = v.intent(input); return command(s,'prepare',key,body,async () => {
          const now = clock(), quote = await validatePricingSnapshot(pricing(s),body.quote_id,body.pricing_input,now);
          const result: TaxIntentDto = { id: randomUUID(),quote_id: quote.id,fingerprint: digest(body),created_at: now.toISOString(),
            expires_at: quote.expires_at,jurisdiction_status: unresolved(body) ? 'resolution_required' : 'known' };
          await r.saveIntent(s.tax,body,result); return result;
        });
      });
    },
    inspectIntent(session: string, org: string, franchise: string, id: string, correlation: string, forResolution = false) {
      return scoped(session,org,franchise,forResolution ? 'tax.resolve' : 'tax.prepare',correlation,async s => {
        const row = await loadIntent(s.tax,v.uuid(id));
        return forResolution ? { ...row.result,facts: v.facts(row.input.facts) } : structuredClone(row.result);
      });
    },
    resolve(session: string, org: string, franchise: string, key: unknown, input: unknown, correlation: string) {
      return scoped(session,org,franchise,'tax.resolve',correlation,async s => {
        const body = v.resolution(input), original = await loadIntent(s.tax,body.intent_id); await loadPolicy(s.tax,body.policy_id);
        return command(s,'resolve',key,body,async () => {
          const now = clock(), policy = await r.current(s.tax,now); fresh(original.result,now);
          if (policy.id !== body.policy_id || !unresolved(original.input) || await r.resolution(s.tax,original.id)) throw new HttpError('TAX_CONFLICT');
          if (body.facts.service_recipient_ref !== original.input.facts.service_recipient_ref || original.input.facts.special_case === 'unsupported') throw new HttpError('TAX_CONFLICT');
          for (const field of ['recipient_state','recipient_gstin','handover_state'] as const) {
            if (original.input.facts[field] !== null && original.input.facts[field] !== body.facts[field]) throw new HttpError('TAX_CONFLICT');
          }
          if (original.input.facts.registration !== 'unknown' && original.input.facts.registration !== body.facts.registration) throw new HttpError('TAX_CONFLICT');
          jurisdiction(body.facts,policy.policy.supplier_state);
          const result: TaxResolutionDto = { id: randomUUID(),intent_id: original.id,policy_id: policy.id,evidence_ref: body.evidence_ref,
            created_at: now.toISOString(),expires_at: new Date(Math.min(Date.parse(original.result.expires_at),Date.parse(policy.policy.effective_to),now.getTime()+policy.policy.validity_seconds*1000)).toISOString() };
          await r.saveResolution(s.tax,body,result); return result;
        });
      });
    },
    calculate(session: string, org: string, franchise: string, key: unknown, input: unknown, correlation: string) {
      return scoped(session,org,franchise,'tax.calculate',correlation,async s => {
        const body = v.calculation(input), original = await loadIntent(s.tax,body.intent_id);
        return command(s,'calculate',key,body,async () => {
          const now = clock(), policy = await r.current(s.tax,now);
          const resolved = await evidence(s.tax,original,policy.id,body.resolution_id,now);
          const quote = await validatePricingSnapshot(pricing(s),original.input.quote_id,original.input.pricing_input,now);
          const result = calculate(policy,quote,resolved.facts,{ id: randomUUID(),intentId: original.id,resolutionId: body.resolution_id ?? null,expiresAt: resolved.expiresAt },now);
          await r.saveCalculation(s.tax,result); return result;
        });
      });
    },
    readCalculation(session: string, org: string, franchise: string, id: string, correlation: string) {
      return scoped(session,org,franchise,'tax.calculate',correlation,async s => {
        const result = await r.calculation(s.tax,v.uuid(id)); if (!result) throw new HttpError('RESOURCE_NOT_FOUND'); return structuredClone(result);
      });
    },
  };
}
