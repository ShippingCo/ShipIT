import type { FastifyInstance,FastifyRequest } from 'fastify';
import { idempotencyKey } from '../pricing/validation.ts';
import type { createSupportService } from './service.ts';
export function registerSupport(app:FastifyInstance,service:ReturnType<typeof createSupportService>,secure:boolean) {
 const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/support',request=>service.list(session(request),request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/support/:id',request=>service.detail(session(request),request.params.id,request.query,request.id));
 app.post<{Params:{id:string}}>('/api/v1/support/:id/commands',request=>service.command(session(request),request.params.id,request.query,idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
}
