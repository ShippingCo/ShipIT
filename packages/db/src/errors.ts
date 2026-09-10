export type DatabaseErrorCode = 'DB_CONFIG_INVALID' | 'DB_CONNECTION_FAILED' | 'DB_QUERY_FAILED' |
  'DB_TIMEOUT' | 'DB_CLOSED' | 'DB_TRANSACTION_FAILED' | 'DB_COMMIT_UNCERTAIN' |
  'DB_ROLLBACK_FAILED' | 'DB_MIGRATION_FAILED' | 'DB_MIGRATION_LOCKED' | 'DB_SHUTDOWN_FAILED';

const conflictConstraints = ['memberships_one_active_role_idx', 'invitations_one_pending_role_idx'] as const;
type ConflictConstraint = typeof conflictConstraints[number];

// Only reviewed schema identifiers may survive sanitization. Never driver detail,
// arbitrary constraint names, error/cause, query, params or configuration.
export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly sqlState?: string;
  readonly constraint?: ConflictConstraint;
  constructor(code: DatabaseErrorCode, sqlState?: string, constraint?: string) {
    super(code);
    this.name = 'DatabaseError';
    this.code = code;
    if (sqlState && /^[0-9A-Z]{5}$/.test(sqlState)) this.sqlState = sqlState;
    if (sqlState === '23505' && conflictConstraints.some(value => value === constraint)) {
      this.constraint = constraint as ConflictConstraint;
    }
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
  const constraint = typeof error === 'object' && error !== null && 'constraint' in error &&
    typeof error.constraint === 'string' ? error.constraint : undefined;
  return new DatabaseError(timeout ? 'DB_TIMEOUT' : fallback, state, constraint);
}
