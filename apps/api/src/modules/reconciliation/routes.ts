import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {createReconciliationService} from './service.ts';
import type {createReconciliationReportService} from './report-service.ts';
export function registerReconciliation(root:FastifyInstance,service:ReturnType<typeof createReconciliationService>,reports:ReturnType<typeof createReconciliationReportService>,secure:boolean) {
 void root.register(async app=>{
 app.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store, private');return payload;});
 const token=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/reconciliation/config',request=>service.config(token(request),request.query,request.id));
 app.post('/api/v1/reconciliation/config',request=>service.configure(token(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get('/api/v1/reconciliation/accounts',request=>service.catalog(token(request),'accounts',request.query,request.id));
 app.get('/api/v1/reconciliation/sources',request=>service.catalog(token(request),'sources',request.query,request.id));
 app.get('/api/v1/reconciliation/transactions',request=>service.catalog(token(request),'transactions',request.query,request.id));
 app.get('/api/v1/reconciliation/batches',request=>service.catalog(token(request),'batches',request.query,request.id));
 app.get('/api/v1/reconciliation/imports',request=>service.catalog(token(request),'imports',request.query,request.id));
 app.get('/api/v1/reconciliation/mappings',request=>service.mappings(token(request),request.query,request.id));
 app.post('/api/v1/reconciliation/mappings',request=>service.publishMapping(token(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/mappings/:id',request=>service.publishMapping(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post('/api/v1/reconciliation/columns',request=>service.columns(token(request),request.query,request.body,request.id));
 app.post('/api/v1/reconciliation/imports',request=>service.preview(token(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{id:string}}>('/api/v1/reconciliation/imports/:id',request=>service.readImport(token(request),request.params.id,request.query,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/imports/:id/commit',request=>service.commitImport(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/imports/:id/resolve',request=>service.resolveImportRow(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{id:string}}>('/api/v1/reconciliation/transactions/:id/suggestions',request=>service.suggestions(token(request),request.params.id,request.query,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/transactions/:id/classification',request=>service.classify(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post('/api/v1/reconciliation/matches',request=>service.confirmMatch(token(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/matches/:id/unmatch',request=>service.unmatch(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post('/api/v1/reconciliation/batches',request=>service.saveBatch(token(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/batches/:id',request=>service.saveBatch(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post('/api/v1/reconciliation/cases',request=>service.reviewCase(token(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/reconciliation/cases/:id',request=>service.reviewCase(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{id:string}}>('/api/v1/reconciliation/history/:id',request=>service.history(token(request),request.params.id,request.query,request.id));
 app.post('/api/v1/reconciliation/reports',request=>reports.capture(token(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{id:string}}>('/api/v1/reconciliation/reports/:id',request=>reports.read(token(request),request.params.id,request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/reconciliation/reports/:id/export',request=>reports.read(token(request),request.params.id,request.query,request.id,true));
 });
}
