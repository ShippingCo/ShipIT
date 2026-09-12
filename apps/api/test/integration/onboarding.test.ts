import { describe, expect, it } from 'vitest';
import { onboardingInput, requestKey, fingerprint } from '../../src/modules/onboarding/validation.ts';
const body = { display_name: 'Synthetic shop', franchise: { display_name: 'Pune counter', franchise_code: 'MAIN' } };
describe('onboarding command v1', () => {
  it('requires only approved business/location fields and canonicalizes field ordering', () => {
    expect(onboardingInput(body)).toEqual(body);
    expect(fingerprint(onboardingInput({ franchise: { franchise_code: 'MAIN', display_name: 'Pune counter' }, display_name: 'Synthetic shop' }))).toBe(fingerprint(body));
    expect(fingerprint({ ...body, display_name: 'Another shop' })).not.toBe(fingerprint(body));
  });
  it.each([null, {}, { ...body, role: 'org_admin' }, { ...body, organization_id: 'foreign' },
    { ...body, membership_id: 'foreign' }, { ...body, franchise: { ...body.franchise, organization_id: 'foreign' } },
    { ...body, franchise: { ...body.franchise, franchise_id: 'foreign' } }, { ...body, display_name: '' },
    { ...body, display_name: ' padded ' }, { ...body, display_name: '\ud800' }, { ...body, franchise: {} },
    { ...body, franchise: { display_name: 'Pune', franchise_code: 'lowercase' } }])('rejects malformed or ownership-bearing input %#', input => {
    expect(() => onboardingInput(input)).toThrow('VALIDATION_FAILED');
  });
  it.each([undefined, '', 'a,b', 'has space', 'x\n', ['one', 'two'], 'x'.repeat(256)])('rejects invalid request identity %#', key => {
    expect(() => requestKey(key)).toThrow('VALIDATION_FAILED');
  });
  it('keeps the complete valid case-sensitive key', () => { expect(requestKey('A_b-123')).toBe('A_b-123'); });
});
