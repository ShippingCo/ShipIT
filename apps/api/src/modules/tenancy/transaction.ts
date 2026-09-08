import { DatabaseError, withTransaction, type DatabasePool, type TransactionExecutor } from '@shippingco/db';
import { TenancyError } from './errors.ts';

// #10 intentionally sanitizes arbitrary callback errors. Recover our known domain
// error only after its confirmed successful rollback, never after commit uncertainty
// or rollback failure. No raw driver error/cause escapes the infrastructure boundary.
export async function tenancyTransaction<T>(database: DatabasePool, work: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
  let domainError: TenancyError | undefined;
  try {
    return await withTransaction(database, async tx => {
      try { return await work(tx); }
      catch (error) { if (error instanceof TenancyError) domainError = error; throw error; }
    });
  } catch (error) {
    if (domainError && error instanceof DatabaseError && error.code === 'DB_TRANSACTION_FAILED') throw domainError;
    if (error instanceof DatabaseError) throw new TenancyError('TEMPORARILY_UNAVAILABLE');
    throw error;
  }
}
