import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createDatabaseConfig, pgOptions } from './config.ts';
import type { DatabaseConfigInput } from './config.ts';
import { boundedShutdown } from './shutdown.ts';
import { DatabaseError, databaseError, isTransportFailure } from './errors.ts';
export interface QueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;
}
export interface DatabaseClient extends QueryExecutor { release(discard?: boolean): void }
export interface DatabasePool extends QueryExecutor {
  connect(): Promise<DatabaseClient>;
  close(): Promise<void>;
  stats(): { total: number; idle: number; waiting: number };
}

export function createPool(input: DatabaseConfigInput): DatabasePool {
  const config = createDatabaseConfig(input);
  const native = new Pool(pgOptions(config));
  // pg removes failed idle clients itself; do not leak raw driver data to logs.
  native.on('error', () => { /* Subsequent readiness reports a controlled status. */ });
  const sockets = new Map<PoolClient, Promise<void>>();
  native.on('connect', (raw: PoolClient) => {
    sockets.set(raw, new Promise<void>(resolve => {
      raw.once('end', () => { sockets.delete(raw); resolve(); });
    }));
  });
  const leases = new Set<{ destroy(): void }>();
  const acquisitions = new Set<Promise<void>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  function lease(raw: PoolClient): DatabaseClient {
    let released = false;
    let damaged = false;
    const onError = () => { damaged = true; };
    raw.on('error', onError);
    const release = (destroy = false) => {
      if (released) return;
      released = true;
      raw.removeListener('error', onError);
      leases.delete(tracked);
      raw.release(destroy || damaged);
    };
    const tracked = { destroy: () => release(true) };
    leases.add(tracked);
    return {
      async query<Row extends QueryResultRow>(sql: string, params: readonly unknown[] = []) {
        if (released || closed || damaged) throw new DatabaseError('DB_CLOSED');
        try { return await raw.query<Row>(sql, [...params]); }
        catch (error) {
          if (isTransportFailure(error)) damaged = true;
          throw databaseError(error, 'DB_QUERY_FAILED');
        }
      },
      release: (discard = false) => release(discard),
    };
  }
  const pool: DatabasePool = {
    connect() {
      if (closed) return Promise.reject(new DatabaseError('DB_CLOSED'));
      const acquisition = (async () => {
        let raw: PoolClient;
        try { raw = await native.connect(); }
        catch (error) {
          if (closed) throw new DatabaseError('DB_CLOSED');
          throw databaseError(error, 'DB_CONNECTION_FAILED');
        }
        if (closed) { raw.release(true); throw new DatabaseError('DB_CLOSED'); }
        return lease(raw);
      })();
      // pg.end() does not drain its acquisition queue. Track settlement, including
      // rejection, so close keeps its deadline timer alive until every waiter ends.
      const settled = acquisition.then(() => {}, () => {});
      acquisitions.add(settled);
      void settled.then(() => { acquisitions.delete(settled); });
      return acquisition;
    },
    async query<Row extends QueryResultRow>(sql: string, params: readonly unknown[] = []) {
      const client = await pool.connect();
      try { return await client.query<Row>(sql, params); }
      finally { client.release(); }
    },
    close() {
      if (closing) return closing;
      closed = true;
      // Caller drains application work first. Outstanding leases are invalidated at shutdown.
      for (const client of leases) client.destroy();
      closing = boundedShutdown(async () => {
        await native.end();
        await Promise.all([...acquisitions]);
        await Promise.all([...sockets.values()]);
      }, () => {
        for (const raw of sockets.keys()) raw.connection.stream.destroy();
      }, config.connectionTimeoutMs + 2000);
      return closing;
    },
    stats: () => ({ total: native.totalCount, idle: native.idleCount, waiting: native.waitingCount }),
  };
  return pool;
}
export async function closePool(pool: DatabasePool): Promise<void> { await pool.close(); }
