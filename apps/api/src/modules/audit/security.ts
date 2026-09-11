import type { DatabasePool } from '@shippingco/db';
import type { FastifyInstance } from 'fastify';
import { AuthRepository } from '../auth/repository.ts';
import { digest } from '../auth/crypto.ts';
import { HttpError } from '../../plugins/errors.ts';
import { denialReasons, type DenialAction, type DenialReason, type ResourceType } from './types.ts';
import type { SecurityTelemetry } from './telemetry.ts';

function category(route:string,method:string):[DenialAction,ResourceType] {
  if(route==='/api/v1/audit')return ['audit.read','audit'];
  if(route==='/api/v1/membership-invitations/accept')return ['invitation.accept','invitation'];
  if(route==='/api/v1/membership-invitations')return ['invitation.create','invitation'];
  if(route==='/api/v1/membership-invitations/:invitationId/revoke')return ['invitation.revoke','invitation'];
  if(route.startsWith('/api/v1/memberships/')||route.startsWith('/api/v1/organizations/'))return ['membership.manage','membership'];
  if(route==='/auth/challenges')return ['auth.start','identity'];
  if(route==='/auth/challenges/verify')return ['auth.verify','identity'];
  if(route==='/auth/challenges/resend')return ['auth.resend','identity'];
  if(route.startsWith('/auth/'))return [method==='GET'?'auth.session':'auth.manage','identity'];
  return ['security.request','request'];
}
export function registerSecurityAudit(app:FastifyInstance,database:DatabasePool,secure:boolean,telemetry:SecurityTelemetry) {
  app.addHook('onError',async (request,_reply,error)=>{
    if(!(error instanceof HttpError)||!denialReasons.includes(error.code as DenialReason))return;
    const [action,resource_type]=category(request.routeOptions.url??'',request.method);
    const reason_code=error.code as DenialReason;
    // Metric adapters cannot turn a denial into an allowed operation or response.
    try {telemetry.denied({action,resource_type,reason_code,result:'denied'});}catch{/* monitoring is not authority */}
    try {
      const repo=new AuthRepository(database),token=request.cookies?.[secure?'__Host-shipit_session':'shipit_session'];
      const session=token&&/^[A-Za-z0-9_-]{43}$/.test(token)?await repo.session(digest(token)):undefined;
      await repo.denial(session?{type:'user',id:session.user_id}:{type:'anonymous',id:'anonymous'},action,resource_type,reason_code,request.id);
    } catch {
      try {telemetry.recordingFailed();}catch{/* preserve denial */}
      request.log.error({event:'security_audit_unavailable',code:'TEMPORARILY_UNAVAILABLE',request_id:request.id},'Security audit unavailable');
    }
  });
}
