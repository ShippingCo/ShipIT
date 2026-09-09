import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { createAuthService } from './modules/auth/service.ts';
import { registerAuth } from './modules/auth/routes.ts';
import { registerWebhook } from './modules/auth/webhook.ts';
import type { AuthConfiguration } from './modules/auth/config.ts';
import type { DatabasePool } from '@shippingco/db';
import type { RuntimeConfig } from './env.ts';
import { registerErrors, HttpError, errorEnvelope, rejectTransport } from './plugins/errors.ts';
import { registerJson, JSON_BODY_LIMIT } from './plugins/json.ts';
import { loggerOptions, registerRequestLogging, type LogSink } from './plugins/logging.ts';
import { registerHealth } from './modules/health/routes.ts';

export interface ServerDependencies { config: RuntimeConfig; database: DatabasePool; logSink?: LogSink; auth?: AuthConfiguration }
export function buildServer({ config, database, logSink, auth }: ServerDependencies) {
  const app: FastifyInstance = Fastify({
    logger: loggerOptions(config, logSink),
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    requestIdHeader: false, genReqId: () => randomUUID(),
    trustProxy: config.trustedProxyHops === 0 ? false : (address, hop) =>
      hop < config.trustedProxyHops && config.trustedProxyAddresses.includes(address.replace(/^::ffff:/, '')),
    clientErrorHandler: (error, socket) => rejectTransport(error, socket, app.log),
    routerOptions: {
      onBadUrl: (_path, _request, response) => {
        // Router rejection precedes FastifyRequest/hooks. Never echo the raw path.
        const id = randomUUID();
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'x-request-id': id });
        response.end(JSON.stringify(errorEnvelope('MALFORMED_REQUEST', id)));
        app.log.info({ event: 'request_rejected', request_id: id, status: 400, code: 'MALFORMED_REQUEST' }, 'Request rejected');
      },
    },
    bodyLimit: JSON_BODY_LIMIT, requestTimeout: 30_000, connectionTimeout: 30_000,
    keepAliveTimeout: 5000, maxRequestsPerSocket: 1000, forceCloseConnections: 'idle',
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: false } },
  });
  registerErrors(app);
  registerRequestLogging(app);
  registerJson(app);
  app.register(cors, {
    origin: (origin, callback) => callback(null, origin !== undefined && config.allowedOrigins.includes(origin)),
    credentials: !!auth, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', ...(auth ? ['X-CSRF-Token'] : [])], exposedHeaders: ['x-request-id'],
    strictPreflight: true, maxAge: 600,
  });
  app.register(rateLimit, { max: 120, timeWindow: 60_000, cache: 10_000,
    errorResponseBuilder: () => new HttpError('RATE_LIMITED'),
  });
  app.after(() => {
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
      reply.code(404).send(errorEnvelope('RESOURCE_NOT_FOUND', request.id)));
  });
  // Register after infrastructure boot so global plugin hooks cover every route.
  app.register(async instance => { registerHealth(instance, database); });
  if (auth) {
    app.register(cookie);
    app.register(async instance => registerAuth(instance,createAuthService(database,auth.keys),auth.keys,config.allowedOrigins,config.environment!=='developer'));
    if (auth.webhook) app.register(async instance => registerWebhook(instance,auth.webhook!));
  }
  return app;
}
