import {createAgentMoneySourceService} from './source-service.ts';
import {createAgentCodService} from './cod-service.ts';
import {createAgentFeeService} from './fee-service.ts';
import {createAgentStatementExportService} from './export-service.ts';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {createAgentStatementService} from './statement-service.ts';
import {createAgentCashCaptureService} from './cash-capture-service.ts';
/** Private owner COD/fee commands, captures and independent review share current authority. */
export function registerAgentCashCaptures(app:FastifyInstance,database:DatabasePool,secure:boolean,writesEnabled=false){
 const sources=createAgentMoneySourceService(database);
 const cod=createAgentCodService(database,writesEnabled),fees=createAgentFeeService(database,writesEnabled);
 const service=createAgentCashCaptureService(database,writesEnabled),statements=createAgentStatementService(database,writesEnabled),exports=createAgentStatementExportService(database),session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.register(async scoped=>{
  scoped.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store, private');return payload;});
  scoped.get<{Params:{kind:string}}>('/api/v1/agent-settlements/finance/:kind',request=>sources.list(session(request),request.params.kind,request.query,request.id));
  scoped.post('/api/v1/agent-settlements/cod-beneficiaries',async(request,reply)=>reply.code(201).send(await cod.configureBeneficiary(session(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post<{Params:{id:string}}>('/api/v1/agent-settlements/cod-beneficiaries/:id/revisions',async(request,reply)=>reply.code(201).send(await cod.configureBeneficiary(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post('/api/v1/agent-settlements/cod-obligations',async(request,reply)=>reply.code(201).send(await cod.configureCod(session(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post<{Params:{id:string}}>('/api/v1/agent-settlements/cod-obligations/:id/revisions',async(request,reply)=>reply.code(201).send(await cod.configureCod(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post('/api/v1/agent-settlements/cod-allocations',async(request,reply)=>reply.code(201).send(await cod.reserve(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post<{Params:{id:string}}>('/api/v1/agent-settlements/agents/:id/fee-terms',async(request,reply)=>reply.code(201).send(await fees.configure(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post('/api/v1/agent-settlements/fee-earnings/delivery',async(request,reply)=>reply.code(201).send(await fees.earn(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post('/api/v1/agent-settlements/fee-earnings/agreed',async(request,reply)=>reply.code(201).send(await fees.earnAgreed(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.post('/api/v1/agent-settlements/cash-captures',async(request,reply)=>reply.code(201).send(await service.capture(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.get<{Params:{id:string}}>('/api/v1/agent-settlements/cash-captures/:id',request=>service.read(session(request),request.params.id,request.query,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/agent-settlements/submissions/:id/exports',async(request,reply)=>reply.code(201).send(await exports.capture(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.get<{Params:{id:string}}>('/api/v1/agent-settlements/exports/:id',request=>exports.read(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/agent-settlements/exports/:id/download',request=>exports.read(session(request),request.params.id,request.query,request.id,true));
  scoped.post('/api/v1/agent-settlements/submissions',async(request,reply)=>reply.code(201).send(await statements.submit(session(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));
  scoped.get('/api/v1/agent-settlements/submissions',request=>statements.list(session(request),request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/agent-settlements/submissions/:id',request=>statements.read(session(request),request.params.id,request.query,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/agent-settlements/submissions/:id/decisions',async(request,reply)=>reply.code(201).send(await statements.decide(session(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id)));

 });
}
