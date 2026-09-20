import type { FastifyInstance,FastifyRequest } from 'fastify';
import { idempotencyKey } from '../customers/validation.ts';
import type { createOutboxService } from './service.ts';
export function registerOutbox(app:FastifyInstance,service:ReturnType<typeof createOutboxService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.get('/api/v1/outbox/health',{exposeHeadRoute:false},request=>service.health(session(request),request.query,request.id));
  app.get('/api/v1/outbox/jobs',{exposeHeadRoute:false},request=>service.list(session(request),request.query,request.id));
  app.get<{Params:{job_id:string}}>('/api/v1/outbox/jobs/:job_id',{exposeHeadRoute:false},request=>service.detail(session(request),request.params.job_id,request.query,request.id));
  app.post<{Params:{job_id:string}}>('/api/v1/outbox/jobs/:job_id/redrive',request=>service.redrive(session(request),request.params.job_id,request.query,
    idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
}
