import { closePool, type DatabasePool } from '@shippingco/db';
import type { FastifyInstance } from 'fastify';
import { HttpError } from './plugins/errors.ts';

export const SHUTDOWN_DRAIN_MS = 10_000;
export const SHUTDOWN_DEADLINE_MS = 15_000;
export class ShutdownError extends Error { constructor() { super('SHUTDOWN_FAILED'); } }

// One owner, one idempotent close; never hide resource creation in buildServer.
export function attachLifecycle(app: FastifyInstance, database: DatabasePool,
  deadlines = { drainMs: SHUTDOWN_DRAIN_MS, totalMs: SHUTDOWN_DEADLINE_MS }) {
  let stopping = false;
  let poolClosing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const closeDatabase = () => poolClosing ??= closePool(database);
  app.addHook('onRequest', async () => { if (stopping) throw new HttpError('TEMPORARILY_UNAVAILABLE'); });
  app.addHook('onClose', closeDatabase);
  function shutdown(): Promise<void> {
    if (closing) return closing;
    stopping = true;
    closing = (async () => {
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      let totalTimer: ReturnType<typeof setTimeout> | undefined;
      const graceful = app.close();
      // Attach immediately: later rejection must never escape after timeout wins.
      void graceful.catch(() => {});
      try {
        await Promise.race([
          (async () => {
            let failed = false;
            try {
              const drained = await Promise.race([
                graceful.then(() => true),
                new Promise<false>(resolve => { drainTimer = setTimeout(() => resolve(false), deadlines.drainMs); }),
              ]);
              if (!drained) failed = true;
            } catch { failed = true; }
            if (failed) app.server.closeAllConnections();
            // Even an unrelated close-hook failure must await owned DB cleanup,
            // bounded by the same total deadline.
            try { await closeDatabase(); } catch { failed = true; }
            if (failed) throw new ShutdownError();
          })(),
          new Promise<never>((_, reject) => {
            totalTimer = setTimeout(() => {
              app.server.closeAllConnections();
              void closeDatabase().catch(() => {});
              reject(new ShutdownError());
            }, deadlines.totalMs);
          }),
        ]);
      } catch {
        app.server.closeAllConnections();
        // Initiate cleanup even if an onClose hook failed; process owner exits nonzero.
        void closeDatabase().catch(() => {});
        throw new ShutdownError();
      } finally { clearTimeout(drainTimer); clearTimeout(totalTimer); }
    })();
    return closing;
  }
  return { shutdown, isStopping: () => stopping };
}
