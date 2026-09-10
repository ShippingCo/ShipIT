import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MembershipService } from './service.ts';

interface OrganizationParams { organizationId:string }
interface MembershipParams { membershipId:string }
interface InvitationParams { invitationId:string }

export function registerMemberships(app:FastifyInstance,service:MembershipService,secure:boolean) {
  const sessionName=secure?'__Host-shipit_session':'shipit_session';
  const session=(request:FastifyRequest)=>request.cookies[sessionName]??'';
  app.get<{Params:OrganizationParams}>('/api/v1/organizations/:organizationId/memberships',async request=>
    service.listMemberships(session(request),request.params.organizationId));
  app.get<{Params:OrganizationParams}>('/api/v1/organizations/:organizationId/invitations',async request=>
    service.listInvitations(session(request),request.params.organizationId));
  app.post('/api/v1/membership-invitations',async (request,reply)=>{
    const result=await service.createInvitation(session(request),request.body);
    return reply.code(201).send(result);
  });
  app.post('/api/v1/membership-invitations/accept',async (request,reply)=>{
    const result=await service.acceptInvitation(session(request),request.body);
    return reply.code(201).send(result);
  });
  app.post<{Params:InvitationParams}>('/api/v1/membership-invitations/:invitationId/revoke',async request=>
    service.revokeInvitation(session(request),request.params.invitationId,request.body));
  app.patch<{Params:MembershipParams}>('/api/v1/memberships/:membershipId',async request=>
    service.updateMembership(session(request),request.params.membershipId,request.body));
  app.post<{Params:MembershipParams}>('/api/v1/memberships/:membershipId/revoke',async request=>
    service.revokeMembership(session(request),request.params.membershipId,request.body));
}
