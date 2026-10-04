import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createReportService } from './service.ts';
export function registerReports(app:FastifyInstance,service:ReturnType<typeof createReportService>,secure:boolean) {
  const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.post('/api/v1/reports/snapshots',request=>service.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
  app.get<{Params:{id:string}}>('/api/v1/reports/snapshots/:id',(request,reply)=>{
    reply.header('Cache-Control','no-store');return service.read(session(request),request.params.id,request.query,request.id);
  });
  app.get<{Params:{id:string}}>('/api/v1/reports/snapshots/:id/export',(request,reply)=>{
    reply.header('Cache-Control','no-store');return service.read(session(request),request.params.id,request.query,request.id,true);
  });
}
