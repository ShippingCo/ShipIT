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

import type {createMoneyReceiptService} from './receipt-service.ts';
import type {createReceivingAccountService} from './account-service.ts';
export function registerMoneyReceipts(app:FastifyInstance,receipts:ReturnType<typeof createMoneyReceiptService>,accounts:ReturnType<typeof createReceivingAccountService>,secure:boolean) {
 const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/money-receipt-receivers',request=>receipts.receivers(session(request),request.query,request.id));
 app.get<{Params:{receipt_id:string}}>('/api/v1/money-receipts/:receipt_id/history',request=>receipts.history(session(request),request.params.receipt_id,request.query,request.id));
 app.get('/api/v1/receiving-accounts',request=>accounts.list(session(request),request.query,request.id));
 app.get('/api/v1/money-receipts',request=>receipts.list(session(request),request.query,request.id));
 app.get('/api/v1/money-receipt-bills',request=>receipts.bills(session(request),request.query,request.id));
 app.post('/api/v1/money-receipts',request=>receipts.record(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{receipt_id:string}}>('/api/v1/money-receipts/:receipt_id/allocations',request=>receipts.allocate(session(request),request.params.receipt_id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{receipt_id:string}}>('/api/v1/money-receipts/:receipt_id/allocation-corrections',request=>receipts.correct(session(request),request.params.receipt_id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{receipt_id:string}}>('/api/v1/money-receipts/:receipt_id',request=>receipts.read(session(request),request.params.receipt_id,request.query,request.id));
 app.get<{Params:{receipt_id:string}}>('/api/v1/money-receipts/:receipt_id/balance',request=>receipts.summary(session(request),request.params.receipt_id,request.query,request.id));
 app.post('/api/v1/receiving-accounts',request=>accounts.configure(session(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{account_id:string}}>('/api/v1/receiving-accounts/:account_id/revisions',request=>accounts.configure(session(request),request.params.account_id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{account_id:string}}>('/api/v1/receiving-accounts/:account_id',request=>accounts.read(session(request),request.params.account_id,request.query,request.id));
}
