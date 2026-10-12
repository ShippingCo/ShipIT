import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {createShipmentCostService} from './service.ts';
import {createContributionService} from './contribution-service.ts';
export function registerShipmentCosts(app:FastifyInstance,database:DatabasePool,secure:boolean,enabled:boolean){
 const service=createShipmentCostService(database,enabled),report=createContributionService(database),session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/shipment-costs',(request,reply)=>{reply.header('Cache-Control','no-store');return service.list(session(request),request.query,request.id);});
 app.get('/api/v1/shipment-costs/selectors',(request,reply)=>{reply.header('Cache-Control','no-store');return service.list(session(request),request.query,request.id,true);});
 app.get<{Params:{id:string}}>('/api/v1/shipment-costs/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return service.read(session(request),request.query,request.params.id,request.id);});
 app.post('/api/v1/shipment-costs',(request,reply)=>{reply.header('Cache-Control','no-store');return service.record(session(request),request.query,null,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.post<{Params:{id:string}}>('/api/v1/shipment-costs/:id/revisions',(request,reply)=>{reply.header('Cache-Control','no-store');return service.record(session(request),request.query,request.params.id,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.post('/api/v1/shipment-costs/imports/preview',(request,reply)=>{reply.header('Cache-Control','no-store');return service.preview(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.post<{Params:{id:string}}>('/api/v1/shipment-costs/imports/:id/apply',(request,reply)=>{reply.header('Cache-Control','no-store');return service.apply(session(request),request.query,request.params.id,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.post('/api/v1/reports/contribution',(request,reply)=>{reply.header('Cache-Control','no-store');return report.create(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 app.get<{Params:{id:string}}>('/api/v1/reports/contribution/:id',(request,reply)=>{reply.header('Cache-Control','no-store');return report.read(session(request),request.params.id,request.query,request.id);});
 app.get<{Params:{id:string}}>('/api/v1/reports/contribution/:id/export',(request,reply)=>{reply.header('Cache-Control','no-store');return report.read(session(request),request.params.id,request.query,request.id,true);});
}
