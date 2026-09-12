import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createPricingService } from './service.ts';
import { idempotencyKey, noQuery, selection } from './validation.ts';
interface Params {organization_id:string;franchise_id:string;version_id:string}
export function registerPricing(app:FastifyInstance,service:ReturnType<typeof createPricingService>,secure:boolean) {
  const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const key=(r:FastifyRequest)=>idempotencyKey(r.headers['idempotency-key'],r.raw.rawHeaders);
  const base='/api/v1/organizations/:organization_id/franchises/:franchise_id/pricing/versions';
  app.post('/api/v1/pricing/quote',request=>{
    const scope=selection(request.query);
    return service.quote(session(request),scope.organizationId,scope.franchiseId,key(request),request.body,request.id);
  });
  app.get<{Params:Params}>(base,request=>{
    noQuery(request.query);return service.effective(session(request),request.params.organization_id,request.params.franchise_id,request.id);
  });
  app.get<{Params:Params}>(base+'/:version_id',request=>{
    noQuery(request.query);return service.read(session(request),request.params.organization_id,request.params.franchise_id,request.params.version_id,request.id);
  });
  app.post<{Params:Params}>(base,async(request,reply)=>{
    noQuery(request.query);return reply.code(201).send(await service.create(session(request),request.params.organization_id,request.params.franchise_id,key(request),request.body,request.id));
  });
  app.put<{Params:Params}>(base+'/:version_id',request=>{
    noQuery(request.query);return service.replace(session(request),request.params.organization_id,request.params.franchise_id,request.params.version_id,key(request),request.body,request.id);
  });
  app.post<{Params:Params}>(base+'/:version_id/publish',request=>{
    noQuery(request.query);return service.publish(session(request),request.params.organization_id,request.params.franchise_id,request.params.version_id,key(request),request.body,request.id);
  });
}
