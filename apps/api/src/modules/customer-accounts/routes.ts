import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {createCustomerAccountService} from './service.ts';
export function registerCustomerAccounts(app:FastifyInstance,service:ReturnType<typeof createCustomerAccountService>,secure:boolean) {
 const token=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/customer-accounts',request=>service.list(token(request),request.query,request.id));
 app.post('/api/v1/customer-credit-requests',request=>service.requestCredit(token(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get('/api/v1/customer-credit-requests',request=>service.pendingCredit(token(request),request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/customer-credit-requests/:id',request=>service.creditRequest(token(request),request.params.id,request.query,request.id));
 app.post<{Params:{id:string}}>('/api/v1/customer-credit-requests/:id/approval',request=>service.approveRequest(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{id:string}}>('/api/v1/customer-credit-requests/:id/review',request=>service.reviewCredit(token(request),request.params.id,request.query,request.id));
 app.get('/api/v1/customer-account-choices',request=>service.choices(token(request),request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/customer-accounts/:id/history',request=>service.history(token(request),request.params.id,request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/customer-accounts/:id/rates',request=>service.history(token(request),request.params.id,request.query,request.id,true));
 app.get<{Params:{id:string}}>('/api/v1/customer-accounts/:id/credit-sources',request=>service.sources(token(request),request.params.id,request.query,request.id));
 app.get<{Params:{id:string}}>('/api/v1/customer-accounts/:id/credit',request=>service.credit(token(request),request.params.id,request.query,request.id));
 app.post('/api/v1/customer-credit-approvals',request=>service.approve(token(request),request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.get<{Params:{id:string}}>('/api/v1/customer-accounts/:id',request=>service.read(token(request),request.params.id,request.query,request.id));
 app.post('/api/v1/customer-accounts',request=>service.configure(token(request),null,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/customer-accounts/:id/revisions',request=>service.configure(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
 app.post<{Params:{id:string}}>('/api/v1/customer-accounts/:id/rates',request=>service.publishRate(token(request),request.params.id,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id));
}
