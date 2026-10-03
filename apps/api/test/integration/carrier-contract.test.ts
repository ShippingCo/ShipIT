import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapStatus, matchesInstallation, observationCapability, rateCapability, recovery, referenceKey,
  validRateUnits } from '../../src/modules/carriers/contract.ts';
import type { AdapterFailure, CarrierAdapter, Observation, ObservationInput, RateCandidate } from '../../src/modules/carriers/contract.ts';
import { context, dimensions, fakeAdapter, financialRows, installation, observation, rate, reference } from '../carrier-fixtures.ts';

describe('#53 server-only carrier contract v1', () => {
  it.each(['manual', 'file', 'live_api'] as const)('runs the fictional %s adapter with provenance', async mode => {
    const adapter = fakeAdapter(mode);
    const input: ObservationInput = mode === 'manual' ? { mode, observation: observation(mode) } :
      mode === 'file' ? { mode, privateImportId: 'import-1' } : { mode, channel: 'poll', externalDocket: reference.externalDocket, cursor: null };
    const result = await adapter.observe(context, input);
    if (!result.ok) throw new Error('Expected observation');
    expect(result.value).toHaveLength(1);
    const value = result.value[0]!;
    expect(value.contractVersion).toBe(1);
    expect(value.reference).toEqual({ organizationId: 'org-a', franchiseId: 'franchise-a',
      installationId: 'installation-a', externalDocket: 'FICTIONAL-53' });
    expect(value.dimensions.courierId).toBe('courier-fictional');
    expect(value.dimensions.service).toEqual({ state: 'mapped', id: 'service-standard', mappingVersionId: 'mapping-1' });
    expect(value.dimensions.destination).toEqual({ state: 'mapped', id: 'location-destination', mappingVersionId: 'mapping-1' });
    expect(value.sourceRecordId).toBe('source-event-1');
    expect(value.provenance.mode).toBe(mode);
    if (value.provenance.mode === 'manual') {
      expect(value.provenance.actorId).toBe('fictional-admin');
      expect(value.provenance.commandId).toBe('command-1');
    } else if (value.provenance.mode === 'file') {
      expect(value.provenance.fileSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(value.provenance.row).toBe(2);
      expect(value.provenance.importId).toBe('import-1');
    } else {
      expect(value.provenance.receiptId).toBe('receipt-1');
      expect(value.provenance.providerEventId).toBe('source-event-1');
    }
    expect(Date.parse(value.receivedAt)).toBeGreaterThan(Date.parse(value.occurredAt.state === 'known' ? value.occurredAt.at : ''));
  });

  it('keeps manual valid with all file/network capabilities off and no API health or credentials', async () => {
    const adapter = fakeAdapter('manual');
    expect(Object.entries(adapter.installation.capabilities).filter(([, value]) => value.enabled).map(([key]) => key))
      .toEqual(['manual_observations']);
    expect(await adapter.health()).toEqual({ state: 'not_applicable', mode: 'manual' });
    expect(await adapter.submitBooking(context, { bookingSnapshotId: 'booking-1', dimensions }))
      .toEqual({ ok: false, error: { kind: 'unsupported', capability: 'booking_api' } });
  });

  it('does not couple local booking to carrier availability (dependency regression)', () => {
    // The real booking service remains authoritative; its existing database suite verifies commit/replay.
    const source = readFileSync(new URL('../../src/modules/bookings/service.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/(?:from\s*['"][^'"]*carriers|fetch\s*\(|CarrierAdapter)/);
    expect(source).toContain('withBookingTenantScope');
  });

  it('keeps file, API, webhooks, selling and estimated-purchase capabilities independent', async () => {
    const file = fakeAdapter('file'), api = fakeAdapter('live_api');
    expect(await file.observe(context, { mode: 'live_api', channel: 'poll', externalDocket: reference.externalDocket, cursor: null }))
      .toEqual({ ok: false, error: { kind: 'unsupported', capability: 'tracking_api' } });
    expect(await api.observe(context, { mode: 'live_api', channel: 'webhook', verifiedReceiptId: 'receipt-1' }))
      .toEqual({ ok: false, error: { kind: 'unsupported', capability: 'webhooks' } });
    for (const purpose of ['customer_selling', 'courier_purchase_estimate'] as const) {
      const result = await file.rates(context, { purpose, source: { mode: 'file', privateImportId: 'import-1' } });
      expect(result.ok && result.value[0]?.purpose).toBe(purpose);
    }
    expect(await api.rates(context, { purpose: 'courier_purchase_estimate', source: { mode: 'live_api', sourceVersionId: 'v1' } }))
      .toEqual({ ok: false, error: { kind: 'unsupported', capability: 'purchase_estimate_api' } });
    expect(observationCapability({ mode: 'manual', observation: observation('manual') })).toBe('manual_observations');
    expect(rateCapability({ purpose: 'customer_selling', source: { mode: 'live_api', sourceVersionId: 'v1' } })).toBe('selling_rate_api');
  });

  it('denies sibling/unrelated installation selection even for an own-org administrator read scope', () => {
    const manifest = installation(['manual_observations']);
    const own = { organizationId: 'org-a', franchiseIds: ['franchise-a'] };
    expect(matchesInstallation(manifest, reference, own)).toBe(true);
    expect(matchesInstallation(manifest, context.reference, own)).toBe(true);
    expect(matchesInstallation(manifest, { ...reference, franchiseId: 'franchise-b' }, own)).toBe(false);
    expect(matchesInstallation(manifest, reference, { organizationId: 'org-c', franchiseIds: ['franchise-a'] })).toBe(false);
    expect(matchesInstallation(manifest, { ...reference, installationId: 'installation-b' }, own)).toBe(false);
    const orgRead = { ...own, franchiseIds: ['franchise-a', 'franchise-b'] };
    const sibling = { ...reference, franchiseId: 'franchise-b' };
    expect(matchesInstallation(manifest, sibling, orgRead)).toBe(false);
    const explicitGrant = { ...manifest, franchiseIds: ['franchise-a', 'franchise-b'] };
    expect(matchesInstallation(explicitGrant, sibling, orgRead)).toBe(true);
    expect(matchesInstallation(explicitGrant, sibling, own)).toBe(false);
    expect(matchesInstallation(manifest, reference, { ...own, franchiseIds: [] })).toBe(false);
  });

  it('qualifies external identities and preserves exact external references', () => {
    expect(referenceKey(reference)).not.toBe(referenceKey({ ...reference, installationId: 'installation-b' }));
    expect(referenceKey(reference)).not.toBe(referenceKey({ ...reference, externalDocket: reference.externalDocket.toLowerCase() }));
    expect(referenceKey({ ...reference, installationId: 'a:b', externalDocket: 'c' }))
      .not.toBe(referenceKey({ ...reference, installationId: 'a', externalDocket: 'b:c' }));
    expect(referenceKey({ ...reference })).toBe(referenceKey(reference));
  });

  it('preserves unknown status and timezone without inventing a canonical transition', () => {
    const mappings = new Map([['DLV', 'delivered_claim' as const]]);
    expect(mapStatus('NEW-CODE', 'mapping-1', mappings)).toEqual({ state: 'unmapped', sourceCode: 'NEW-CODE' });
    expect(mapStatus('toString', 'mapping-1', mappings).state).toBe('unmapped');
    expect(mapStatus('DLV', 'mapping-1', mappings)).toEqual({ state: 'mapped', status: 'delivered_claim', mappingVersionId: 'mapping-1' });
    const unknown: Observation = { ...observation('file'), occurredAt: { state: 'unknown', reason: 'unknown_timezone' } };
    expect(unknown.occurredAt).not.toHaveProperty('at');
  });

  it.each([
    [{ kind: 'unsupported', capability: 'booking_api' }, 'unsupported'],
    [{ kind: 'retryable', acceptance: 'not_accepted', code: 'rate_limited', retryAfterMs: 1000 }, 'retry_bounded'],
    [{ kind: 'permanent', code: 'invalid_response' }, 'reject'],
    [{ kind: 'auth', code: 'credentials_invalid' }, 'repair'],
    [{ kind: 'uncertain', operationId: 'operation-1', code: 'timeout' }, 'reconcile'],
  ] satisfies [AdapterFailure, string][])('classifies %j safely', (error, expected) => {
    expect(recovery(error)).toBe(expected);
    expect(error).not.toHaveProperty('rawResponse');
  });

  it('does not turn timeout after possible acceptance into an automatic booking retry', async () => {
    const result = await fakeAdapter('live_api', { ok: false,
      error: { kind: 'uncertain', operationId: context.operationId, code: 'timeout' } })
      .submitBooking(context, { bookingSnapshotId: 'booking-1', dimensions });
    expect(result).toEqual({ ok: false, error: { kind: 'uncertain', operationId: 'operation-1', code: 'timeout' } });
    if (!result.ok) expect(recovery(result.error)).toBe('reconcile');
  });

  it('reconciles fictional source totals without treating estimates or unknown costs as actual', () => {
    const snapshots = structuredClone(financialRows);
    const groups = new Map<string, typeof financialRows[number][]>();
    for (const row of financialRows) {
      expect(row.provenance.mode).toBe('manual');
      expect(row.reference.organizationId).toBe('org-a');
      expect(row.dimensions.service.state).toBe('mapped');
      expect(row.dimensions.destination.state).toBe('mapped');
      const key = JSON.stringify([row.reference.organizationId, row.reference.franchiseId, row.dimensions.courierId,
        row.dimensions.service.state === 'mapped' ? row.dimensions.service.id : null,
        row.dimensions.destination.state === 'mapped' ? row.dimensions.destination.id : null]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    expect(groups.size).toBe(1);
    expect(financialRows.reduce((sum, row) => sum + row.sellingPaise, 0)).toBe(30003);
    const recorded = financialRows.flatMap(row => row.actualCost.state === 'recorded' ? [row.actualCost] : []);
    expect(recorded.reduce((sum, cost) => sum + cost.amountPaise, 0)).toBe(12001);
    expect(recorded.map(cost => [cost.sourceId, cost.sourceVersionId])).toEqual([['fictional-cost-2', 'cost-version-1']]);
    expect(financialRows.filter(row => row.actualCost.state === 'unknown')).toHaveLength(1);
    const newEstimate = { ...rate('courier_purchase_estimate', 7000), sourceVersionId: 'rate-version-2' };
    expect(newEstimate.purpose).toBe('courier_purchase_estimate');
    expect(financialRows).toEqual(snapshots);
  });

  it.each([0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid paise %s', amount => {
    expect(validRateUnits(rate('customer_selling', amount))).toBe(false);
  });
  it('requires positive integer grams and INR, preserving exact paise', () => {
    expect(validRateUnits(rate('customer_selling', 10001))).toBe(true);
    expect(validRateUnits(rate('courier_purchase_estimate', 0))).toBe(true);
    for (const weightGrams of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validRateUnits({ ...rate('customer_selling', 100), weightGrams })).toBe(false);
    }
    expect(validRateUnits({ ...rate('customer_selling', 100), currency: 'USD' as 'INR' })).toBe(false);
  });

  it('has no provider credentials or domain mutation methods in the adapter fixture', () => {
    const adapter = fakeAdapter('manual');
    expect(Object.keys(adapter).sort()).toEqual(['health', 'installation', 'observe', 'rates', 'submitBooking']);
    expect(JSON.stringify(adapter)).not.toMatch(/credentialRef|apiKey|token|password/);
    // Rates and a new external booking cannot require a docket that has not been assigned yet.
    expect(context.reference).not.toHaveProperty('externalDocket');
  });
});

// Compile-time negative assertions: typecheck must reject domain authority and actual-cost imports.
function typeBoundaries(adapter: CarrierAdapter, candidate: RateCandidate) {
  // @ts-expect-error Carrier adapters have no delivery command.
  void adapter.markDelivered;
  // @ts-expect-error Carrier adapters have no payment command.
  void adapter.markPaid;
  // @ts-expect-error Actual costs are owning-service evidence, never a rate purpose.
  const purpose: RateCandidate['purpose'] = 'actual_cost';
  void purpose;
  // @ts-expect-error Candidate evidence is immutable.
  candidate.amountPaise = 0;
}
void typeBoundaries;
