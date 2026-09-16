import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createReceiptService } from './service.ts';
export function registerReceipts(app:FastifyInstance,service:ReturnType<typeof createReceiptService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.get<{Params:{booking_id:string}}>('/api/v1/bookings/:booking_id/receipt',{exposeHeadRoute:false},request=>
    service.read(session(request),request.params.booking_id,null,request.query,request.id));
  app.get<{Params:{booking_id:string;payment_id:string}}>('/api/v1/bookings/:booking_id/payments/:payment_id/receipt',{exposeHeadRoute:false},request=>
    service.read(session(request),request.params.booking_id,request.params.payment_id,request.query,request.id));
  app.get<{Params:{receipt_id:string}}>('/api/v1/receipts/:receipt_id',{exposeHeadRoute:false},request=>
    service.readId(session(request),request.params.receipt_id,request.query,request.id));
}
