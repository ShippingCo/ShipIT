import type { DatabasePool } from './pool.ts';
import { DatabaseError } from './errors.ts';
import type { DatabaseErrorCode } from './errors.ts';
export type DatabaseReadiness = { status: 'ready' } | { status: 'not_ready'; code: DatabaseErrorCode };
export async function checkDatabaseReadiness(pool: DatabasePool): Promise<DatabaseReadiness> {
  try { await pool.query('SELECT 1'); return { status: 'ready' }; }
  catch (error) { return { status: 'not_ready', code: error instanceof DatabaseError ? error.code : 'DB_CONNECTION_FAILED' }; }
}
