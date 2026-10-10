import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {createCashLocationService} from './location-service.ts';
import {createCashbookRequestService} from './request-service.ts';
import {createCashbookEffectService} from './effect-service.ts';
import {createCashHandoverService} from './handover-service.ts';
import {createCashbookReportService} from './report-service.ts';
/** Services own parsing, live grants, exact intent and transactional financial authority. */
export function registerCashbook(app:FastifyInstance,database:DatabasePool,secure:boolean,writesEnabled=false) {
 const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 const locations=createCashLocationService(database,writesEnabled),requests=createCashbookRequestService(database,writesEnabled),effects=createCashbookEffectService(database,writesEnabled),handovers=createCashHandoverService(database,writesEnabled),reports=createCashbookReportService(database);
 app.register(async scoped=>{
  scoped.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store, private');return payload;});
  scoped.get('/api/v1/cashbook/locations',request=>locations.list(session(request),request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/locations/:id',request=>locations.read(session(request),request.params.id,request.query,request.id));
  scoped.post('/api/v1/cashbook/locations',async(request,reply)=>reply.code(201).send(await locations.configure(session(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post<{Params:{id:string}}>('/api/v1/cashbook/locations/:id/revisions',request=>locations.configure(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
  scoped.get('/api/v1/cashbook/position',request=>effects.position(session(request),request.query,request.id));
  scoped.get('/api/v1/cashbook/requests',request=>requests.list(session(request),request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/requests/:id',request=>requests.read(session(request),request.params.id,request.query,request.id));
  scoped.post('/api/v1/cashbook/requests',async(request,reply)=>reply.code(201).send(await requests.submit(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post<{Params:{id:string}}>('/api/v1/cashbook/requests/:id/decisions',request=>requests.decide(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/cashbook/requests/:id/apply',request=>effects.apply(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
  scoped.get('/api/v1/cashbook/handovers',request=>handovers.list(session(request),request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/locations/:id/handover-targets',request=>handovers.targets(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/handovers/:id',request=>handovers.read(session(request),request.params.id,request.query,request.id));
  scoped.post('/api/v1/cashbook/handovers',async(request,reply)=>reply.code(201).send(await handovers.request(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post<{Params:{id:string}}>('/api/v1/cashbook/handovers/:id/commands',request=>handovers.respond(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
  scoped.post('/api/v1/cashbook/snapshots',async(request,reply)=>reply.code(201).send(await reports.capture(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/snapshots/:id',request=>reports.read(session(request),request.query,request.params.id,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/snapshots/:id/export',request=>reports.read(session(request),request.query,request.params.id,request.id,true));
  scoped.get<{Params:{id:string;row:string}}>('/api/v1/cashbook/snapshots/:id/rows/:row',request=>reports.detail(session(request),request.query,request.params.id,request.params.row,request.id));
 });
}
