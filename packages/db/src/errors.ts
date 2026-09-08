export type DatabaseErrorCode = 'DB_CONFIG_INVALID' | 'DB_CONNECTION_FAILED' | 'DB_QUERY_FAILED' |
  'DB_TIMEOUT' | 'DB_CLOSED' | 'DB_TRANSACTION_FAILED' | 'DB_COMMIT_UNCERTAIN' |
  'DB_ROLLBACK_FAILED' | 'DB_MIGRATION_FAILED' | 'DB_MIGRATION_LOCKED' | 'DB_SHUTDOWN_FAILED';

// No driver error/cause, query, params or configuration may cross this boundary.
export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly sqlState?: string;
  constructor(code: DatabaseErrorCode, sqlState?: string) {
    super(code);
    this.name = 'DatabaseError';
    this.code = code;
    if (sqlState && /^[0-9A-Z]{5}$/.test(sqlState)) this.sqlState = sqlState;
  }
}
export function driverState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
}
export function isTransportFailure(error: unknown): boolean {
  const state = driverState(error);
  return state === undefined || state.startsWith('08') || state === '57P01' || state === '57P02' || state === '57P03';
}
export function databaseError(error: unknown, fallback: DatabaseErrorCode): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const state = driverState(error);
  const message = error instanceof Error ? error.message : '';
  const timeout = state === '57014' || state === '55P03' || /timeout|timed out/i.test(message);
  return new DatabaseError(timeout ? 'DB_TIMEOUT' : fallback, state);
}
