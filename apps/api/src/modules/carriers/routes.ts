import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createCarrierService } from './service.ts';
import { idempotencyKey } from './validation.ts';
export function registerCarriers(app:FastifyInstance,service:ReturnType<typeof createCarrierService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const key=(request:FastifyRequest)=>idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
  const installations='/api/v1/carriers/installations';
  app.post(installations,async(request,reply)=>reply.code(201).send(await service.mutate('installation',session(request),null,key(request),request.body,request.query,request.id)));
  app.get(installations,{exposeHeadRoute:false},request=>service.list('installations',session(request),null,request.query,request.id));
  app.post<{Params:{id:string}}>(installations+'/:id/mappings',async(request,reply)=>reply.code(201).send(await service.mutate('mapping',session(request),request.params.id,key(request),request.body,request.query,request.id)));
  app.get<{Params:{id:string}}>(installations+'/:id/mappings',{exposeHeadRoute:false},request=>service.list('mappings',session(request),request.params.id,request.query,request.id));
  for(const [kind,operation] of [['references','reference'],['observations','observation']] as const){
    const path='/api/v1/parcels/:id/carriers/'+kind;
    app.post<{Params:{id:string}}>(path,async(request,reply)=>reply.code(201).send(await service.mutate(operation,session(request),request.params.id,key(request),request.body,request.query,request.id)));
    app.get<{Params:{id:string}}>(path,{exposeHeadRoute:false},request=>service.list(kind,session(request),request.params.id,request.query,request.id));
  }
}
