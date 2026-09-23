import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createDeliveryService } from './service.ts';

export function registerDeliveries(app:FastifyInstance,service:ReturnType<typeof createDeliveryService>,secure:boolean) {
 const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 const key=(request:FastifyRequest)=>request.headers['idempotency-key'];
 const raw=(request:FastifyRequest)=>request.raw.rawHeaders;
 app.get('/api/v1/deliveries',request=>service.list(session(request),request.query,request.id));
 app.get('/api/v1/deliveries/eligible-agents',request=>service.agents(session(request),request.query,request.id));
 app.get<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id',request=>service.read(session(request),request.params.parcel_id,request.query,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/start',request=>service.start(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,false,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/retry',request=>service.start(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,true,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/resend',request=>service.resend(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,false,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/replace',request=>service.resend(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,true,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/complete',request=>service.complete(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,false,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/exception-requests',request=>service.requestException(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/exception-approvals',request=>service.approveException(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,request.id));
 app.post<{Params:{parcel_id:string}}>('/api/v1/deliveries/:parcel_id/exception-complete',request=>service.complete(session(request),request.params.parcel_id,request.query,key(request),raw(request),request.body,true,request.id));
}
