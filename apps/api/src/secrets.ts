import { ConfigurationError, type RuntimeConfig } from './env.ts';
export interface SecretResolver {
  readonly kind: 'managed' | 'developer-local';
  resolve(reference: string, signal: AbortSignal): Promise<string>;
}
// #68 injects a managed resolver backed by workload identity. No vendor is selected.
export function developerSecretResolver(config: RuntimeConfig, value: string | undefined, authValue?: string): SecretResolver {
  const refuse = (): never => { throw new ConfigurationError([{ field: 'LOCAL_DATABASE_URL', code: 'INCONSISTENT' }]); };
  if (config.environment !== 'developer' || config.databaseSecretRef !== 'local:database') refuse();
  try {
    const url = new URL(value ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username !== 'db_developer' || url.pathname !== '/shipit_developer' || !url.password || url.search || url.hash) refuse();
  } catch { return refuse(); }
  return { kind: 'developer-local', resolve: async reference => {
    if (reference==='local:database') return value!;
    if (reference==='local:auth' && authValue) return authValue;
    throw new Error('SECRET_UNAVAILABLE');
  } };
}
