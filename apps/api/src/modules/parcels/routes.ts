import type { createParcelBulkService } from './bulk-service.ts';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createParcelService } from './service.ts';
import type { ParcelOperation } from './types.ts';

export function registerParcelCommands(app:FastifyInstance,service:ReturnType<typeof createParcelService>,secure:boolean,bulk:ReturnType<typeof createParcelBulkService>) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const route=(path:string,operation:ParcelOperation)=>app.post<{Params:{parcel_id:string}}>(path,request=>
    service.execute(session(request),request.params.parcel_id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,
      request.body,operation,request.id));
  app.post('/api/v1/parcels/bulk', { config:{ rateLimit:{ max:12,timeWindow:60_000 } } }, async request => {
    const started=performance.now();
    const result=await bulk.execute(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);
    const codes:Record<string,number>={};
    for(const item of result.items)if(item.outcome==='failed')codes[item.error.code]=(codes[item.error.code]??0)+1;
    request.log.info({event:'parcel_bulk_completed',action:result.action,item_count:result.items.length,
      succeeded:result.summary.succeeded,result_codes:codes,duration_ms:Math.round(performance.now()-started),request_id:request.id},'Parcel bulk completed');
    return result;
  });
  route('/api/v1/parcels/:parcel_id/check-in','parcels.check_in');
  route('/api/v1/parcels/:parcel_id/dispatch','parcels.dispatch');
  route('/api/v1/parcels/:parcel_id/transit','parcels.transit');
  route('/api/v1/parcels/:parcel_id/failed-attempt','parcels.fail_delivery');
  route('/api/v1/parcels/:parcel_id/rto','parcels.approve_rto');
}
