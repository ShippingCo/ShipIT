import { DatabaseError, databaseError } from './errors.ts';
import type { DatabasePool, QueryExecutor } from './pool.ts';
export async function withTransaction<T>(pool: DatabasePool, work: (tx: QueryExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let phase: 'begin' | 'work' | 'commit' = 'begin';
  let active = true;
  let discard = false;
  const tx: QueryExecutor = {
    query: (sql, params) => {
      if (!active) return Promise.reject(new DatabaseError('DB_CLOSED'));
      return client.query(sql, params);
    },
  };
  try {
    await client.query('BEGIN');
    phase = 'work';
    const result = await work(tx);
    active = false;
    phase = 'commit';
    const committed = await client.query('COMMIT');
    if (committed.command !== 'COMMIT') {
      phase = 'work';
      throw new DatabaseError('DB_TRANSACTION_FAILED');
    }
    return result;
  } catch (error) {
    active = false;
    try { await client.query('ROLLBACK'); }
    catch {
      discard = true;
      // A rejected COMMIT never proves rollback, even if rollback itself also fails.
      throw new DatabaseError(phase === 'commit' ? 'DB_COMMIT_UNCERTAIN' : 'DB_ROLLBACK_FAILED');
    }
    if (phase === 'commit') {
      discard = true;
      throw new DatabaseError('DB_COMMIT_UNCERTAIN');
    }
    throw databaseError(error, 'DB_TRANSACTION_FAILED');
  } finally {
    active = false;
    client.release(discard);
  }
}
