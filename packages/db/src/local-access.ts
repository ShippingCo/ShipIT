import { createDatabaseConfig } from './config.ts';
import type { DatabaseConfigInput } from './config.ts';

const flagNames = ['AGENT_MONEY_ENABLED', 'CASHBOOK_ENABLED', 'CASH_CLOSE_ENABLED', 'CUSTODY_ENABLED',
  'CUSTOMER_ACCOUNTS_ENABLED', 'FINANCIAL_WORKFLOW_ENABLED', 'MONEY_RECEIPTS_ENABLED', 'OWNER_SUMMARIES_ENABLED',
  'RECONCILIATION_ENABLED', 'SETTINGS_WRITES_ENABLED', 'SHIPMENT_COST_WRITES_ENABLED', 'LLM_ENABLED'] as const;
type Environment = Readonly<Record<string, string | undefined>>;

function localUrl(raw: string | undefined) {
  try {
    const url = new URL(raw ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.pathname !== '/shipit_developer' || !url.password || !url.username || url.search || url.hash) throw new Error();
    return url;
  } catch { throw new Error('ACCESS_LOCAL_TARGET_INVALID'); }
}
export function localAccessConfiguration(env: Environment, ownerRequired = false): { runtime: DatabaseConfigInput; owner?: DatabaseConfigInput } {
  if (env.NODE_ENV !== 'development' || env.SHIPIT_ENVIRONMENT !== 'developer' || env.DATABASE_TLS_MODE !== 'disable') {
    throw new Error('ACCESS_LOCAL_TARGET_INVALID');
  }
  const runtime = localUrl(env.LOCAL_DATABASE_URL);
  if (runtime.username !== 'db_developer') throw new Error('ACCESS_LOCAL_TARGET_INVALID');
  const config = (url: URL) => createDatabaseConfig({ connectionString: url.href, environment: 'developer',
    tls: { mode: 'disable' }, maxConnections: 1, applicationName: 'shipit_access', connectionTimeoutMs: 3000,
    statementTimeoutMs: 5000, queryTimeoutMs: 6000 });
  let owner: DatabaseConfigInput | undefined;
  if (ownerRequired || env.MIGRATION_DATABASE_URL) {
    const migration = localUrl(env.MIGRATION_DATABASE_URL);
    if (migration.hostname !== runtime.hostname || (migration.port || '5432') !== (runtime.port || '5432') ||
        migration.username === runtime.username) throw new Error('ACCESS_LOCAL_TARGET_MISMATCH');
    owner = config(migration);
  }
  return { runtime: config(runtime), owner };
}

export function localFeatureStates(env: Environment) {
  const flags: Record<string, 'on' | 'off' | 'invalid'> = {};
  for (const name of flagNames) {
    const value = env[name];
    flags[name] = value === 'true' ? 'on' : value === undefined || value === 'false' || (name === 'LLM_ENABLED' && value === '') ? 'off' : 'invalid';
  }
  const whatsapp: Record<string, 'on' | 'off' | 'not_configured' | 'invalid'> = {};
  if (!env.LOCAL_WHATSAPP_JSON) whatsapp.configuration = 'not_configured';
  else {
    try {
      const parsed: unknown = JSON.parse(env.LOCAL_WHATSAPP_JSON);
      const configuration = (parsed as { configuration?: Record<string, unknown> } | null)?.configuration;
      if (!configuration || typeof configuration !== 'object') throw new Error();
      for (const name of ['outbound_enabled', 'conversation_enabled']) {
        whatsapp[name] = configuration[name] === true ? 'on' : configuration[name] === false ? 'off' : 'invalid';
      }
    } catch { whatsapp.configuration = 'invalid'; }
  }
  return { flags, whatsapp };
}
