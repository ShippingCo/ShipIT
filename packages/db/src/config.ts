import type { PoolConfig } from 'pg';
import { DatabaseError } from './errors.ts';
export type DatabaseEnvironment = 'developer' | 'demo' | 'staging' | 'production' | 'test';
export type DatabaseTls = Readonly<{ mode: 'disable' }> | Readonly<{ mode: 'verify-full'; ca?: string }>;
export interface DatabaseConfigInput {
  connectionString: string;
  environment: DatabaseEnvironment;
  tls: DatabaseTls;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  statementTimeoutMs?: number;
  queryTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
  applicationName?: string;
}
export interface DatabaseConfig extends DatabaseConfigInput {
  maxConnections: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  queryTimeoutMs: number;
  idleTransactionTimeoutMs: number;
  applicationName: string;
}
export function createDatabaseConfig(input: DatabaseConfigInput): Readonly<DatabaseConfig> {
  const refuse = (): never => { throw new DatabaseError('DB_CONFIG_INVALID'); };
  if (!input || typeof input.connectionString !== 'string' ||
      !['developer', 'demo', 'staging', 'production', 'test'].includes(input.environment)) refuse();
  let url: URL;
  try { url = new URL(input.connectionString); } catch { return refuse(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || !url.password || !url.pathname.slice(1) || url.href.includes('?') || url.href.includes('#') ||
      url.hostname.includes('%') || url.pathname.slice(1).includes('/')) refuse();
  if (!input.tls || !['disable', 'verify-full'].includes(input.tls.mode)) refuse();
  if ((input.environment === 'production' || input.environment === 'staging') && input.tls.mode !== 'verify-full') refuse();
  if (input.tls.mode === 'verify-full' && input.tls.ca !== undefined &&
      (typeof input.tls.ca !== 'string' || !input.tls.ca.includes('-----BEGIN CERTIFICATE-----'))) refuse();
  const config: DatabaseConfig = {
    connectionString: input.connectionString, environment: input.environment, tls: Object.freeze({ ...input.tls }),
    maxConnections: input.maxConnections ?? 10,
    connectionTimeoutMs: input.connectionTimeoutMs ?? 2000,
    idleTimeoutMs: input.idleTimeoutMs ?? 30_000,
    statementTimeoutMs: input.statementTimeoutMs ?? 5000,
    queryTimeoutMs: input.queryTimeoutMs ?? 6000,
    idleTransactionTimeoutMs: input.idleTransactionTimeoutMs ?? 10_000,
    applicationName: input.applicationName ?? 'shipit',
  };
  for (const [value, max] of [[config.maxConnections, 50], [config.connectionTimeoutMs, 30_000],
    [config.idleTimeoutMs, 300_000], [config.statementTimeoutMs, 300_000],
    [config.queryTimeoutMs, 310_000], [config.idleTransactionTimeoutMs, 300_000]]) {
    if (!Number.isSafeInteger(value) || value! < 1 || value! > max!) refuse();
  }
  if (config.queryTimeoutMs <= config.statementTimeoutMs || !/^[a-z][a-z0-9_-]{0,62}$/.test(config.applicationName)) refuse();
  return Object.freeze(config);
}
// Parse into explicit driver fields: no PG* environment fallback or URL TLS override.
export function pgOptions(config: DatabaseConfigInput): PoolConfig {
  const safe = createDatabaseConfig(config);
  const url = new URL(safe.connectionString);
  let database: string, user: string, password: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { throw new DatabaseError('DB_CONFIG_INVALID'); }
  const owned = { replication: 'false', binary: false };
  return {
    ...owned,
    host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : 5432,
    database, user, password,
    ssl: safe.tls.mode === 'disable' ? false : { rejectUnauthorized: true, ...(safe.tls.ca ? { ca: safe.tls.ca } : {}) },
    max: safe.maxConnections, connectionTimeoutMillis: safe.connectionTimeoutMs,
    idleTimeoutMillis: safe.idleTimeoutMs, statement_timeout: safe.statementTimeoutMs,
    query_timeout: safe.queryTimeoutMs, idle_in_transaction_session_timeout: safe.idleTransactionTimeoutMs,
    application_name: safe.applicationName,
    options: '-c search_path=pg_catalog', client_encoding: 'UTF8',
    sslnegotiation: 'postgres',
  };
}
