import type { FastifyInstance } from 'fastify';
import type { createBookingService } from './service.ts';
import { selection, idempotencyKey } from './validation.ts';
export function registerBookings(app: FastifyInstance, service: ReturnType<typeof createBookingService>, secure: boolean) {
  app.post('/api/v1/bookings',async (request,reply) => {
    const s = selection(request.query), key = idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
    const session = request.cookies[secure ? '__Host-shipit_session' : 'shipit_session'] ?? '';
    return reply.code(201).send(await service.create(session,s.organizationId,s.franchiseId,key,request.body,request.id));
  });
}
