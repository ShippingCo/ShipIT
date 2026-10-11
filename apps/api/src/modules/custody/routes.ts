import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DatabasePool} from '@shippingco/db';
import {object} from '../pricing/validation.ts';
import {createParcelCustodyService} from './service.ts';
import {createCustodyExportService} from './exports.ts';
export function registerCustody(app:FastifyInstance,database:DatabasePool,secure:boolean,writesEnabled=false){
 const service=createParcelCustodyService(database,writesEnabled),exports=createCustodyExportService(database);
 const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 const key=(request:FastifyRequest)=>request.headers['idempotency-key'],raw=(request:FastifyRequest)=>request.raw.rawHeaders;
 const paged=(request:FastifyRequest)=>{const b=object(request.query,['organization_id','franchise_id','cursor']);return {selection:{organization_id:b.organization_id,franchise_id:b.franchise_id},cursor:b.cursor};};
 app.register(async scoped=>{
  scoped.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store, private');return payload;});
  scoped.get('/api/v1/custody/worklist',request=>{const q=paged(request);return service.worklist(session(request),q.selection,q.cursor,request.id);});
  scoped.get('/api/v1/custody/manifests',request=>{const q=paged(request);return service.manifests(session(request),q.selection,q.cursor,request.id);});
  scoped.get('/api/v1/custody/eligible-agents',request=>{const q=paged(request);return service.agents(session(request),q.selection,request.id,q.cursor);});
  scoped.get('/api/v1/custody/transfer-grants',request=>{const q=paged(request);return service.transfers(session(request),q.selection,q.cursor,request.id);});
  scoped.get<{Params:{id:string}}>('/api/v1/custody/transfer-grants/:id/manifests',request=>{const q=paged(request);return service.outgoingManifests(session(request),request.params.id,q.selection,q.cursor,request.id);});
  scoped.post('/api/v1/custody/assignment-instructions',request=>service.authorize(session(request),request.query,key(request),raw(request),request.body,request.id));
  scoped.post('/api/v1/custody/manifests',request=>service.prepare(session(request),request.query,key(request),raw(request),request.body,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/custody/manifests/:id',request=>service.read(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/custody/manifests/:id/report',request=>service.report(session(request),request.params.id,request.query,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/custody/manifests/:id/acknowledge',request=>service.acknowledge(session(request),request.params.id,request.query,key(request),raw(request),request.body,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/custody/manifests/:id/cancel',request=>service.cancel(session(request),request.params.id,request.query,key(request),raw(request),request.body,request.id));
  scoped.post('/api/v1/custody/returns',request=>service.receiveReturn(session(request),request.query,key(request),raw(request),request.body,request.id));
  scoped.post('/api/v1/custody/grants',request=>service.grant(session(request),request.query,key(request),raw(request),request.body,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/custody/grants/:id/revoke',request=>service.revokeGrant(session(request),request.params.id,request.query,key(request),raw(request),request.body,request.id));
  scoped.post('/api/v1/custody/releases',request=>service.release(session(request),request.query,key(request),raw(request),request.body,request.id));
  scoped.post<{Params:{id:string}}>('/api/v1/custody/manifests/:id/exports',request=>{object(request.body??{},[]);return exports.capture(session(request),request.params.id,request.query,key(request),raw(request),request.id);});
  scoped.get<{Params:{id:string}}>('/api/v1/custody/exports/:id',request=>exports.read(session(request),request.params.id,request.query,request.id));
  scoped.get<{Params:{id:string}}>('/api/v1/custody/exports/:id/export',request=>exports.read(session(request),request.params.id,request.query,request.id,true));
  scoped.get<{Params:{id:string}}>('/api/v1/custody/exports/:id/download',async(request,reply)=>{
   const result=await exports.read(session(request),request.params.id,request.query,request.id,true);
   if(!('csv' in result))throw new Error('CUSTODY_EXPORT_CONTRACT');
   return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="custody-'+result.snapshot.id+'.csv"').header('X-Content-Type-Options','nosniff').send(result.csv);
  });
 });
}
