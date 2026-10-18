import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {createOwnerSummaryService} from './owner-summary-service.ts';
export function registerOwnerReports(app:FastifyInstance,database:DatabasePool,secure:boolean,enabled:boolean) {
 const service=createOwnerSummaryService(database,enabled),session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/owner-reports',(request,reply)=>{reply.header('Cache-Control','no-store');return service.workspace(session(request),request.query,request.id);});
 app.post('/api/v1/owner-reports/schedules',(request,reply)=>{reply.header('Cache-Control','no-store');return service.save(session(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.post<{Params:{id:string}}>('/api/v1/owner-reports/schedules/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return service.save(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.post('/api/v1/owner-reports/consent',(request,reply)=>{reply.header('Cache-Control','no-store');return service.consent(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.get<{Params:{id:string}}>('/api/v1/owner-reports/runs/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return service.report(session(request),request.params.id,request.query,request.id);});
 app.get<{Params:{id:string}}>('/api/v1/owner-reports/runs/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return service.report(session(request),request.params.id,request.query,request.id,true);});
 for(const [path,operation] of [['schedules','preview'],['alerts','acknowledge'],['runs','correct'],['deliveries','retry']] as const)
  app.post<{Params:{id:string}}>(`/api/v1/owner-reports/${path}/:id/${operation}`,(request,reply)=>{reply.header('Cache-Control','no-store');return service.action(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id,operation);});
}
