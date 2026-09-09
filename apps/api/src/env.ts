import { isIP } from 'node:net';
import { X509Certificate } from 'node:crypto';
import type { DatabaseEnvironment, DatabaseTls } from '@shippingco/db';

export type RuntimeEnvironment = Exclude<DatabaseEnvironment, 'test'>;
export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly allowedOrigins: readonly string[];
  readonly trustedProxyHops: number;
  readonly trustedProxyAddresses: readonly string[];
  readonly databaseSecretRef: string;
  readonly databaseTls: DatabaseTls;
  readonly authSecretRef?: string;
}
export interface ConfigurationIssue { field: string; code: 'REQUIRED' | 'INVALID_FORMAT' | 'OUT_OF_RANGE' | 'INCONSISTENT' }
export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];
  constructor(issues: ConfigurationIssue[]) {
    super('CONFIGURATION_INVALID');
    this.name = 'ConfigurationError';
    this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })));
  }
}
// Pure boundary: only index.ts supplies process.env. Never retain rejected values.
export function parseEnvironment(env: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  const issues: ConfigurationIssue[] = [];
  const issue = (field: string, code: ConfigurationIssue['code']) => { issues.push({ field, code }); };
  function required(field: string): string {
    const value = env[field];
    if (!value) { issue(field, 'REQUIRED'); return ''; }
    return value;
  }
  const mode = required('NODE_ENV');
  const modes: Record<string, RuntimeEnvironment> = { development: 'developer', demo: 'demo', staging: 'staging', production: 'production' };
  const environment = Object.hasOwn(modes, mode) ? modes[mode]! : undefined;
  if (mode && !environment) issue('NODE_ENV', 'INVALID_FORMAT');
  function integer(field: string, min: number, max: number): number {
    const raw = required(field);
    if (raw && !/^(0|[1-9][0-9]*)$/.test(raw)) issue(field, 'INVALID_FORMAT');
    const value = Number(raw);
    if (raw && (!Number.isSafeInteger(value) || value < min || value > max)) issue(field, 'OUT_OF_RANGE');
    return value;
  }
  const port = integer('PORT', 1, 65535);
  const host = required('HOST');
  if (host && !isIP(host)) issue('HOST', 'INVALID_FORMAT');
  const logLevel = required('LOG_LEVEL');
  if (logLevel && !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) issue('LOG_LEVEL', 'INVALID_FORMAT');
  const trustedProxyHops = integer('TRUSTED_PROXY_HOPS', 0, 5);
  const proxyAddresses = env.TRUSTED_PROXY_ADDRESSES ?? '';
  const trustedProxyAddresses = proxyAddresses ? proxyAddresses.split(',').map(value => value.trim()) : [];
  if (trustedProxyHops > 0 && !proxyAddresses) issue('TRUSTED_PROXY_ADDRESSES', 'REQUIRED');
  if (trustedProxyHops === 0 && proxyAddresses) issue('TRUSTED_PROXY_ADDRESSES', 'INCONSISTENT');
  if (trustedProxyAddresses.length > 16 || trustedProxyAddresses.some(value => !isIP(value))) issue('TRUSTED_PROXY_ADDRESSES', 'INVALID_FORMAT');
  const origins = required('ALLOWED_ORIGINS');
  const allowedOrigins = origins.split(',').map(value => value.trim());
  if (origins) {
    if (allowedOrigins.length > 32 || new Set(allowedOrigins).size !== allowedOrigins.length) issue('ALLOWED_ORIGINS', 'INVALID_FORMAT');
    for (const value of allowedOrigins) {
      try {
        const url = new URL(value);
        // Require canonical origins, including no trailing slash/default port/credentials.
        if (url.origin !== value || !['http:', 'https:'].includes(url.protocol) || value.includes('*')) throw new Error();
        if (url.protocol === 'http:' && !(environment === 'developer' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
          issue('ALLOWED_ORIGINS', 'INCONSISTENT');
        }
      } catch { issue('ALLOWED_ORIGINS', 'INVALID_FORMAT'); }
    }
  }
  const databaseSecretRef = required('DATABASE_SECRET_REF');
  // Vendor-neutral opaque reference, not a resolved URL. #68 chooses managed syntax.
  if (databaseSecretRef && (!/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,511}$/.test(databaseSecretRef) || databaseSecretRef.includes('://'))) issue('DATABASE_SECRET_REF', 'INVALID_FORMAT');
  if (databaseSecretRef.startsWith('local:') && (environment !== 'developer' || databaseSecretRef !== 'local:database')) issue('DATABASE_SECRET_REF', 'INCONSISTENT');
  const tls = required('DATABASE_TLS_MODE');
  if (tls && tls !== 'disable' && tls !== 'verify-full') issue('DATABASE_TLS_MODE', 'INVALID_FORMAT');
  if ((environment === 'staging' || environment === 'production') && tls !== 'verify-full') issue('DATABASE_TLS_MODE', 'INCONSISTENT');
  const ca = env.DATABASE_CA_PEM;
  if (ca !== undefined) {
    try {
      const pem = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
      const certificates = ca.match(pem) ?? [];
      if (tls !== 'verify-full' || !certificates.length || ca.replace(pem, '').trim()) throw new Error();
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch { issue('DATABASE_CA_PEM', 'INVALID_FORMAT'); }
  }
  if (env.LOCAL_DATABASE_URL !== undefined && (environment !== 'developer' || databaseSecretRef !== 'local:database')) issue('LOCAL_DATABASE_URL', 'INCONSISTENT');
  const authSecretRef=env.AUTH_SECRET_REF;
  if (authSecretRef !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,511}$/.test(authSecretRef) || authSecretRef.includes('://'))) issue('AUTH_SECRET_REF','INVALID_FORMAT');
  if (authSecretRef?.startsWith('local:') && (environment!=='developer' || authSecretRef!=='local:auth')) issue('AUTH_SECRET_REF','INCONSISTENT');
  if (issues.length) throw new ConfigurationError(issues);
  return Object.freeze({ environment: environment!, host, port, logLevel: logLevel as RuntimeConfig['logLevel'],
    allowedOrigins: Object.freeze(allowedOrigins), trustedProxyHops, trustedProxyAddresses: Object.freeze(trustedProxyAddresses), databaseSecretRef,
    databaseTls: Object.freeze(tls === 'verify-full' ? { mode: 'verify-full', ...(ca ? { ca } : {}) } : { mode: 'disable' }),
    ...(authSecretRef ? {authSecretRef} : {}),
  });
}
