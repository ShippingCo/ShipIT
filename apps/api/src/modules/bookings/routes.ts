import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { createBookingService } from './service.ts';
import { selection, idempotencyKey } from './validation.ts';
import { HttpError } from '../../plugins/errors.ts';
export function registerBookings(app: FastifyInstance, service: ReturnType<typeof createBookingService>, secure: boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const searchBudget=app.createRateLimit({max:30,timeWindow:60_000});
  app.get('/api/v1/bookings/entries',request=>service.listEntries(session(request),request.query,request.id));
  app.post('/api/v1/bookings/entries',async(request,reply)=>{
    const key=idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
    return reply.code(201).send(await service.saveEntry(session(request),request.query,key,request.body,request.id));
  });
  app.get('/api/v1/parcels/summary',{preHandler:async(request,reply)=>{
    const result=await searchBudget(request);
    if(!result.isAllowed&&result.isExceeded){reply.header('Retry-After',result.ttlInSeconds);throw new HttpError('RATE_LIMITED');}
  }},request=>service.dashboard(session(request),request.query,request.id));
  app.get('/api/v1/parcels',{preHandler:async(request,reply)=>{
    const result=await searchBudget(request);
    if(!result.isAllowed&&result.isExceeded){reply.header('Retry-After',result.ttlInSeconds);throw new HttpError('RATE_LIMITED');}
  }},request=>service.list(session(request),request.query,request.id));
  app.get<{Params:{parcel_id:string}}>('/api/v1/parcels/:parcel_id/timeline',request=>
    service.timeline(session(request),request.params.parcel_id,request.query,request.id));
  app.get<{Params:{parcel_id:string}}>('/api/v1/parcels/:parcel_id',request=>
    service.read(session(request),request.params.parcel_id,request.query,request.id));
  app.get<{Params:{id:string}}>('/api/v1/bookings/:id/cancellation',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return service.cancellationPreview(session(request), request.query, request.params.id, request.id);
  });
  app.post<{Params:{id:string}}>('/api/v1/bookings/:id/cancellation',async(request,reply)=>{
    const key=idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
    reply.header('Cache-Control','no-store');
    return service.cancelBooking(session(request),request.query,request.params.id,key,request.body,request.id);
  });
  app.post('/api/v1/bookings',async (request,reply) => {
    const s = selection(request.query), key = idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
    return reply.code(201).send(await service.create(session(request),s.organizationId,s.franchiseId,key,request.body,request.id));
  });
}
