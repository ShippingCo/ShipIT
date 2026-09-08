import { createDatabaseConfig, createPool } from '@shippingco/db';
import { ConfigurationError, type RuntimeConfig } from './env.ts';
import type { SecretResolver } from './secrets.ts';
import { buildServer } from './server.ts';
import { attachLifecycle } from './lifecycle.ts';
import type { LogSink } from './plugins/logging.ts';

export async function startRuntime({ config, secretResolver, logSink, signal }: {
  config: RuntimeConfig; secretResolver: SecretResolver; logSink?: LogSink; signal?: AbortSignal;
}) {
  if (!secretResolver || (config.environment !== 'developer' && secretResolver.kind !== 'managed') ||
    (config.databaseSecretRef.startsWith('local:') !== (secretResolver.kind === 'developer-local'))) {
    throw new ConfigurationError([{ field: 'DATABASE_SECRET_REF', code: 'INCONSISTENT' }]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolved: string;
  try {
    if (signal?.aborted) throw new Error();
    resolved = await Promise.race([
      secretResolver.resolve(config.databaseSecretRef, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error()); }, 10_000);
        controller.signal.addEventListener('abort', () => reject(new Error()), { once: true });
      }),
    ]);
  } catch { throw new ConfigurationError([{ field: 'DATABASE_SECRET_REF', code: 'INVALID_FORMAT' }]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  if (signal?.aborted) throw new Error('STARTUP_ABORTED');
  const database = createPool(createDatabaseConfig({ connectionString: resolved, environment: config.environment,
    tls: config.databaseTls, applicationName: 'shipit_api' }));
  let app;
  try { app = buildServer({ config, database, logSink }); }
  catch { await database.close(); throw new Error('STARTUP_FAILED'); }
  const lifecycle = attachLifecycle(app, database);
  try {
    await app.ready();
    if (signal?.aborted) throw new Error('STARTUP_ABORTED');
    await app.listen({ host: config.host, port: config.port });
    return { app, ...lifecycle };
  } catch {
    await lifecycle.shutdown();
    throw new Error('STARTUP_FAILED');
  }
}
