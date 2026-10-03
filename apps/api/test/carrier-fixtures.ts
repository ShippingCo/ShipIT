/** Fictional contract examples only. These adapters are never registered in the application. */
import type { ActualCostEvidence, AdapterResult, Capabilities, Capability, CarrierAdapter,
  CarrierMode, Dimensions, Installation, Observation, OperationContext, RateCandidate,
  ShipmentReference } from '../src/modules/carriers/contract.ts';
import { observationCapability, rateCapability, unsupported } from '../src/modules/carriers/contract.ts';

export const receivedAt = '2026-10-03T06:30:00.000Z';
export const reference: ShipmentReference = {
  organizationId: 'org-a', franchiseId: 'franchise-a', installationId: 'installation-a', externalDocket: 'FICTIONAL-53',
};
export const dimensions: Dimensions = {
  courierId: 'courier-fictional',
  service: { state: 'mapped', id: 'service-standard', mappingVersionId: 'mapping-1' },
  origin: { state: 'mapped', id: 'location-origin', mappingVersionId: 'mapping-1' },
  destination: { state: 'mapped', id: 'location-destination', mappingVersionId: 'mapping-1' },
};
export const disabledCapabilities: Capabilities = {
  manual_observations: { enabled: false }, tracking_import: { enabled: false }, tracking_api: { enabled: false },
  webhooks: { enabled: false }, selling_rate_import: { enabled: false }, selling_rate_api: { enabled: false },
  purchase_estimate_import: { enabled: false }, purchase_estimate_api: { enabled: false }, booking_api: { enabled: false },
};
export function installation(capabilities: readonly Capability[]): Installation {
  const enabled = Object.fromEntries(capabilities.map(key => [key,
    { enabled: true, evidenceId: 'synthetic-contract-v1', verifiedAt: receivedAt }]));
  return { contractVersion: 1, id: reference.installationId, organizationId: reference.organizationId,
    franchiseIds: [reference.franchiseId], courierId: dimensions.courierId, revision: 1,
    capabilities: { ...disabledCapabilities, ...enabled } };
}
export function observation(mode: CarrierMode): Observation {
  return { contractVersion: 1, reference: { ...reference }, dimensions: structuredClone(dimensions),
    sourceRecordId: 'source-event-1', receivedAt,
    occurredAt: { state: 'known', at: '2026-10-03T06:00:00.000Z' },
    status: { state: 'mapped', status: 'in_transit_claim', mappingVersionId: 'status-mapping-1' },
    provenance: mode === 'manual' ? { mode, commandId: 'command-1', actorId: 'fictional-admin' } :
      mode === 'file' ? { mode, importId: 'import-1', fileSha256: 'a'.repeat(64), row: 2 } :
        { mode, channel: 'poll', receiptId: 'receipt-1', providerEventId: 'source-event-1' } };
}
export function rate(purpose: RateCandidate['purpose'], amountPaise: number): RateCandidate {
  return { reference: { organizationId: reference.organizationId, franchiseId: reference.franchiseId,
    installationId: reference.installationId }, dimensions: structuredClone(dimensions), purpose,
    currency: 'INR', amountPaise, weightGrams: 1000, sourceVersionId: 'rate-version-1', sourceRecordId: 'rate-row-1',
    effectiveFrom: receivedAt, effectiveUntil: null, receivedAt,
    provenance: { mode: 'file', importId: 'import-1', fileSha256: 'b'.repeat(64), row: 2 } };
}
export const context: OperationContext = { reference: { organizationId: reference.organizationId,
  franchiseId: reference.franchiseId, installationId: reference.installationId }, operationId: 'operation-1',
  requestFingerprint: 'c'.repeat(64), installationRevision: 1,
  deadlineAt: '2026-10-03T06:30:10.000Z', signal: new AbortController().signal };

export function fakeAdapter(mode: CarrierMode,
  bookingResult?: AdapterResult<ShipmentReference>): CarrierAdapter {
  const enabled: Capability[] = mode === 'manual' ? ['manual_observations'] : mode === 'file' ?
    ['tracking_import', 'selling_rate_import', 'purchase_estimate_import'] : ['tracking_api', 'selling_rate_api', 'booking_api'];
  const manifest = installation(enabled);
  return {
    installation: manifest,
    health: () => Promise.resolve(mode === 'live_api' ? { state: 'unknown', mode } : { state: 'not_applicable', mode }),
    observe: (_context, input) => Promise.resolve(manifest.capabilities[observationCapability(input)].enabled ?
      { ok: true, value: [observation(mode)] } : unsupported(observationCapability(input))),
    rates: (_context, input) => Promise.resolve(manifest.capabilities[rateCapability(input)].enabled ?
      { ok: true, value: [{ ...rate(input.purpose, 12500), provenance: observation(mode).provenance }] } : unsupported(rateCapability(input))),
    submitBooking: () => Promise.resolve(manifest.capabilities.booking_api.enabled ?
      bookingResult ?? { ok: true, value: { ...reference } } : unsupported('booking_api')),
  };
}

/** Frozen financial source snapshots, not a revenue/profit report or a cost write path. */
export const financialRows: readonly Readonly<{
  bookingSnapshotId: string; sellingSourceVersionId: string; dimensions: Dimensions;
  reference: ShipmentReference; provenance: Observation['provenance'];
  sellingPaise: number; estimatedPurchasePaise: number | null; actualCost: ActualCostEvidence;
}>[] = [
  { bookingSnapshotId: 'booking-snapshot-1', sellingSourceVersionId: 'selling-version-1', dimensions,
    reference, provenance: observation('manual').provenance,
    sellingPaise: 10001, estimatedPurchasePaise: 6500, actualCost: { state: 'unknown', reason: 'not_recorded' } },
  { bookingSnapshotId: 'booking-snapshot-2', sellingSourceVersionId: 'selling-version-1', dimensions,
    reference: { ...reference, externalDocket: 'FICTIONAL-54' }, provenance: { mode: 'manual', commandId: 'command-2', actorId: 'fictional-admin' },
    sellingPaise: 20002, estimatedPurchasePaise: null, actualCost: { state: 'recorded', owner: 'shipment_costs',
      sourceId: 'fictional-cost-2', sourceVersionId: 'cost-version-1', currency: 'INR', amountPaise: 12001 } },
];
