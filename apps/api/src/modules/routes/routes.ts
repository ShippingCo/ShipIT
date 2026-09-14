import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createRouteService } from './service.ts';
import type { RouteOperation } from './types.ts';
export function registerRoutes(app:FastifyInstance,service:ReturnType<typeof createRouteService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const command=(method:'POST'|'PATCH',path:string,operation:RouteOperation)=>app.route<{Params:{route_id?:string;lot_id?:string;parcel_id?:string}}>({method,url:path,
    async handler(request,reply){const result=await service.execute(session(request),request.params.route_id,request.params.lot_id??request.params.parcel_id,
      request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,operation,request.id);
      return reply.code(operation==='routes.create'?201:200).send(result);}});
  command('POST','/api/v1/routes','routes.create');command('PATCH','/api/v1/routes/:route_id','routes.update');
  command('POST','/api/v1/routes/:route_id/archive','routes.archive');command('POST','/api/v1/routes/:route_id/finalize','routes.finalize');
  command('POST','/api/v1/routes/:route_id/lots','routes.lot.attach');command('POST','/api/v1/routes/:route_id/lots/:lot_id/remove','routes.lot.detach');
  command('POST','/api/v1/routes/:route_id/parcels','routes.parcel.attach');command('POST','/api/v1/routes/:route_id/parcels/:parcel_id/remove','routes.parcel.detach');
  app.get('/api/v1/routes',request=>service.list(session(request),request.query,request.id));
  app.get<{Params:{route_id:string}}>('/api/v1/routes/:route_id',request=>service.read(session(request),request.params.route_id,request.query,request.id));
  app.get<{Params:{route_id:string}}>('/api/v1/routes/:route_id/parcels',request=>service.manifest(session(request),request.params.route_id,undefined,request.query,request.id));
  app.get<{Params:{route_id:string;manifest_id:string}}>('/api/v1/routes/:route_id/manifests/:manifest_id',request=>service.manifest(session(request),request.params.route_id,request.params.manifest_id,request.query,request.id));
}
