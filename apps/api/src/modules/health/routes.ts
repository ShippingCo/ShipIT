import { checkDatabaseReadiness, type DatabasePool } from '@shippingco/db';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../plugins/errors.ts';
export function registerHealth(app: FastifyInstance, database: DatabasePool) {
  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ status: 'alive' }));
  app.get('/health/ready', { config: { rateLimit: false } }, async () => {
    const readiness = await checkDatabaseReadiness(database);
    if (readiness.status !== 'ready') throw new HttpError('TEMPORARILY_UNAVAILABLE');
    return { status: 'ready' };
  });
}
