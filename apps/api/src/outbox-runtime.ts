import { setTimeout as delay } from 'node:timers/promises';
import { checkDatabaseReadiness, createDatabaseConfig, createPool, type DatabasePool } from '@shippingco/db';
import type { RuntimeConfig } from './env.ts';
import type { SecretResolver } from './secrets.ts';
import type { Consumer } from './modules/outbox/types.ts';
import { parseWhatsappConfiguration } from './modules/whatsapp/config.ts';
import { createMetaProvider } from './modules/whatsapp/provider.ts';
import { createOutboxWorker, type WorkerTelemetry } from './modules/outbox/worker.ts';
import { productionConsumers } from './modules/outbox/consumers.ts';
import { policyActivationDocument } from './modules/automation/registry.ts';
import { activateNotificationPolicies } from './modules/security/jobs.ts';
import { createRouteDelayFanoutWorker } from './modules/automation/delay-worker.ts';

/** One bounded cycle at a time. Shutdown stops claiming and drains the current DB effect. */
export function runOutboxLoop(database:DatabasePool,consumers:readonly Consumer[],signal:AbortSignal,telemetry:WorkerTelemetry,
  fanout?:ReturnType<typeof createRouteDelayFanoutWorker>) {
  const worker=createOutboxWorker(database,consumers,{telemetry});
  return (async()=>{
    while(!signal.aborted) {
      try { await worker.tick(signal); }
      catch { telemetry.emit('outbox_cycle_failed','TEMPORARILY_UNAVAILABLE'); }
      if(!signal.aborted&&fanout)try { await fanout.tick(); }
      catch { telemetry.emit('outbox_cycle_failed','TEMPORARILY_UNAVAILABLE'); }
      try { await delay(1000,undefined,{signal}); } catch { if(!signal.aborted)throw new Error('OUTBOX_TIMER_FAILED'); }
    }
  })();
}
export async function startOutboxRuntime(config:RuntimeConfig,resolver:SecretResolver,signal:AbortSignal,telemetry:WorkerTelemetry,
  injectedConsumers?:readonly Consumer[]) {
  if((config.environment!=='developer'&&resolver.kind!=='managed')||
    (config.databaseSecretRef.startsWith('local:')!==(resolver.kind==='developer-local')))throw new Error('OUTBOX_CONFIGURATION_INVALID');
  const deadline=AbortSignal.timeout(10000),resolutionSignal=AbortSignal.any([signal,deadline]);
  const values=await Promise.race([Promise.all([resolver.resolve(config.databaseSecretRef,resolutionSignal),
    !injectedConsumers&&config.whatsappConfigRef?resolver.resolve(config.whatsappConfigRef,resolutionSignal):Promise.resolve(undefined)]),
    new Promise<never>((_,reject)=>{if(resolutionSignal.aborted)reject(new Error('OUTBOX_STARTUP_ABORTED'));
      else resolutionSignal.addEventListener('abort',()=>reject(new Error('OUTBOX_STARTUP_ABORTED')),{once:true});})]);
  const database=createPool(createDatabaseConfig({connectionString:values[0],environment:config.environment,tls:config.databaseTls,
    applicationName:'shipit_outbox',maxConnections:2,statementTimeoutMs:5000,queryTimeoutMs:6000,idleTransactionTimeoutMs:10000}));
  try {
    if(signal.aborted||(await checkDatabaseReadiness(database)).status!=='ready')throw new Error('OUTBOX_STARTUP_FAILED');
    let consumers=injectedConsumers,fanout:ReturnType<typeof createRouteDelayFanoutWorker>|undefined;
    if(!consumers) {
      if(!values[1])throw new Error('NOTIFICATION_AUTOMATION_CONFIGURATION_REQUIRED');
      const configuration=parseWhatsappConfiguration(values[1],config.environment);
      if(!configuration.webhook||!configuration.automation)throw new Error('NOTIFICATION_AUTOMATION_CONFIGURATION_REQUIRED');
      const owners=[...new Map(configuration.bindings.map(b=>[`${b.organization_id}:${b.franchise_id}`,
        {organization_id:b.organization_id,franchise_id:b.franchise_id}])).values()];
      if(!owners.length)throw new Error('NOTIFICATION_AUTOMATION_CONFIGURATION_REQUIRED');
      await activateNotificationPolicies(database,owners,policyActivationDocument(configuration.automation.policies));
      const dependencies={configuration,provider:createMetaProvider({configuration,secrets:resolver})};
      consumers=productionConsumers(dependencies);fanout=createRouteDelayFanoutWorker(database,dependencies);
    }
    await runOutboxLoop(database,consumers,signal,telemetry,fanout);
  } finally { await database.close(); }
}
