import { setTimeout as delay } from 'node:timers/promises';
import { checkDatabaseReadiness, createDatabaseConfig, createPool, type DatabasePool } from '@shippingco/db';
import type { RuntimeConfig } from './env.ts';
import type { SecretResolver } from './secrets.ts';
import type { Consumer } from './modules/outbox/types.ts';
import { createOutboxWorker, type WorkerTelemetry } from './modules/outbox/worker.ts';
import { productionConsumers } from './modules/outbox/consumers.ts';

/** One bounded cycle at a time. Shutdown stops claiming and drains the current DB effect. */
export function runOutboxLoop(database:DatabasePool,consumers:readonly Consumer[],signal:AbortSignal,telemetry:WorkerTelemetry) {
  const worker=createOutboxWorker(database,consumers,{telemetry});
  return (async()=>{
    while(!signal.aborted) {
      try { await worker.tick(signal); }
      catch { telemetry.emit('outbox_cycle_failed','TEMPORARILY_UNAVAILABLE'); }
      try { await delay(1000,undefined,{signal}); } catch { if(!signal.aborted)throw new Error('OUTBOX_TIMER_FAILED'); }
    }
  })();
}
export async function startOutboxRuntime(config:RuntimeConfig,resolver:SecretResolver,signal:AbortSignal,telemetry:WorkerTelemetry,
  consumers:readonly Consumer[]=productionConsumers) {
  if((config.environment!=='developer'&&resolver.kind!=='managed')||
    (config.databaseSecretRef.startsWith('local:')!==(resolver.kind==='developer-local')))throw new Error('OUTBOX_CONFIGURATION_INVALID');
  const deadline=AbortSignal.timeout(10000),resolutionSignal=AbortSignal.any([signal,deadline]);
  const connection=await Promise.race([resolver.resolve(config.databaseSecretRef,resolutionSignal),
    new Promise<never>((_,reject)=>{if(resolutionSignal.aborted)reject(new Error('OUTBOX_STARTUP_ABORTED'));
      else resolutionSignal.addEventListener('abort',()=>reject(new Error('OUTBOX_STARTUP_ABORTED')),{once:true});})]);
  const database=createPool(createDatabaseConfig({connectionString:connection,environment:config.environment,tls:config.databaseTls,
    applicationName:'shipit_outbox',maxConnections:2,statementTimeoutMs:5000,queryTimeoutMs:6000,idleTransactionTimeoutMs:10000}));
  try {
    if(signal.aborted||(await checkDatabaseReadiness(database)).status!=='ready')throw new Error('OUTBOX_STARTUP_FAILED');
    await runOutboxLoop(database,consumers,signal,telemetry);
  } finally { await database.close(); }
}
