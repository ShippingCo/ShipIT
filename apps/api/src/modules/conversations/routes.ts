import type { FastifyInstance } from 'fastify';
import type { createAssistantMetrics } from './metrics.ts';
export function registerAssistantMetrics(app:FastifyInstance,read:ReturnType<typeof createAssistantMetrics>,secure:boolean) {
 app.get('/api/v1/assistant/metrics',async request=>{
  const result=await read(request.cookies[secure?'__Host-shipit_session':'shipit_session']??'',request.query,request.id);
  request.log.info({action:'assistant.metrics.read',result:'allowed'},'Assistant metrics accessed');
  return result;
 });
}
