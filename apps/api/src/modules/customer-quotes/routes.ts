import type { FastifyInstance,FastifyRequest } from 'fastify';
import { idempotencyKey,selection } from '../pricing/validation.ts';
import type { createQuotePolicyService } from './policy-service.ts';
export function registerQuotePolicies(app:FastifyInstance,service:ReturnType<typeof createQuotePolicyService>,secure:boolean) {
 const session=(r:FastifyRequest)=>r.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
 app.get('/api/v1/customer-quotes/policy',request=>{const q=selection(request.query);return service.read(session(request),q.organizationId,q.franchiseId,request.id);});
 app.post('/api/v1/customer-quotes/policy',request=>{const q=selection(request.query);return service.configure(session(request),q.organizationId,q.franchiseId,
  idempotencyKey(request.headers['idempotency-key'],request.raw.rawHeaders),request.body,request.id);});
}
