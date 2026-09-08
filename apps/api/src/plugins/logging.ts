import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { RuntimeConfig } from '../env.ts';
export interface LogSink { write(message: string): void }
export function loggerOptions(config: RuntimeConfig, stream?: LogSink): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel, ...(stream ? { stream } : {}),
    redact: { paths: ['req.headers', 'req.body', 'res.headers', 'res.body', 'headers', 'body', 'password', 'authorization', 'cookie', 'connectionString'], remove: true },
    serializers: {
      req: () => ({}),
      res: () => ({}),
      err: () => ({ type: 'Error', code: 'REDACTED_ERROR', message: 'Redacted error', stack: '' }),
    },
  };
}
export function registerRequestLogging(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ event: 'request_completed', request_id: request.id, method: request.routeOptions.method,
      route: request.routeOptions.url ?? 'unmatched', status: reply.statusCode, duration_ms: reply.elapsedTime }, 'Request completed');
  });
}
