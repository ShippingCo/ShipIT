import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createLotService } from './service.ts';
import type { LotOperation } from './types.ts';
export function registerLots(app:FastifyInstance,service:ReturnType<typeof createLotService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const route=(method:'POST'|'PATCH',path:string,operation:LotOperation)=>app.route<{Params:{lot_id?:string;parcel_id?:string}}>({method,url:path,
    async handler(request,reply){
      const result=await service.execute(session(request),request.params.lot_id,request.params.parcel_id,request.query,
        request.headers['idempotency-key'],request.raw.rawHeaders,request.body,operation,request.id);
      return reply.code(operation==='lots.create'?201:200).send(result);
    }});
  route('POST','/api/v1/lots','lots.create');
  route('PATCH','/api/v1/lots/:lot_id','lots.update');
  route('POST','/api/v1/lots/:lot_id/archive','lots.archive');
  route('POST','/api/v1/lots/:lot_id/parcels','lots.membership.add');
  route('POST','/api/v1/lots/:lot_id/parcels/:parcel_id/move','lots.membership.move');
  route('POST','/api/v1/lots/:lot_id/parcels/:parcel_id/remove','lots.membership.remove');
  app.get('/api/v1/lots',request=>service.list(session(request),request.query,request.id));
  app.get<{Params:{lot_id:string}}>('/api/v1/lots/:lot_id',request=>service.read(session(request),request.params.lot_id,request.query,request.id));
  app.get<{Params:{lot_id:string}}>('/api/v1/lots/:lot_id/memberships',request=>service.list(session(request),request.query,request.id,request.params.lot_id));
  app.get<{Params:{parcel_id:string}}>('/api/v1/parcels/:parcel_id/lot-membership',request=>service.read(session(request),request.params.parcel_id,request.query,request.id,true));
}
