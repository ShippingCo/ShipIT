import type { QueryResultRow } from 'pg';
import type { QueryExecutor } from './pool.ts';
// SQL text stays visible at the call site; all data values go in params.
export function query<Row extends QueryResultRow>(executor: QueryExecutor, sql: string, params: readonly unknown[] = []) {
  return executor.query<Row>(sql, params);
}
