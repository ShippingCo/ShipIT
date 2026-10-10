import type {createEffectivenessService} from './effectiveness-service.ts';
import type {createPerformanceService} from './performance-service.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createReportService } from './service.ts';
import type { createSalesService } from './sales-service.ts';
import type { createAgeingService } from './ageing-service.ts';
import type { createFinanceService } from './finance-service.ts';
export function registerReports(app:FastifyInstance,service:ReturnType<typeof createReportService>,secure:boolean,sales:ReturnType<typeof createSalesService>,finance:ReturnType<typeof createFinanceService>,ageing:ReturnType<typeof createAgeingService>,performance:ReturnType<typeof createPerformanceService>,effectiveness:ReturnType<typeof createEffectivenessService>) {
  const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.post('/api/v1/reports/effectiveness',(request,reply)=>{reply.header('Cache-Control','no-store');return effectiveness.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/effectiveness/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return effectiveness.read(session(request),request.params.id,request.query,request.id)});
  app.post('/api/v1/reports/performance',(request,reply)=>{reply.header('Cache-Control','no-store');return performance.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/performance/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return performance.read(session(request),request.params.id,request.query,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/performance/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return performance.read(session(request),request.params.id,request.query,request.id,true)});
  app.post('/api/v1/reports/ageing',(request,reply)=>{reply.header('Cache-Control','no-store');return ageing.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/ageing/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return ageing.read(session(request),request.params.id,request.query,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/ageing/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return ageing.read(session(request),request.params.id,request.query,request.id,true)});
  app.post('/api/v1/reports/sales',(request,reply)=>{reply.header('Cache-Control','no-store');return sales.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/sales/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return sales.read(session(request),request.params.id,request.query,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/reports/sales/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return sales.read(session(request),request.params.id,request.query,request.id,true)});
  app.get('/api/v1/finance/policy',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.readPolicy(session(request),request.query,request.id)});
  app.post('/api/v1/finance/policy/revisions',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.configurePolicy(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.post('/api/v1/finance/audit',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.captureAudit(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/audit/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.readAudit(session(request),request.query,request.params.id,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/audit/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.readAudit(session(request),request.query,request.params.id,request.id,true)});
  app.get<{Params:{id:string;row:string}}>('/api/v1/finance/audit/:id/rows/:row',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.auditDetail(session(request),request.query,request.params.id,request.params.row,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/bookings/:id/proposal',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.proposalContext(session(request),request.query,request.params.id,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/my-requests/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.ownRequest(session(request),request.query,request.params.id,request.id)});
  app.delete<{Params:{id:string}}>('/api/v1/finance/requests/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.denyDeletion(session(request),request.query,request.params.id,request.id)});
  app.get<{Params:{id:string}}>('/api/v1/finance/requests/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.requestDetail(session(request),request.query,request.params.id,request.id)});
  app.post<{Params:{id:string}}>('/api/v1/finance/requests/:id/amend',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.amend(session(request),request.query,request.params.id,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.post('/api/v1/finance/requests',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.request(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.post<{Params:{id:string}}>('/api/v1/finance/requests/:id/decisions',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.decide(session(request),request.query,request.params.id,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
  app.post<{Params:{id:string}}>('/api/v1/finance/requests/:id/apply',(request,reply)=>{reply.header('Cache-Control','no-store');return finance.apply(session(request),request.query,request.params.id,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)});
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
