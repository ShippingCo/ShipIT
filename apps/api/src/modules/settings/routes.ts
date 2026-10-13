import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {createSettingsService} from './service.ts';
export function registerSettings(app:FastifyInstance,database:DatabasePool,secure:boolean,enabled:boolean){
 const service=createSettingsService(database,enabled),session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 for(const owner of ['organization','franchise'] as const){
  app.get(`/api/v1/settings/${owner}`,(request,reply)=>{reply.header('Cache-Control','no-store');return service.read(session(request),owner,request.query,request.id);});
  app.get(`/api/v1/settings/${owner}/history`,(request,reply)=>{reply.header('Cache-Control','no-store');return service.history(session(request),owner,request.query,request.id);});
  app.post(`/api/v1/settings/${owner}`,{bodyLimit:65536},(request,reply)=>{reply.header('Cache-Control','no-store');return service.update(session(request),owner,request.query,request.headers['idempotency-key'],request.raw.rawHeaders,request.body,request.id);});
 }
 app.get('/api/v1/reports/scopes',(request,reply)=>{reply.header('Cache-Control','no-store');return service.scopes(session(request),request.query,request.id);});
}
