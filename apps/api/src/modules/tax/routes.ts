import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createTaxService } from './service.ts';
import { idempotencyKey, noQuery, selection } from './validation.ts';
interface Params { organization_id: string; franchise_id: string; version_id: string }
export function registerTax(app: FastifyInstance, service: ReturnType<typeof createTaxService>, secure: boolean) {
  const session = (r: FastifyRequest) => r.cookies[secure ? '__Host-shipit_session' : 'shipit_session'] ?? '';
  const key = (r: FastifyRequest) => idempotencyKey(r.headers['idempotency-key'],r.raw.rawHeaders);
  const base = '/api/v1/organizations/:organization_id/franchises/:franchise_id/tax/versions';
  app.get<{ Params: Params }>(base,request => {
    noQuery(request.query); return service.effective(session(request),request.params.organization_id,request.params.franchise_id,request.id);
  });
  app.get<{ Params: Params }>(base+'/:version_id',request => {
    noQuery(request.query); return service.read(session(request),request.params.organization_id,request.params.franchise_id,request.params.version_id,request.id);
  });
  app.post<{ Params: Params }>(base,async (request,reply) => {
    noQuery(request.query); return reply.code(201).send(await service.create(session(request),request.params.organization_id,request.params.franchise_id,key(request),request.body,request.id));
  });
  app.put<{ Params: Params }>(base+'/:version_id',request => {
    noQuery(request.query); return service.replace(session(request),request.params.organization_id,request.params.franchise_id,request.params.version_id,key(request),request.body,request.id);
  });
  app.post<{ Params: Params }>(base+'/:version_id/publish',request => {
    noQuery(request.query); return service.publish(session(request),request.params.organization_id,request.params.franchise_id,request.params.version_id,key(request),request.body,request.id);
  });
  for (const [path,method] of [['intents',service.prepare],['jurisdiction-resolutions',service.resolve],['calculations',service.calculate]] as const) {
    app.post('/api/v1/tax/'+path,request => {
      const s = selection(request.query); return method(session(request),s.organizationId,s.franchiseId,key(request),request.body,request.id);
    });
  }
  app.get<{ Params: { id: string } }>('/api/v1/tax/intents/:id',request => {
    const s = selection(request.query); return service.inspectIntent(session(request),s.organizationId,s.franchiseId,request.params.id,request.id);
  });
  app.get<{ Params: { id: string } }>('/api/v1/tax/intents/:id/resolution-context',request => {
    const s = selection(request.query); return service.inspectIntent(session(request),s.organizationId,s.franchiseId,request.params.id,request.id,true);
  });
  app.get<{ Params: { id: string } }>('/api/v1/tax/calculations/:id',request => {
    const s = selection(request.query); return service.readCalculation(session(request),s.organizationId,s.franchiseId,request.params.id,request.id);
  });
}
