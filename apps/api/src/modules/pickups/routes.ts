import type { FastifyInstance,FastifyRequest } from 'fastify';
import { idempotencyKey } from '../pricing/validation.ts';
import type { createPickupService } from './service.ts';
export function registerPickups(app:FastifyInstance,service:ReturnType<typeof createPickupService>,secure:boolean) {
 const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/pickups',request=>service.list(session(request),request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/pickups/:id',request=>service.detail(session(request),request.params.id,request.query,request.id));
 app.post<{Params:{id:string}}>('/api/v1/pickups/:id/decision',request=>service.decide(session(request),request.params.id,request.query,
  idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
}
