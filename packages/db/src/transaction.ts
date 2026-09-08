import { DatabaseError, databaseError } from './errors.ts';
import type { DatabasePool, QueryExecutor } from './pool.ts';

const transactionBrand: unique symbol = Symbol('TransactionExecutor');
const activeTransactions = new WeakSet<QueryExecutor>();

/** Only withTransaction can create this executor; it expires before commit. */
export interface TransactionExecutor extends QueryExecutor {
  readonly [transactionBrand]: true;
}

/** Fail closed when a lock-dependent primitive receives a pool or expired tx. */
export function assertActiveTransaction(executor: QueryExecutor): asserts executor is TransactionExecutor {
  if (!activeTransactions.has(executor)) throw new DatabaseError('DB_TRANSACTION_FAILED');
}

export async function withTransaction<T>(pool: DatabasePool, work: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let phase: 'begin' | 'work' | 'commit' = 'begin';
  let active = true;
  let discard = false;
  const tx: TransactionExecutor = {
    [transactionBrand]: true,
    query: (sql, params) => {
      if (!active) return Promise.reject(new DatabaseError('DB_CLOSED'));
      return client.query(sql, params);
    },
  };
  try {
    await client.query('BEGIN');
    phase = 'work';
    activeTransactions.add(tx);
    const result = await work(tx);
    active = false;
    activeTransactions.delete(tx);
    phase = 'commit';
    const committed = await client.query('COMMIT');
    if (committed.command !== 'COMMIT') {
      phase = 'work';
      throw new DatabaseError('DB_TRANSACTION_FAILED');
    }
    return result;
  } catch (error) {
    active = false;
    activeTransactions.delete(tx);
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
    activeTransactions.delete(tx);
    client.release(discard);
  }
}
