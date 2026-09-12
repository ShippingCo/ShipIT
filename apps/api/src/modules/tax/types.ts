import type { TaxPolicyInput, TaxPolicyDto, TaxIntentInput, TaxIntentDto, TaxResolutionInput, TaxResolutionDto, TaxCalculationDto } from '@shippingco/shared';
import { policy as normalizedPolicy } from './validation.ts';
export type TaxAction = 'tax.read' | 'tax.draft' | 'tax.publish' | 'tax.prepare' | 'tax.resolve' | 'tax.calculate' | 'tax.validate';
export type TaxOperation = 'draft' | 'replace' | 'publish' | 'prepare' | 'resolve' | 'calculate';
export interface PolicyRow { id: string; version_number: number; revision: number; state: 'draft' | 'published'; policy: TaxPolicyInput }
export interface IntentRow { id: string; actor_id: string; input: TaxIntentInput; result: TaxIntentDto }
export interface ResolutionRow { id: string; actor_id: string; input: TaxResolutionInput; result: TaxResolutionDto }
export type TaxResult = TaxPolicyDto | TaxIntentDto | TaxResolutionDto | TaxCalculationDto;
export function policyDto(row: PolicyRow): TaxPolicyDto {
  const p = normalizedPolicy(row.policy);
  return { id: row.id, version: row.revision, version_number: row.version_number, state: row.state,
    effective_from: p.effective_from, effective_to: p.effective_to, validity_seconds: p.validity_seconds,
    supplier_state: p.supplier_state, approval_ref: p.approval_ref, source_ref: p.source_ref,
    time_rule: p.time_rule, rules: structuredClone(p.rules) };
}
