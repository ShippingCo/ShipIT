import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MembershipService } from './service.ts';

interface OrganizationParams { organizationId:string }
interface MembershipParams { membershipId:string }
interface InvitationParams { invitationId:string }

export function registerMemberships(app:FastifyInstance,service:MembershipService,secure:boolean) {
  const sessionName=secure?'__Host-shipit_session':'shipit_session';
  const session=(request:FastifyRequest)=>request.cookies[sessionName]??'';
  app.get<{Params:OrganizationParams}>('/api/v1/organizations/:organizationId/memberships',async request=>
    service.withCorrelation(request.id).listMemberships(session(request),request.params.organizationId));
  app.get<{Params:OrganizationParams}>('/api/v1/organizations/:organizationId/invitations',async request=>
    service.withCorrelation(request.id).listInvitations(session(request),request.params.organizationId));
  app.post('/api/v1/membership-invitations',async (request,reply)=>{
    const result=await service.withCorrelation(request.id).createInvitation(session(request),request.body);
    return reply.code(201).send(result);
  });
  app.post('/api/v1/membership-invitations/accept',async (request,reply)=>{
    const result=await service.withCorrelation(request.id).acceptInvitation(session(request),request.body);
    return reply.code(201).send(result);
  });
  app.post<{Params:InvitationParams}>('/api/v1/membership-invitations/:invitationId/revoke',async request=>
    service.withCorrelation(request.id).revokeInvitation(session(request),request.params.invitationId,request.body));
  app.patch<{Params:MembershipParams}>('/api/v1/memberships/:membershipId',async request=>
    service.withCorrelation(request.id).updateMembership(session(request),request.params.membershipId,request.body));
  app.post<{Params:MembershipParams}>('/api/v1/memberships/:membershipId/revoke',async request=>
    service.withCorrelation(request.id).revokeMembership(session(request),request.params.membershipId,request.body));
}
