import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createCustomerService } from './service.ts';
import { idempotencyKey, noQuery } from './validation.ts';
import { HttpError } from '../../plugins/errors.ts';
import { CUSTOMER_SEARCH_BUDGET_PER_MINUTE } from '../../server.ts';
interface Params { organization_id: string; franchise_id: string; customer_id: string }
export function registerCustomers(app: FastifyInstance, service: ReturnType<typeof createCustomerService>, secure: boolean) {
  const base = '/api/v1/organizations/:organization_id/franchises/:franchise_id/customers';
  const session = (r: FastifyRequest) => r.cookies[secure ? '__Host-shipit_session' : 'shipit_session'] ?? '';
  // createRateLimit counts independently of the global handler's per-request marker, and
  // inherits the server's identity key: the budget belongs to the signed-in session, not to
  // the address. One shop is one address, so an address-keyed budget punished every counter
  // in a branch together and could be reset by moving address. No request query, contact or
  // tenant value is ever part of the key.
  const searchBudget = app.createRateLimit({ max:CUSTOMER_SEARCH_BUDGET_PER_MINUTE,timeWindow:60_000 });
  app.get<{ Params: Params }>(base, { preHandler: async (request, reply) => {
    const result = await searchBudget(request);
    if (!result.isAllowed && result.isExceeded) {
      reply.header('Retry-After', result.ttlInSeconds);
      throw new HttpError('RATE_LIMITED');
    }
  } }, request => service.list(session(request),request.params.organization_id,request.params.franchise_id,request.query,request.id));
  app.get<{ Params: Params }>(base + '/:customer_id', request => {
    noQuery(request.query);
    return service.read(session(request),request.params.organization_id,request.params.franchise_id,request.params.customer_id,request.id);
  });
  app.post<{ Params: Params }>(base, async (request, reply) => {
    noQuery(request.query);
    const key = idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
    const result = await service.create(session(request),request.params.organization_id,request.params.franchise_id,key,request.body,request.id);
    return reply.code(201).send(result);
  });
  app.patch<{ Params: Params }>(base + '/:customer_id', request => {
    noQuery(request.query);
    const key = idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
    return service.update(session(request),request.params.organization_id,request.params.franchise_id,request.params.customer_id,key,request.body,request.id);
  });
}
