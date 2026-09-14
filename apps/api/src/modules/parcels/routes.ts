import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createParcelService } from './service.ts';
import type { ParcelOperation } from './types.ts';

export function registerParcelCommands(app:FastifyInstance,service:ReturnType<typeof createParcelService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const route=(path:string,operation:ParcelOperation)=>app.post<{Params:{parcel_id:string}}>(path,request=>
    service.execute(session(request),request.params.parcel_id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,
      request.body,operation,request.id));
  route('/api/v1/parcels/:parcel_id/check-in','parcels.check_in');
  route('/api/v1/parcels/:parcel_id/dispatch','parcels.dispatch');
  route('/api/v1/parcels/:parcel_id/transit','parcels.transit');
  route('/api/v1/parcels/:parcel_id/failed-attempt','parcels.fail_delivery');
  route('/api/v1/parcels/:parcel_id/rto','parcels.approve_rto');
}
