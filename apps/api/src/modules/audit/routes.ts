import type { FastifyInstance } from 'fastify';
import type { createAuditService } from './service.ts';
export function registerAudit(app:FastifyInstance,service:ReturnType<typeof createAuditService>,secure:boolean) {
  app.get('/api/v1/audit',async request=>service.list(request.cookies[secure?'__Host-shipit_session':'shipit_session']??'',
    request.query,request.id));
}
