import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createReportService } from './service.ts';
import type { createSalesService } from './sales-service.ts';
import type { createFinanceService } from './finance-service.ts';
export function registerReports(app:FastifyInstance,service:ReturnType<typeof createReportService>,secure:boolean,sales:ReturnType<typeof createSalesService>,finance:ReturnType<typeof createFinanceService>) {
  const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.post('/api/v1/reports/sales',(request,reply)=>{reply.header('Cache-Control','no-store');return sales.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/sales/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return sales.read(session(request),request.params.id,request.query,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/sales/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return sales.read(session(request),request.params.id,request.query,request.id,true)});
  app.post('/api/v1/finance/changes',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.change(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/bookings/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.read(session(request),request.query,request.params.id,request.id)});
  app.post('/api/v1/finance/statements',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.statement(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/statements/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.readStatement(session(request),request.query,request.params.id,request.id)});
  app.post('/api/v1/reports/snapshots',(request,reply)=>{reply.header('Cache-Control','no-store');return service.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/snapshots/:id',(request,reply)=>{
    reply.header('Cache-Control','no-store');return service.read(session(request),request.params.id,request.query,request.id);
  });
  app.get<{Params:{id:string}}>('/api/v1/reports/snapshots/:id/export',(request,reply)=>{
    reply.header('Cache-Control','no-store');return service.read(session(request),request.params.id,request.query,request.id,true);
  });
}
