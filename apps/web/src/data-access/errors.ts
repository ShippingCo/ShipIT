const responseCodes = new Set([
  'MALFORMED_REQUEST', 'UNAUTHENTICATED', 'ACTION_FORBIDDEN', 'RESOURCE_NOT_FOUND', 'REQUEST_TIMEOUT',
  'VERSION_CONFLICT', 'MEMBERSHIP_CONFLICT', 'INVITATION_CONFLICT', 'FRANCHISE_CODE_CONFLICT',
  'FRANCHISE_DISABLED', 'ORGANIZATION_DISABLED', 'PARCEL_STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'VALIDATION_FAILED',
  'CURSOR_INVALID', 'RATE_LIMITED', 'HEADERS_TOO_LARGE', 'INTERNAL_ERROR', 'TEMPORARILY_UNAVAILABLE',
]);
const statusCodes: Record<number, string[]> = {
  400: ['MALFORMED_REQUEST'], 401: ['UNAUTHENTICATED'], 403: ['ACTION_FORBIDDEN'], 404: ['RESOURCE_NOT_FOUND'], 408: ['REQUEST_TIMEOUT'],
  409: ['VERSION_CONFLICT', 'MEMBERSHIP_CONFLICT', 'INVITATION_CONFLICT', 'FRANCHISE_CODE_CONFLICT', 'FRANCHISE_DISABLED', 'ORGANIZATION_DISABLED', 'PARCEL_STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_IN_PROGRESS'],
  413: ['PAYLOAD_TOO_LARGE'], 415: ['UNSUPPORTED_MEDIA_TYPE'], 422: ['VALIDATION_FAILED', 'CURSOR_INVALID'], 429: ['RATE_LIMITED'], 431: ['HEADERS_TOO_LARGE'], 500: ['INTERNAL_ERROR'], 503: ['TEMPORARILY_UNAVAILABLE'],
};
const validationCodes = new Set(['REQUIRED', 'INVALID_TYPE', 'INVALID_FORMAT', 'OUT_OF_RANGE', 'UNKNOWN_FIELD']);
export type FailureKind = 'response' | 'network' | 'aborted' | 'protocol' | 'scope';
export class ApiFailure extends Error {
  readonly code: string;
  readonly kind: FailureKind;
  readonly status?: number;
  readonly correlationId?: string;
  readonly details: ReadonlyArray<Readonly<{ field: string; code: string }>>;
  readonly retryAfterSeconds?: number;
  // If a mutation reached fetch, cancellation/network failure cannot prove rollback.
  readonly dispatched: boolean;
  constructor(code: string, options: { kind?: FailureKind; status?: number; correlationId?: string;
    details?: { field: string; code: string }[]; retryAfterSeconds?: number; dispatched?: boolean } = {}) {
    const safe = responseCodes.has(code) || code === 'SCOPE_CHANGED' ? code : 'TEMPORARILY_UNAVAILABLE';
    super(safe); this.name = 'ApiFailure'; this.code = safe;
    this.kind = options.kind ?? 'response'; this.status = options.status;
    this.correlationId = options.correlationId;
    this.details = Object.freeze((options.details ?? []).map(detail => Object.freeze(detail)));
    this.retryAfterSeconds = options.retryAfterSeconds; this.dispatched = options.dispatched ?? false;
  }
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function responseFailure(status: number, body: unknown, retryAfter: string | null, fields: readonly string[], dispatched: boolean) {
  const error = record(record(body).error);
  // HTTP authentication/visibility status stays authoritative even for a broken proxy envelope.
  const fallback: Record<number, string> = { 401: 'UNAUTHENTICATED', 403: 'ACTION_FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 408: 'REQUEST_TIMEOUT', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 503: 'TEMPORARILY_UNAVAILABLE' };
  const code = [401, 403, 404].includes(status) ? fallback[status] : typeof error.code === 'string' && statusCodes[status]?.includes(error.code) ? error.code : fallback[status] ?? 'TEMPORARILY_UNAVAILABLE';
  const correlationId = typeof error.correlation_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(error.correlation_id) ? error.correlation_id : undefined;
  const details = status === 422 && code === 'VALIDATION_FAILED' && Array.isArray(error.details) ? error.details.slice(0, 32).flatMap(value => {
    const detail = record(value);
    return typeof detail.field === 'string' && fields.includes(detail.field) && typeof detail.code === 'string' && validationCodes.has(detail.code) ? [{ field: detail.field, code: detail.code }] : [];
  }) : [];
  const retryAfterSeconds = retryAfter && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : undefined;
  return new ApiFailure(code, { status, correlationId, details, retryAfterSeconds, dispatched });
}
export type Recovery = 'reauthenticate' | 'unavailable' | 'validate' | 'refresh' | 'conflict' | 'pending' | 'uncertain' | 'retry' | 'cancelled';
export function recoveryFor(error: ApiFailure, mutation: boolean): Recovery {
  if (error.code === 'UNAUTHENTICATED') return 'reauthenticate';
  if (['ACTION_FORBIDDEN', 'RESOURCE_NOT_FOUND', 'SCOPE_CHANGED'].includes(error.code)) return 'unavailable';
  if (error.code === 'VALIDATION_FAILED') return 'validate';
  if (['VERSION_CONFLICT', 'CURSOR_INVALID'].includes(error.code)) return 'refresh';
  if (error.code === 'IDEMPOTENCY_IN_PROGRESS') return 'pending';
  if (error.status === 409) return 'conflict';
  if (mutation && error.dispatched && (['network', 'aborted', 'protocol'].includes(error.kind) || ['REQUEST_TIMEOUT', 'INTERNAL_ERROR', 'TEMPORARILY_UNAVAILABLE'].includes(error.code))) return 'uncertain';
  if (error.kind === 'aborted') return 'cancelled';
  return 'retry';
}
