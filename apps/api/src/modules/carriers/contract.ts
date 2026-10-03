/** Server-only v1 port. No installation store, provider implementation or domain writes. */
export const carrierContractVersion = 1 as const;

export type CarrierMode = 'manual' | 'file' | 'live_api';
export type Capability = 'manual_observations' | 'tracking_import' | 'tracking_api' |
  'webhooks' | 'selling_rate_import' | 'selling_rate_api' |
  'purchase_estimate_import' | 'purchase_estimate_api' | 'booking_api';
export type CapabilityEvidence =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; evidenceId: string; verifiedAt: string }>;
export type Capabilities = Readonly<Record<Capability, CapabilityEvidence>>;

/** IDs are opaque, stable internal identifiers, never carrier names, postcodes or URLs. */
export interface Installation {
  readonly contractVersion: typeof carrierContractVersion;
  readonly id: string;
  readonly organizationId: string;
  readonly franchiseIds: readonly string[];
  readonly courierId: string;
  readonly revision: number;
  readonly capabilities: Capabilities;
}
export interface InstallationScope {
  readonly organizationId: string;
  readonly franchiseId: string;
  readonly installationId: string;
}
export interface ShipmentReference extends InstallationScope {
  readonly externalDocket: string;
}
export type Mapping =
  | Readonly<{ state: 'mapped'; id: string; mappingVersionId: string }>
  | Readonly<{ state: 'unmapped'; sourceCode: string }>;
export interface Dimensions {
  readonly courierId: string;
  readonly service: Mapping;
  readonly origin: Mapping;
  readonly destination: Mapping;
}

/** These are claims, deliberately not the ParcelStatus type or domain commands. */
export type ObservationStatus = 'booked_claim' | 'collected_claim' | 'in_transit_claim' |
  'out_for_delivery_claim' | 'failed_attempt_claim' | 'held_claim' |
  'delivered_claim' | 'returned_claim';
export type StatusMapping =
  | Readonly<{ state: 'mapped'; status: ObservationStatus; mappingVersionId: string }>
  | Readonly<{ state: 'unmapped'; sourceCode: string }>;
export type SourceTime =
  | Readonly<{ state: 'known'; at: string }>
  | Readonly<{ state: 'unknown'; reason: 'missing' | 'unknown_timezone' | 'invalid' }>;
export type Provenance =
  | Readonly<{ mode: 'manual'; commandId: string; actorId: string }>
  | Readonly<{ mode: 'file'; importId: string; fileSha256: string; row: number }>
  | Readonly<{ mode: 'live_api'; channel: 'poll' | 'webhook'; receiptId: string; providerEventId: string | null }>;
export interface Observation {
  readonly contractVersion: typeof carrierContractVersion;
  readonly reference: ShipmentReference;
  readonly dimensions: Dimensions;
  readonly status: StatusMapping;
  readonly occurredAt: SourceTime;
  readonly receivedAt: string;
  readonly provenance: Provenance;
  /** Source identity is installation-scoped; cross-channel semantic dedup is owned by #58. */
  readonly sourceRecordId: string;
}

export type RatePurpose = 'customer_selling' | 'courier_purchase_estimate';
/** A candidate amount is neither a published selling price nor an actual shipment cost. */
export interface RateCandidate {
  readonly reference: InstallationScope;
  readonly dimensions: Dimensions;
  readonly purpose: RatePurpose;
  readonly currency: 'INR';
  readonly amountPaise: number;
  readonly weightGrams: number;
  readonly sourceVersionId: string;
  readonly sourceRecordId: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly receivedAt: string;
  readonly provenance: Provenance;
}
/** Read-only references to future owning-service evidence; never created by adapters. */
export type ActualCostEvidence =
  | Readonly<{ state: 'unknown'; reason: 'not_recorded' }>
  | Readonly<{ state: 'recorded'; owner: 'shipment_costs'; sourceId: string;
      sourceVersionId: string; currency: 'INR'; amountPaise: number }>;

export type AdapterFailure =
  | Readonly<{ kind: 'unsupported'; capability: Capability }>
  | Readonly<{ kind: 'retryable'; acceptance: 'not_accepted'; code: 'unavailable' | 'rate_limited'; retryAfterMs: number | null }>
  | Readonly<{ kind: 'permanent'; code: 'invalid_input' | 'invalid_response' | 'reference_conflict' }>
  | Readonly<{ kind: 'auth'; code: 'credentials_invalid' | 'configuration_invalid' }>
  | Readonly<{ kind: 'uncertain'; operationId: string; code: 'timeout' | 'connection_lost' }>;
export type AdapterResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: AdapterFailure }>;
export type Health =
  | Readonly<{ state: 'not_applicable'; mode: 'manual' | 'file' }>
  | Readonly<{ state: 'unknown'; mode: 'live_api' }>
  | Readonly<{ state: 'healthy' | 'degraded' | 'auth_failed'; mode: 'live_api';
      checkedAt: string; lastSuccessAt: string | null }>;
/** Trusted composition supplies these references, never a browser or imported URL. */
export interface NetworkPolicy {
  readonly endpointProfileId: string;
  readonly credentialRef: string;
  readonly timeoutMs: number;
  readonly maxReadAttempts: number;
  readonly maxResponseBytes: number;
}
export interface OperationContext {
  readonly reference: InstallationScope;
  readonly operationId: string;
  readonly requestFingerprint: string;
  readonly installationRevision: number;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}
export type ObservationInput =
  | Readonly<{ mode: 'manual'; observation: Observation }>
  | Readonly<{ mode: 'file'; privateImportId: string }>
  | Readonly<{ mode: 'live_api'; channel: 'poll'; externalDocket: string; cursor: string | null }>
  | Readonly<{ mode: 'live_api'; channel: 'webhook'; verifiedReceiptId: string }>;
export interface RateInput {
  readonly purpose: RatePurpose;
  readonly source: Readonly<{ mode: 'file'; privateImportId: string }> |
    Readonly<{ mode: 'live_api'; sourceVersionId: string }>;
}
export interface ExternalBookingInput {
  /** An immutable server-owned outbound snapshot; no customer payload in the contract fixture. */
  readonly bookingSnapshotId: string;
  readonly dimensions: Dimensions;
}
export interface CarrierAdapter {
  readonly installation: Installation;
  health(): Promise<Health>;
  observe(context: OperationContext, input: ObservationInput): Promise<AdapterResult<readonly Observation[]>>;
  rates(context: OperationContext, input: RateInput): Promise<AdapterResult<readonly RateCandidate[]>>;
  submitBooking(context: OperationContext, input: ExternalBookingInput): Promise<AdapterResult<ShipmentReference>>;
}

export function unsupported(capability: Capability): AdapterResult<never> {
  return { ok: false, error: { kind: 'unsupported', capability } };
}

export function observationCapability(input: ObservationInput): Capability {
  if (input.mode === 'manual') return 'manual_observations';
  if (input.mode === 'file') return 'tracking_import';
  return input.channel === 'poll' ? 'tracking_api' : 'webhooks';
}

export function rateCapability(input: RateInput): Capability {
  if (input.purpose === 'customer_selling') return input.source.mode === 'file' ? 'selling_rate_import' : 'selling_rate_api';
  return input.source.mode === 'file' ? 'purchase_estimate_import' : 'purchase_estimate_api';
}

/** Pure contract predicate only. Authentication/action checks and grants must come from server scope. */
export function matchesInstallation(installation: Installation, reference: InstallationScope,
  authorized: Readonly<{ organizationId: string; franchiseIds: readonly string[] }>): boolean {
  return installation.id === reference.installationId &&
    installation.organizationId === reference.organizationId &&
    authorized.organizationId === reference.organizationId &&
    installation.franchiseIds.includes(reference.franchiseId) &&
    authorized.franchiseIds.includes(reference.franchiseId);
}

export function mapStatus(sourceCode: string, mappingVersionId: string,
  mappings: ReadonlyMap<string, ObservationStatus>): StatusMapping {
  const status = mappings.get(sourceCode);
  return status === undefined ? { state: 'unmapped', sourceCode } : { state: 'mapped', status, mappingVersionId };
}

/** Tuple encoding avoids concatenation collisions; external dockets retain case and punctuation. */
export function referenceKey(reference: ShipmentReference): string {
  return JSON.stringify([reference.organizationId, reference.franchiseId, reference.installationId, reference.externalDocket]);
}

/** No hidden retry loop. An uncertain submission must be reconciled even if its error is transient. */
export function recovery(error: AdapterFailure): 'unsupported' | 'retry_bounded' | 'repair' | 'reconcile' | 'reject' {
  switch (error.kind) {
    case 'unsupported': return 'unsupported';
    case 'retryable': return 'retry_bounded';
    case 'auth': return 'repair';
    case 'uncertain': return 'reconcile';
    case 'permanent': return 'reject';
  }
}

/** Validate exact integer units before handing a candidate to the pricing/import owner. */
export function validRateUnits(rate: Pick<RateCandidate, 'currency' | 'amountPaise' | 'weightGrams'>): boolean {
  return rate.currency === 'INR' && Number.isSafeInteger(rate.amountPaise) && rate.amountPaise >= 0 &&
    Number.isSafeInteger(rate.weightGrams) && rate.weightGrams > 0;
}
