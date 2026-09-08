import { vi } from 'vitest';
import type { DatabasePool } from '@shippingco/db';
import { parseEnvironment } from '../src/env.ts';
import { buildServer } from '../src/server.ts';
import type { RuntimeConfig } from '../src/env.ts';
export const syntheticEnv = {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000', LOG_LEVEL: 'info',
  ALLOWED_ORIGINS: 'http://localhost:5173', TRUSTED_PROXY_HOPS: '0',
  DATABASE_SECRET_REF: 'local:database', DATABASE_TLS_MODE: 'disable',
};
export function fakeDatabase() {
  return {
    query: vi.fn(async () => ({ command: 'SELECT', rowCount: 1, oid: 0, fields: [], rows: [] })),
    connect: vi.fn(async () => { throw new Error('unused'); }),
    close: vi.fn(async () => {}), stats: () => ({ total: 0, idle: 0, waiting: 0 }),
  } satisfies DatabasePool;
}
export function harness(overrides: Partial<RuntimeConfig> = {}) {
  const database = fakeDatabase();
  const logs: string[] = [];
  const app = buildServer({ config: { ...parseEnvironment(syntheticEnv), ...overrides }, database,
    logSink: { write: message => { logs.push(message); } } });
  const handler = vi.fn(() => ({ status: 'accepted' }));
  app.register(async instance => {
    instance.post('/synthetic-command', {
      schema: { body: { type: 'object', required: ['name'], additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 300000 }, count: { type: 'integer', minimum: 1, maximum: 10 },
          nested: { type: 'object', additionalProperties: false, properties: { flag: { type: 'boolean' } } } } } },
    }, handler);
    instance.get('/synthetic-context', async request => ({ ip: request.ip, hostname: request.hostname,
      protocol: request.protocol, id: request.id, hasIdentity: 'user' in request || 'franchise' in request }));
    instance.get('/synthetic-error', async () => { throw new Error('SYN_DB_URL_PASSWORD_TOKEN', { cause: 'SYN_PROVIDER_PAYLOAD' }); });
    instance.get('/synthetic-private', async (_request, reply) => {
      reply.header('set-cookie', 'SYN_SET_COOKIE'); return { value: 'SYN_RESPONSE_BODY' };
    });
  });
  return { app, database, logs, handler };
}
