import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createPaymentService } from './service.ts';
export function registerPayments(app:FastifyInstance,service:ReturnType<typeof createPaymentService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.post<{Params:{booking_id:string}}>('/api/v1/bookings/:booking_id/payments',request=>service.execute(session(request),request.params.booking_id,null,
    request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,'payments.collect',request.id));
  app.post<{Params:{booking_id:string;payment_id:string}}>('/api/v1/bookings/:booking_id/payments/:payment_id/reversals',request=>service.execute(session(request),request.params.booking_id,request.params.payment_id,
    request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,'payments.reverse',request.id));
  app.get<{Params:{booking_id:string}}>('/api/v1/bookings/:booking_id/payments',request=>service.read(session(request),request.params.booking_id,request.query,request.id));
  app.get<{Params:{booking_id:string;payment_id:string}}>('/api/v1/bookings/:booking_id/payments/:payment_id',request=>service.readEntry(session(request),request.params.booking_id,request.params.payment_id,request.query,request.id));
}
