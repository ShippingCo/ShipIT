import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createEwayService } from './service.ts';
import { idempotencyKey } from './validation.ts';
export function registerEway(app:FastifyInstance,service:ReturnType<typeof createEwayService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const key=(request:FastifyRequest)=>idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
  const base='/api/v1/bookings/:booking_id/eway';
  app.post<{Params:{booking_id:string}}>(base,async(request,reply)=>reply.code(201).send(await service.mutate('create',session(request),request.params.booking_id,key(request),request.body,request.query,request.id)));
  app.patch<{Params:{booking_id:string}}>(base,request=>service.mutate('correct',session(request),request.params.booking_id,key(request),request.body,request.query,request.id));
  app.post<{Params:{booking_id:string}}>(base+'/estimate',request=>service.mutate('estimate',session(request),request.params.booking_id,key(request),request.body,request.query,request.id));
  app.get<{Params:{booking_id:string}}>(base,{exposeHeadRoute:false},request=>service.read(session(request),request.params.booking_id,request.query,request.id));
  app.get<{Params:{booking_id:string}}>(base+'/history',{exposeHeadRoute:false},request=>service.list('history',session(request),request.params.booking_id,request.query,request.id));
  app.get('/api/v1/eway/reminders',{exposeHeadRoute:false},request=>service.list('reminders',session(request),null,request.query,request.id));
}
