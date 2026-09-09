import { createDatabaseConfig, createPool } from '@shippingco/db';
import { ConfigurationError, type RuntimeConfig } from './env.ts';
import type { SecretResolver } from './secrets.ts';
import { buildServer } from './server.ts';
import { attachLifecycle } from './lifecycle.ts';
import type { LogSink } from './plugins/logging.ts';
import { parseAuthConfig, type AuthConfiguration } from './modules/auth/config.ts';
import { createDeliveryWorker } from './modules/auth/worker.ts';
import { createSender } from './modules/auth/delivery.ts';

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
  let auth: AuthConfiguration | undefined;
  try {
    if (signal?.aborted) throw new Error();
    const values = await Promise.race([
      Promise.all([secretResolver.resolve(config.databaseSecretRef, controller.signal),
        config.authSecretRef ? secretResolver.resolve(config.authSecretRef,controller.signal) : Promise.resolve(undefined)]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error()); }, 10_000);
        controller.signal.addEventListener('abort', () => reject(new Error()), { once: true });
      }),
    ]);
    resolved=values[0];
    if (values[1]!==undefined) {
      try {auth=parseAuthConfig(values[1],config.environment==='developer');}
      catch {throw new ConfigurationError([{field:'AUTH_SECRET_REF',code:'INVALID_FORMAT'}]);}
    }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError([{ field: 'DATABASE_SECRET_REF', code: 'INVALID_FORMAT' }]);
  }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  if (signal?.aborted) throw new Error('STARTUP_ABORTED');
  const database = createPool(createDatabaseConfig({ connectionString: resolved, environment: config.environment,
    tls: config.databaseTls, applicationName: 'shipit_api' }));
  let app;
  try { app = buildServer({ config, database, logSink, auth }); }
  catch { await database.close(); throw new Error('STARTUP_FAILED'); }
  const lifecycle = attachLifecycle(app, database);
  if (auth) {
    const worker=createDeliveryWorker(database,auth.keys,createSender(auth.delivery));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> = Promise.resolve();
    let stopped=false, cycles=0;
    const cycle=async () => {
      try { await worker.tick(); if (++cycles%60===0) await worker.cleanup(); }
      catch { app.log.error({event:'auth_delivery_failed',code:'TEMPORARILY_UNAVAILABLE'},'Authentication delivery unavailable'); }
      if (!stopped) timer=setTimeout(()=>{ pending=cycle(); },1000);
    };
    app.addHook('onReady',async ()=>{ timer=setTimeout(()=>{ pending=cycle(); },1000); });
    app.addHook('preClose',async ()=>{ stopped=true; clearTimeout(timer); await pending; });
  }
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
