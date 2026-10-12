import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {createCashCloseExportService} from './close-export-service.ts';
import {createCashCloseService} from './close-service.ts';
import {createCashLocationService} from './location-service.ts';
import {createCashbookRequestService} from './request-service.ts';
import {createCashbookEffectService} from './effect-service.ts';
import {createCashHandoverService} from './handover-service.ts';
import {createCashbookReportService} from './report-service.ts';
/** Services own parsing, live grants, exact intent and transactional financial authority. */
export function registerCashbook(app:FastifyInstance,database:DatabasePool,secure:boolean,writesEnabled=false,allowAgentCustody=false,closeWritesEnabled=false) {
 const closes=createCashCloseService(database,closeWritesEnabled),closeExports=createCashCloseExportService(database);
 const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 const locations=createCashLocationService(database,writesEnabled,allowAgentCustody),requests=createCashbookRequestService(database,writesEnabled,allowAgentCustody),effects=createCashbookEffectService(database,writesEnabled,allowAgentCustody),handovers=createCashHandoverService(database,writesEnabled,allowAgentCustody),reports=createCashbookReportService(database);
 app.register(async scoped=>{
  scoped.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store, private');return payload;});
  scoped.post<{Params:{id:string}}>('/api/v1/cashbook/sessions/:id/exports',async(request,reply)=>reply.code(201).send(await closeExports.capture(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/close-exports/:id/download',request=>closeExports.download(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/locations/:id/closing-summary',request=>closes.eligibility(session(request),request.params.id,request.query,request.id));
  scoped.get('/api/v1/cashbook/sessions',request=>closes.list(session(request),request.query,request.id));
  scoped.post('/api/v1/cashbook/sessions',async(request,reply)=>reply.code(201).send(await closes.command(session(request),'open',null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/sessions/:id',request=>closes.read(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/sessions/:id/sources',request=>closes.evidence(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/sessions/:id/history',request=>closes.evidence(session(request),request.params.id,request.query,request.id,true));
  for(const [path,operation] of [['counts','count'],['submissions','submit'],['decisions','decide'],['reopens','reopen'],['opening-revisions','revise_opening'],['opening-reviews','review_opening']] as const)
   scoped.post<{Params:{id:string}}>('/api/v1/cashbook/sessions/:id/'+path,async(request,reply)=>reply.code(201).send(await closes.command(session(request),operation,request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
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
  scoped.get('/api/v1/cashbook/handover-sources',request=>handovers.sendingSources(session(request),request.query,request.id));
  scoped.get('/api/v1/cashbook/handovers',request=>handovers.list(session(request),request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/cashbook/handovers/:id/attributions',request=>handovers.attributions(session(request),request.params.id,request.query,request.id));
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
