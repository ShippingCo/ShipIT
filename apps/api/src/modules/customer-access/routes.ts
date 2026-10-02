import type { FastifyInstance,FastifyRequest } from 'fastify';
import { HttpError } from '../../plugins/errors.ts';
import { idempotencyKey } from '../customers/validation.ts';
import { object } from '../pricing/validation.ts';
import type { createCustomerAccessService } from './service.ts';

export function registerCustomerAccess(app:FastifyInstance,service:ReturnType<typeof createCustomerAccessService>,secure:boolean) {
  const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  app.post<{Params:{id:string}}>('/api/v1/customer-access/parcels/:id/bind',request=>
    service.bind(session(request),request.params.id,request.query,idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
  app.post<{Params:{id:string}}>('/api/v1/customer-access/parcels/:id/revoke',request=>
    service.revoke(session(request),request.params.id,request.query,idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id));
  // Bearer grants stay out of URLs, cookies, browser persistence and request logs.
  app.get('/api/v1/customer-tracking',{exposeHeadRoute:false,config:{rateLimit:{max:30,timeWindow:60000}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
    const query=object(request.query,['docket']),header=request.headers.authorization;
    if(typeof header!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(header))throw new HttpError('RESOURCE_NOT_FOUND');
    return service.track(header.slice(7),query.docket??null);
  });
}
