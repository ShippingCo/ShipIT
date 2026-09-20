import type { FastifyInstance,FastifyRequest } from 'fastify';
import { idempotencyKey } from '../customers/validation.ts';
import type { createWhatsappService } from './service.ts';
export function registerWhatsapp(app:FastifyInstance,service:ReturnType<typeof createWhatsappService>,secure:boolean) {
  const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.get('/api/v1/whatsapp/inbox/health',{exposeHeadRoute:false},request=>service.inbox(session(request),null,request.query,request.id));
  app.get<{Params:{id:string}}>('/api/v1/whatsapp/inbox/:id',{exposeHeadRoute:false},request=>service.inbox(session(request),request.params.id,request.query,request.id));
  app.get('/api/v1/whatsapp/installation',{exposeHeadRoute:false},request=>service.read(session(request),request.query,request.id));
  app.post('/api/v1/whatsapp/installations',request=>service.execute(session(request),null,'connect',request.query,
    idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
  for(const operation of ['rotate','disable','sync'] as const)app.post<{Params:{id:string}}>(`/api/v1/whatsapp/installations/:id/${operation}`,request=>
    service.execute(session(request),request.params.id,operation,request.query,idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
  app.post<{Params:{id:string}}>('/api/v1/whatsapp/installations/:id/capability',request=>service.capability(session(request),request.params.id,request.query,request.body,request.id));
}
