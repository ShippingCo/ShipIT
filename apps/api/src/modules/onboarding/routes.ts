import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MembershipService } from '../memberships/service.ts';
import { HttpError } from '../../plugins/errors.ts';

export function registerOnboarding(app: FastifyInstance, service: MembershipService, secure: boolean) {
  const session = (request: FastifyRequest) => request.cookies[secure ? '__Host-shipit_session' : 'shipit_session'] ?? '';
  const schema = { querystring: { type: 'object', additionalProperties: false, properties: {} } };
  app.post('/api/v1/onboarding', { schema }, async (request, reply) => {
    const keys = request.raw.rawHeaders.filter((_, i) => i % 2 === 0 && request.raw.rawHeaders[i]!.toLowerCase() === 'idempotency-key');
    if (keys.length !== 1) throw new HttpError('VALIDATION_FAILED');
    const result = await service.withCorrelation(request.id).onboard(session(request), request.headers['idempotency-key'], request.body);
    return reply.code(201).send(result);
  });
  app.get('/api/v1/operator-context', { schema }, request => service.withCorrelation(request.id).operatorContext(session(request)));
  app.get<{ Params: { franchiseId: string } }>('/api/v1/operator-context/franchises/:franchiseId', { schema },
    request => service.withCorrelation(request.id).operatorContext(session(request), request.params.franchiseId));
}
