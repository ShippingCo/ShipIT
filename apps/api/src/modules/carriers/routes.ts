import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { createCarrierService } from './service.ts';
import { idempotencyKey } from './validation.ts';
import type { createCarrierImportService } from './import-service.ts';
import { CsvError, csvLimits } from './csv.ts';
import type { createCarrierReconciliationService } from './reconciliation-service.ts';
import type { createCarrierRateService } from './rate-service.ts';
export function registerCarriers(app:FastifyInstance,service:ReturnType<typeof createCarrierService>,secure:boolean,imports:ReturnType<typeof createCarrierImportService>,review:ReturnType<typeof createCarrierReconciliationService>,rates:ReturnType<typeof createCarrierRateService>) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const key=(request:FastifyRequest)=>idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders);
  const installations='/api/v1/carriers/installations';
  app.get<{Params:{id:string}}>(installations+'/:id/health',{exposeHeadRoute:false},request=>service.health(session(request),request.params.id,request.query,request.id));
  app.post<{Params:{id:string}}>(installations+'/:id/rates',async(request,reply)=>{
    try {return reply.code(201).send(await rates.create(session(request),request.params.id,key(request),request.body,request.query,request.id));}
    catch(error){if(error instanceof CsvError)return reply.code(422).send({error:{code:'VALIDATION_FAILED',message:'Check the rate file.',correlation_id:request.id,details:[{field:'csv',code:error.issue,row:error.row}]}});throw error;}
  });
  app.get<{Params:{id:string}}>('/api/v1/carriers/rates/:id',{exposeHeadRoute:false},request=>rates.read(session(request),request.params.id,request.query,request.id));
  app.post<{Params:{id:string}}>('/api/v1/carriers/rates/:id/approve',request=>rates.approve(session(request),request.params.id,key(request),request.body,request.query,request.id));
  app.get<{Params:{id:string}}>(installations+'/:id/reconciliation',{exposeHeadRoute:false},request=>review.list(session(request),request.params.id,request.query,request.id));
  app.post<{Params:{id:string}}>('/api/v1/carriers/reconciliation/:id/resolve',request=>review.resolve(session(request),request.params.id,key(request),request.body,request.query,request.id));
  app.post<{Params:{id:string}}>(installations+'/:id/imports',async(request,reply)=>{
    try { return reply.code(201).send(await imports.create(session(request),request.params.id,key(request),request.body,request.query,request.id)); }
    catch(error){
      if(error instanceof CsvError)return reply.code(422).send({error:{code:'VALIDATION_FAILED',message:'Check the CSV file and column mapping.',
        correlation_id:request.id,details:[{field:'csv',code:error.issue,row:error.row}],limits:csvLimits}});
      throw error;
    }
  });
  app.get<{Params:{id:string}}>('/api/v1/carriers/imports/:id',{exposeHeadRoute:false},request=>imports.status(session(request),request.params.id,request.query,request.id));
  app.post<{Params:{id:string}}>('/api/v1/carriers/imports/:id/commit',request=>imports.commit(session(request),request.params.id,key(request),request.body,request.query,request.id));
  app.post(installations,async(request,reply)=>reply.code(201).send(await service.mutate('installation',session(request),null,key(request),request.body,request.query,request.id)));
  app.get(installations,{exposeHeadRoute:false},request=>service.list('installations',session(request),null,request.query,request.id));
  app.post<{Params:{id:string}}>(installations+'/:id/mappings',async(request,reply)=>reply.code(201).send(await service.mutate('mapping',session(request),request.params.id,key(request),request.body,request.query,request.id)));
  app.get<{Params:{id:string}}>(installations+'/:id/mappings',{exposeHeadRoute:false},request=>service.list('mappings',session(request),request.params.id,request.query,request.id));
  for(const [kind,operation] of [['references','reference'],['observations','observation']] as const){
    const path='/api/v1/parcels/:id/carriers/'+kind;
    app.post<{Params:{id:string}}>(path,async(request,reply)=>reply.code(201).send(await service.mutate(operation,session(request),request.params.id,key(request),request.body,request.query,request.id)));
    app.get<{Params:{id:string}}>(path,{exposeHeadRoute:false},request=>service.list(kind,session(request),request.params.id,request.query,request.id));
  }
}
