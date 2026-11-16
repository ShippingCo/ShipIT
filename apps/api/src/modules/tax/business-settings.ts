import type { BusinessGstMode, BusinessGstSettingsDto, BusinessGstSettingsInput, TaxPolicyInput, TaxRule } from '@shippingco/shared';
import { FieldValidationError } from '../../plugins/errors.ts';
import { object, integer, policy } from './validation.ts';
import type { PolicyRow } from './types.ts';

export function settingsInput(value: unknown): BusinessGstSettingsInput {
  const b = object(value,['mode','supplier_state','supplier_gstin','expected_version']);
  if (!['courier18','gta5','gta18','none'].includes(b.mode as string) || typeof b.supplier_state !== 'string' || typeof b.supplier_gstin !== 'string') throw new FieldValidationError('tax','INVALID_FORMAT');
  return { mode: b.mode as BusinessGstMode,supplier_state: b.supplier_state,supplier_gstin: b.supplier_gstin.trim().toUpperCase(),expected_version: integer(b.expected_version,'expected_version',0,2147483646) };
}
export function settingsDto(row: PolicyRow|null): BusinessGstSettingsDto {
  return { id: row?.id??null,mode: row?.business_gst_mode??null,supplier_state: row?.policy.supplier_state??'',version: row?.version_number??0 };
}
/**
 * The GSTIN the saved policy will carry.
 *
 * A blank value means "keep the one already saved", which is what the settings form offers.
 * On a shop's first save there is nothing to keep, and the old code passed `undefined`
 * straight into `policy()` — which rejected it as a malformed GSTIN and reported the failure
 * against the field `tax`. The operator saw only "the server rejected the change", with no
 * way to tell which of the three GST fields was at fault.
 *
 * The state prefix is checked here for the same reason: `policy()` enforces it, but reports it
 * as a GSTIN format problem, when the operator may equally have chosen the wrong state.
 */
function supplierGstin(input: BusinessGstSettingsInput, existing: PolicyRow|null): string {
  const kept = input.supplier_gstin || existing?.policy.supplier_gstin || '';
  if (!kept) throw new FieldValidationError('supplier_gstin','REQUIRED');
  if (input.supplier_state && !kept.startsWith(input.supplier_state)) {
    throw new FieldValidationError('supplier_gstin','INVALID_FORMAT');
  }
  return kept;
}

/** A single business preference covers every ordinary counter combination. */
export function settingsPolicy(input: BusinessGstSettingsInput, now: Date, existing: PolicyRow|null): TaxPolicyInput {
  const rate = input.mode === 'none' ? 0 : input.mode === 'gta5' ? 5 : 18;
  const rules: TaxRule[] = [];
  for (const service of ['standard','express','same_city'] as const) for (const registration of ['registered','unregistered'] as const) for (const jurisdiction of ['intra','inter'] as const) {
    rules.push({ id: [service,registration,jurisdiction].join('_'),service,registration,jurisdiction,
      classification: input.mode,treatment: rate ? 'taxable' : 'exempt',evidence_ref: 'BUSINESS_GST_SETTING',taxable_lines: ['freight','packing'],
      components: rate === 0 ? [] : jurisdiction === 'inter' ? [{ id: 'IGST',kind: 'IGST',numerator: rate,denominator: 100 }] :
        [{ id: 'CGST',kind: 'CGST',numerator: rate,denominator: 200 },{ id: 'SGST',kind: 'SGST',numerator: rate,denominator: 200 }] });
  }
  return policy({ effective_from: now.toISOString(),effective_to: '9999-12-31T23:59:59.000Z',validity_seconds: 600,
    supplier_state: input.supplier_state,supplier_gstin: supplierGstin(input, existing),
    approval_ref: 'SETTINGS_SAVE',source_ref: 'BUSINESS_GST_SETTING',time_rule: 'contemporaneous_v1',rules });
}
