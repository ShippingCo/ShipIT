import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import type { FastifyBaseLogger, FastifyInstance, FastifySchemaValidationError } from 'fastify';

const errors = {
  MALFORMED_REQUEST: [400, 'Request syntax is invalid.'],
  UNAUTHENTICATED: [401, 'Authentication is required.'],
  ACTION_FORBIDDEN: [403, 'Action is not permitted.'],
  RESOURCE_NOT_FOUND: [404, 'Resource not found.'],
  IDEMPOTENCY_CONFLICT: [409, 'Request key was already used for a different command.'],
  IDEMPOTENCY_IN_PROGRESS: [409, 'Request is still being resolved. Retry the same request.'],
  VERSION_CONFLICT: [409, 'Resource version has changed.'],
  MEMBERSHIP_CONFLICT: [409, 'An active membership already grants this role.'],
  INVITATION_CONFLICT: [409, 'An active invitation already grants this role.'],
  FRANCHISE_CODE_CONFLICT: [409, 'Franchise code is already in use in this organization.'],
  FRANCHISE_DISABLED: [409, 'Franchise is disabled for operational writes.'],
  ORGANIZATION_DISABLED: [409, 'Organization is disabled for operational writes.'],
  REQUEST_TIMEOUT: [408, 'Request did not complete within the permitted time.'],
  HEADERS_TOO_LARGE: [431, 'Request headers exceed the permitted size.'],
  PAYLOAD_TOO_LARGE: [413, 'Request body exceeds the permitted size.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Request body must use supported JSON.'],
  CURSOR_INVALID: [422, 'Cursor is invalid. Restart the authorized query.'],
  VALIDATION_FAILED: [422, 'One or more request fields are invalid.'],
  RATE_LIMITED: [429, 'Too many requests. Retry later.'],
  INTERNAL_ERROR: [500, 'An unexpected error occurred.'],
  TEMPORARILY_UNAVAILABLE: [503, 'Service is temporarily unavailable.'],
} as const;
export type PublicErrorCode = keyof typeof errors;
export class HttpError extends Error {
  readonly code: PublicErrorCode;
  constructor(code: PublicErrorCode) { super(code); this.code = code; }
}
export type ValidationField = '$' | 'name' | 'phone' | 'address' | 'expected_version' | 'search_by' | 'q' | 'limit' | 'cursor' | 'organization_id' | 'franchise_id' | 'customer_id' | 'idempotency_key';
export type ValidationCode = 'REQUIRED' | 'INVALID_TYPE' | 'INVALID_FORMAT' | 'OUT_OF_RANGE' | 'UNKNOWN_FIELD';
export class FieldValidationError extends HttpError {
  readonly details: { field: ValidationField; code: ValidationCode }[];
  constructor(field: ValidationField, code: ValidationCode) {
    super('VALIDATION_FAILED'); this.details = [{ field, code }];
  }
}
export function errorEnvelope(code: PublicErrorCode, correlationId: string) {
  return { error: { code, message: errors[code][1], correlation_id: correlationId } };
}
function detail(error: FastifySchemaValidationError) {
  const codes: Record<string, string> = { required: 'REQUIRED', type: 'INVALID_TYPE', additionalProperties: 'UNKNOWN_FIELD',
    minimum: 'OUT_OF_RANGE', maximum: 'OUT_OF_RANGE', minLength: 'OUT_OF_RANGE', maxLength: 'OUT_OF_RANGE',
    minItems: 'OUT_OF_RANGE', maxItems: 'OUT_OF_RANGE' };
  // schemaPath is server-owned. instancePath/additionalProperty can contain attacker keys.
  const segments = error.schemaPath.split('/');
  const fields = segments.filter((_, index) => segments[index - 1] === 'properties');
  return { field: fields.join('.') || '$', code: codes[error.keyword] ?? 'INVALID_FORMAT' };
}
export function registerErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const e = error as { code?: string; validation?: FastifySchemaValidationError[] };
    let code: PublicErrorCode = 'INTERNAL_ERROR';
    if (error instanceof HttpError) code = error.code;
    else if (e.validation) code = 'VALIDATION_FAILED';
    else if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') code = 'PAYLOAD_TOO_LARGE';
    else if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') code = 'UNSUPPORTED_MEDIA_TYPE';
    else if (['FST_ERR_CTP_EMPTY_JSON_BODY', 'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_INVALID_CONTENT_LENGTH', 'FST_ERR_BAD_URL'].includes(e.code ?? '')) code = 'MALFORMED_REQUEST';
    else if (e.code === 'FST_ERR_INSTANCE_CLOSING') code = 'TEMPORARILY_UNAVAILABLE';
    if (code === 'INTERNAL_ERROR') request.log.error({ event: 'request_failed', code, request_id: request.id }, 'Request failed');
    const envelope = errorEnvelope(code, request.id);
    const response = code === 'VALIDATION_FAILED'
      ? { error: { ...envelope.error, details: error instanceof FieldValidationError ? error.details : (e.validation ?? []).slice(0, 10).map(detail) } } : envelope;
    return reply.code(errors[code][0]).send(response);
  });
}

// HTTP parser failures precede FastifyRequest creation and therefore its hooks.
// This supported clientErrorHandler keeps even that transport response redacted.
export function rejectTransport(error: { code?: string }, socket: Socket, logger: FastifyBaseLogger) {
  if (socket.destroyed || !socket.writable || error.code === 'ECONNRESET') return;
  const code = error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 'REQUEST_TIMEOUT'
    : error.code === 'HPE_HEADER_OVERFLOW' ? 'HEADERS_TOO_LARGE' : 'MALFORMED_REQUEST';
  const status = errors[code][0], id = randomUUID();
  const body = JSON.stringify(errorEnvelope(code, id));
  socket.end(`HTTP/1.1 ${status} Error\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\nX-Request-Id: ${id}\r\n\r\n${body}`);
  socket.destroySoon();
  logger.info({ event: 'request_rejected', request_id: id, status, code }, 'Request rejected');
}
