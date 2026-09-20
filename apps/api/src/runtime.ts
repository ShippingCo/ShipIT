import { parseWhatsappConfiguration } from './modules/whatsapp/config.ts';
import { createMetaProvider } from './modules/whatsapp/provider.ts';
import { createInboxWorker } from './modules/whatsapp/inbox-worker.ts';
import type { WhatsappDependencies } from './modules/whatsapp/types.ts';
import { parseAttachmentConfiguration, attachmentAdapters } from './modules/attachments/config.ts';
import type { AttachmentDependencies } from './modules/attachments/types.ts';
import { createDatabaseConfig, createPool } from '@shippingco/db';
import { ConfigurationError, type RuntimeConfig } from './env.ts';
import type { SecretResolver } from './secrets.ts';
import { buildServer } from './server.ts';
import { attachLifecycle } from './lifecycle.ts';
import type { LogSink } from './plugins/logging.ts';
import { parseAuthConfig, type AuthConfiguration } from './modules/auth/config.ts';
import { createDeliveryWorker } from './modules/auth/worker.ts';
import { createAttachmentCleanup } from './modules/attachments/cleanup.ts';
import { createSender } from './modules/auth/delivery.ts';

export async function startRuntime({ config, secretResolver, logSink, signal }: {
  config: RuntimeConfig; secretResolver: SecretResolver; logSink?: LogSink; signal?: AbortSignal;
}) {
  if ((['staging','production'].includes(config.environment) && !config.storageSecretRef) || (config.storageSecretRef && !config.authSecretRef)) {
    throw new ConfigurationError([{field:'STORAGE_CREDENTIAL_REF',code:'REQUIRED'}]);
  }
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
  let attachments:AttachmentDependencies|undefined;
  let whatsapp:WhatsappDependencies|undefined;
  try {
    if (signal?.aborted) throw new Error();
    const values = await Promise.race([
      Promise.all([secretResolver.resolve(config.databaseSecretRef, controller.signal),
        config.authSecretRef ? secretResolver.resolve(config.authSecretRef,controller.signal) : Promise.resolve(undefined),
        config.storageSecretRef ? secretResolver.resolve(config.storageSecretRef,controller.signal) : Promise.resolve(undefined),
        config.whatsappConfigRef ? secretResolver.resolve(config.whatsappConfigRef,controller.signal) : Promise.resolve(undefined)]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error()); }, 10_000);
        controller.signal.addEventListener('abort', () => reject(new Error()), { once: true });
      }),
    ]);
    resolved=values[0];
    if(values[3]!==undefined){
      const configuration=parseWhatsappConfiguration(values[3],config.environment);
      whatsapp={configuration,provider:createMetaProvider({configuration,secrets:secretResolver})};
    }
    if(values[2]!==undefined)attachments=attachmentAdapters(parseAttachmentConfiguration(values[2],config.environment));
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
  try { app = buildServer({ config, database, logSink, auth, attachments, whatsapp }); }
  catch { attachments?.store.close?.(); await database.close(); throw new Error('STARTUP_FAILED'); }
  if(attachments)app.addHook('onClose',async()=>{attachments.store.close?.();});
  const lifecycle = attachLifecycle(app, database);
  if(whatsapp?.configuration.webhook) {
    const worker=createInboxWorker(database);
    let timer:ReturnType<typeof setTimeout>|undefined,stopped=false,pending:Promise<void>=Promise.resolve();
    const cycle=async()=>{
      try {
        // Bound each turn; multiple API replicas coordinate through SKIP LOCKED.
        for(let n=0;n<20&&!stopped;n++) {
          const outcome=await worker.tick();if(outcome===null)break;
          if(outcome==='quarantined')app.log.warn({event:'whatsapp_inbox_quarantined',code:'MANUAL_REVIEW_REQUIRED'},'Webhook processing needs review');
        }
      }catch{app.log.error({event:'whatsapp_inbox_failed',code:'TEMPORARILY_UNAVAILABLE'},'Webhook processing unavailable');}
      if(!stopped)timer=setTimeout(()=>{pending=cycle();},1000);
    };
    app.addHook('onReady',async()=>{timer=setTimeout(()=>{pending=cycle();},1000);});
    app.addHook('preClose',async()=>{stopped=true;clearTimeout(timer);await pending;});
  }
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
  if (attachments) {
    const cleanup=createAttachmentCleanup(database,attachments.store),cleanupStop=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined,stopped=false,pending:Promise<void>=Promise.resolve();
    const cycle=async()=>{
      try { await cleanup.tick(100,cleanupStop.signal); }
      catch { app.log.error({event:'attachment_cleanup_failed',code:'TEMPORARILY_UNAVAILABLE'},'Attachment cleanup unavailable'); }
      if(!stopped)timer=setTimeout(()=>{pending=cycle();},300000);
    };
    app.addHook('onReady',async()=>{timer=setTimeout(()=>{pending=cycle();},1000);});
    app.addHook('preClose',async()=>{stopped=true;clearTimeout(timer);cleanupStop.abort();await pending;});
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
