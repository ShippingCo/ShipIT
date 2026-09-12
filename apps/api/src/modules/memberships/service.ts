import type { OperatorContext, OnboardingResult } from '@shippingco/shared';
import { onboardingInput, requestKey, fingerprint } from '../onboarding/validation.ts';
import { bootstrapTenancyInTransaction } from '../tenancy/service.ts';
import { usableFranchises } from '../tenancy/repository.ts';
import { randomUUID } from 'node:crypto';
import { digest, secret } from '../auth/crypto.ts';
import { AuthRepository } from '../auth/repository.ts';
import { DatabaseError, withTransaction, type DatabasePool, type TransactionExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import type { TenancyAction, TenancyAuthorizer } from '../tenancy/types.ts';
import * as repository from './repository.ts';
import { appendMembership } from '../audit/repository.ts';
import * as authorityRepository from './authority.ts';
import { issueTenantAccess, type PrivateAction } from '../security/scope.ts';
import { canManageGrant, managementAuthority, tenancyScope, type ManagementAuthority } from './policy.ts';
import { invitationDto, membershipDto, type Role } from './types.ts';
import * as validate from './validation.ts';

async function membershipTransaction<T>(database:DatabasePool,work:(tx:TransactionExecutor)=>Promise<T>):Promise<T> {
  let domainError:HttpError|undefined;
  try {
    return await withTransaction(database,async tx=>{
      try { return await work(tx); }
      catch(error) {
        if(error instanceof HttpError) domainError=error;
        // The indexes remain the final boundary if occupancy changes after a check.
        // Translate inside the transaction so normal rollback must succeed first.
        if(error instanceof DatabaseError && error.code==='DB_QUERY_FAILED' && error.sqlState==='23505') {
          if(error.constraint==='memberships_one_active_role_idx') domainError=new HttpError('MEMBERSHIP_CONFLICT');
          if(error.constraint==='invitations_one_pending_role_idx') domainError=new HttpError('INVITATION_CONFLICT');
        }
        throw domainError??error;
      }
    });
  } catch(error) {
    if(domainError && error instanceof DatabaseError && error.code==='DB_TRANSACTION_FAILED') throw domainError;
    throw new HttpError('TEMPORARILY_UNAVAILABLE');
  }
}
async function authenticated(tx:TransactionExecutor,sessionToken:string,lock=true) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) throw new HttpError('UNAUTHENTICATED');
  const session=await new AuthRepository(tx).session(digest(sessionToken),lock);
  if(!session) throw new HttpError('UNAUTHENTICATED');
  return session;
}
function access(tx:TransactionExecutor, userId:string, organizationId:string, authority:ManagementAuthority,
  action:PrivateAction='memberships.manage',correlationId:string=randomUUID()) {
  return issueTenantAccess(tx,{action,actor:{type:'user',id:userId},organizationId,
    permittedFranchiseIds:authority.franchiseIds,organizationWide:authority.organizationWide,
    correlationId,provenance:'membership'});
}
async function authorizeManagement(tx:TransactionExecutor,sessionToken:string,organizationId:string,action:PrivateAction='memberships.manage',correlationId?:string) {
  const session=await authenticated(tx,sessionToken);
  // Identity-bound resolution precedes private organization access.
  if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId)) throw new HttpError('ACTION_FORBIDDEN');
  if(!await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError('ACTION_FORBIDDEN');
  const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
  const authority=managementAuthority(memberships);
  if(!authority) throw new HttpError('ACTION_FORBIDDEN');
  return {session,authority,scope:access(tx,session.user_id,organizationId,authority,action,correlationId)};
}
async function objectAuthority(tx:TransactionExecutor,sessionToken:string,id:string,kind:'membership'|'invitation',correlationId?:string) {
  const session=await authenticated(tx,sessionToken);
  for(const organizationId of await authorityRepository.userOrganizationIds(tx,session.user_id)) {
    if(!await authorityRepository.lockOrganization(tx,organizationId)) continue;
    const authority=managementAuthority(await authorityRepository.activeMemberships(tx,session.user_id,organizationId));
    if(!authority) continue;
    const scope=access(tx,session.user_id,organizationId,authority,'memberships.manage',correlationId);
    const current=kind==='membership' ? await repository.findMembership(scope,organizationId,id,true)
      : await repository.findInvitation(scope,organizationId,id,true);
    if(current) return {session,organizationId,authority,scope};
  }
  throw new HttpError('RESOURCE_NOT_FOUND');
}
function manageable(authority:ManagementAuthority,role:Role,franchiseIds:readonly string[]) {
  if(!canManageGrant(authority,role,franchiseIds)) throw new HttpError('RESOURCE_NOT_FOUND');
}
async function bootstrapAdministratorInTransaction(tx: TransactionExecutor, userId: string,
  organizationId: string, correlationId: string) {
  const scope=issueTenantAccess(tx,{action:'memberships.bootstrap',actor:{type:'service',id:'onboarding'},organizationId,
    permittedFranchiseIds:[],organizationWide:true,correlationId,provenance:'internal-service'});
  if((await repository.listMemberships(scope,organizationId)).length) throw new HttpError('ACTION_FORBIDDEN');
  const result=await repository.insertMembership(scope,{userId,organizationId,role:'org_admin',franchiseIds:[]});
  await appendMembership(scope,{organizationId,actorType:'service',actorUserId:null,affectedUserId:userId,
    membershipId:result.id,action:'bootstrap_admin',role:result.role,franchiseIds:[]});
  return result;
}
async function permittedContext(tx: TransactionExecutor, userId: string, correlationId: string,
  selected?: string): Promise<OperatorContext> {
  const franchises: OperatorContext['franchises'] = [];
  for (const organizationId of await authorityRepository.userOrganizationIds(tx,userId)) {
    if (!await authorityRepository.lockOrganization(tx,organizationId)) continue;
    const memberships=await authorityRepository.activeMemberships(tx,userId,organizationId);
    const all=memberships.some(m=>m.role==='org_admin') ? await authorityRepository.organizationFranchiseIds(tx,organizationId) : [];
    const ids=tenancyScope('franchise.profile.list',memberships,all);
    if (!ids) continue;
    const scope=issueTenantAccess(tx,{action:'franchise.profile.list',actor:{type:'user',id:userId},organizationId,
      permittedFranchiseIds:ids,organizationWide:false,correlationId,provenance:'membership'});
    for (const row of await usableFranchises(scope)) franchises.push({ id:row.id,display_name:row.display_name,
      organization:{id:organizationId,display_name:row.organization_name},
      roles:[...new Set(memberships.filter(m=>m.role==='org_admin'||m.franchiseIds.includes(row.id)).map(m=>m.role))] });
  }
  if (selected && !franchises.some(f=>f.id===selected)) throw new HttpError('RESOURCE_NOT_FOUND');
  const history=await authorityRepository.hasMembershipHistory(tx,userId);
  return {user_id:userId,state:franchises.length?'ready':history?'scope_unavailable':'onboarding_required',
    franchises,active_franchise_id:selected??franchises[0]?.id??null};
}
function createMembershipCore(database:DatabasePool,correlationId?:string) {
  return {
    async operatorContext(sessionToken: string, selectedInput?: unknown): Promise<OperatorContext> {
      const selected=selectedInput===undefined?undefined:validate.uuid(selectedInput);
      return membershipTransaction(database,async tx=>{
        const session=await authenticated(tx,sessionToken);
        return permittedContext(tx,session.user_id,correlationId??randomUUID(),selected);
      });
    },
    async onboard(sessionToken: string, keyInput: unknown, input: unknown): Promise<OnboardingResult> {
      const body=onboardingInput(input),key=requestKey(keyInput),intent=fingerprint(body),correlation=correlationId??randomUUID();
      return membershipTransaction(database,async tx=>{
        // Exclusive identity lock serializes different sessions/keys; the PK remains the final invariant.
        const initial=await authenticated(tx,sessionToken,false);
        try { await new AuthRepository(tx).user(initial.user_id,true); }
        catch(error) {
          if(error instanceof DatabaseError && error.code==='DB_TIMEOUT') throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
          throw error;
        }
        const session=await authenticated(tx,sessionToken);
        const previous=await authorityRepository.onboardingHistory(tx,session.user_id);
        if(previous) {
          // Reauthorize the original result before disclosing replay or mismatch evidence.
          const context=await permittedContext(tx,session.user_id,correlation,previous.franchise_id);
          if(!context.franchises.some(f=>f.id===previous.franchise_id&&f.roles.includes('org_admin')))
            throw new HttpError('ACTION_FORBIDDEN');
          if(previous.request_key!==key) throw new HttpError('ACTION_FORBIDDEN');
          if(previous.fingerprint!==intent) throw new HttpError('IDEMPOTENCY_CONFLICT');
          return previous.result;
        }
        if(await authorityRepository.hasMembershipHistory(tx,session.user_id)) throw new HttpError('ACTION_FORBIDDEN');
        const roots=await bootstrapTenancyInTransaction(tx,body,session.user_id,correlation);
        const membership=await bootstrapAdministratorInTransaction(tx,session.user_id,roots.organization.id,correlation);
        const result:OnboardingResult={command_id:randomUUID(),
          organization:{id:roots.organization.id,display_name:roots.organization.displayName},
          franchise:{id:roots.franchise.id,display_name:roots.franchise.displayName},role:'org_admin'};
        await authorityRepository.saveOnboarding(tx,session.user_id,key,intent,membership.id,result);
        return result;
      });
    },
    // Trusted onboarding seam only. #17 calls this while creating the first organization owner.
    async bootstrapAdministrator(userIdInput:unknown,organizationIdInput:unknown) {
      const userId=validate.uuid(userIdInput),organizationId=validate.uuid(organizationIdInput);
      return membershipTransaction(database,async tx=>{
        if(!await authorityRepository.activeUser(tx,userId,true)) throw new HttpError('RESOURCE_NOT_FOUND');
        if(!await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError('RESOURCE_NOT_FOUND');
        return membershipDto(await bootstrapAdministratorInTransaction(tx,userId,organizationId,correlationId??randomUUID()));
      });
    },
    async listMemberships(sessionToken:string,organizationIdInput:unknown) {
      const organizationId=validate.uuid(organizationIdInput);
      return membershipTransaction(database,async tx=>{
        const {scope}=await authorizeManagement(tx,sessionToken,organizationId,'memberships.read',correlationId);
        return {items:(await repository.listMemberships(scope,organizationId)).map(membershipDto)};
      });
    },
    async listInvitations(sessionToken:string,organizationIdInput:unknown) {
      const organizationId=validate.uuid(organizationIdInput);
      return membershipTransaction(database,async tx=>{
        const {scope}=await authorizeManagement(tx,sessionToken,organizationId,'memberships.read',correlationId),now=await new AuthRepository(tx).now();
        return {items:(await repository.listInvitations(scope,organizationId)).map(value=>invitationDto(value,now))};
      });
    },
    async createInvitation(sessionToken:string,input:unknown) {
      const body=validate.createInvitationInput(input),acceptanceToken=secret(),tokenHash=digest(acceptanceToken);
      return membershipTransaction(database,async tx=>{
        const {session,authority,scope}=await authorizeManagement(tx,sessionToken,body.organizationId,'memberships.manage',correlationId);
        if(session.user_id===body.inviteeUserId) throw new HttpError('ACTION_FORBIDDEN');
        manageable(authority,body.role,body.franchiseIds);
        if(!await repository.validateFranchises(scope,body.organizationId,body.franchiseIds)) throw new HttpError('RESOURCE_NOT_FOUND');
        if(!await authorityRepository.activeUser(tx,body.inviteeUserId,true)) throw new HttpError('RESOURCE_NOT_FOUND');
        if(await authorityRepository.activeRoleExists(tx,scope,body.inviteeUserId,body.role)) throw new HttpError('MEMBERSHIP_CONFLICT');
        const expired=await repository.expiredPendingInvitation(scope,body.inviteeUserId,body.organizationId,body.role);
        if(expired) {
          if(!await repository.revokeInvitation(scope,expired)) throw new HttpError('INVITATION_CONFLICT');
          await appendMembership(scope,{organizationId:body.organizationId,actorType:'user',actorUserId:session.user_id,
            affectedUserId:body.inviteeUserId,invitationId:expired.id,action:'invitation_expired',role:expired.role,
            franchiseIds:expired.franchiseIds});
        }
        // Expiry does not release the pending index. Replacement above requires
        // authority over the old grant; inaccessible (even expired) grants conflict.
        if(await authorityRepository.pendingInvitationExists(tx,scope,body.inviteeUserId,body.role)) throw new HttpError('INVITATION_CONFLICT');
        const result=await repository.insertInvitation(scope,{...body,tokenHash,actorUserId:session.user_id});
        await appendMembership(scope,{organizationId:body.organizationId,actorType:'user',actorUserId:session.user_id,
          affectedUserId:body.inviteeUserId,invitationId:result.id,action:'invitation_created',role:body.role,franchiseIds:body.franchiseIds});
        return {...invitationDto(result),acceptance_token:acceptanceToken};
      });
    },
    async revokeInvitation(sessionToken:string,invitationIdInput:unknown,input:unknown) {
      const invitationId=validate.uuid(invitationIdInput),body=validate.expectedVersionInput(input);
      return membershipTransaction(database,async tx=>{
        const {session:authenticatedSession,organizationId,authority,scope}=await objectAuthority(tx,sessionToken,invitationId,'invitation',correlationId);
        const current=await repository.findInvitation(scope,organizationId,invitationId,true);
        if(!current) throw new HttpError('RESOURCE_NOT_FOUND');
        if(!authority) throw new HttpError('RESOURCE_NOT_FOUND');
        manageable(authority,current.role,current.franchiseIds);
        if(current.version!==body.expectedVersion) throw new HttpError('VERSION_CONFLICT');
        if(current.state!=='pending' || !(await repository.revokeInvitation(scope,current))) throw new HttpError('ACTION_FORBIDDEN');
        await appendMembership(scope,{organizationId,actorType:'user',actorUserId:authenticatedSession.user_id,
          affectedUserId:current.inviteeUserId,invitationId:current.id,action:'invitation_revoked',role:current.role,franchiseIds:current.franchiseIds});
        return {ok:true};
      });
    },
    async acceptInvitation(sessionToken:string,input:unknown) {
      const body=validate.acceptanceInput(input),tokenHash=digest(body.token);
      return membershipTransaction(database,async tx=>{
        const session=await authenticated(tx,sessionToken);
        const organizationId=await authorityRepository.invitationOrganization(tx,tokenHash,session.user_id);
        if(!organizationId || !await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError('ACTION_FORBIDDEN');
        const current=await authorityRepository.findInvitationByToken(tx,organizationId,tokenHash,session.user_id),now=await new AuthRepository(tx).now();
        if(!current || current.state!=='pending' || current.expiresAt<=now || current.inviteeUserId!==session.user_id) throw new HttpError('ACTION_FORBIDDEN');
        const scope=issueTenantAccess(tx,{action:'invitations.accept',actor:{type:'user',id:session.user_id},organizationId,
          permittedFranchiseIds:current.franchiseIds,organizationWide:current.role==='org_admin',invitationId:current.id,correlationId:correlationId??randomUUID(),provenance:'invitation'});
        if(await authorityRepository.activeRoleExists(tx,scope,current.inviteeUserId,current.role)) throw new HttpError('MEMBERSHIP_CONFLICT');
        const created=await repository.insertMembership(scope,{userId:current.inviteeUserId,organizationId:current.organizationId,
          role:current.role,franchiseIds:current.franchiseIds});
        if(!await repository.acceptInvitation(scope,current)) throw new HttpError('ACTION_FORBIDDEN');
        await appendMembership(scope,{organizationId:current.organizationId,actorType:'user',actorUserId:session.user_id,
          affectedUserId:session.user_id,membershipId:created.id,invitationId:current.id,action:'invitation_accepted',
          role:created.role,franchiseIds:created.franchiseIds});
        return membershipDto(created);
      });
    },
    async updateMembership(sessionToken:string,membershipIdInput:unknown,input:unknown) {
      const membershipId=validate.uuid(membershipIdInput),body=validate.updateMembershipInput(input);
      return membershipTransaction(database,async tx=>{
        const {session:authenticatedSession,organizationId,authority,scope}=await objectAuthority(tx,sessionToken,membershipId,'membership',correlationId);
        const current=await repository.findMembership(scope,organizationId,membershipId,true);
        if(!current || current.lifecycle!=='active') throw new HttpError('RESOURCE_NOT_FOUND');
        if(current.userId===authenticatedSession.user_id) throw new HttpError('ACTION_FORBIDDEN');
        // Object APIs deliberately hide foreign records from non-managers.
        if(!authority) throw new HttpError('RESOURCE_NOT_FOUND');
        manageable(authority,current.role,current.franchiseIds);manageable(authority,body.role,body.franchiseIds);
        if(current.version!==body.expectedVersion) throw new HttpError('VERSION_CONFLICT');
        if(!await repository.validateFranchises(scope,organizationId,body.franchiseIds)) throw new HttpError('RESOURCE_NOT_FOUND');
        if(current.role==='org_admin' && body.role!=='org_admin' && await repository.activeAdminCount(scope,organizationId,current.id)<1) throw new HttpError('ACTION_FORBIDDEN');
        if(await authorityRepository.activeRoleExists(tx,scope,current.userId,body.role,current.id)) throw new HttpError('MEMBERSHIP_CONFLICT');
        const changed=await repository.updateMembership(scope,current,body.role,body.franchiseIds);
        if(!changed) throw new HttpError('VERSION_CONFLICT');
        await appendMembership(scope,{organizationId,actorType:'user',actorUserId:authenticatedSession.user_id,
          affectedUserId:changed.userId,membershipId:changed.id,action:'membership_updated',role:changed.role,franchiseIds:changed.franchiseIds});
        return membershipDto(changed);
      });
    },
    async revokeMembership(sessionToken:string,membershipIdInput:unknown,input:unknown) {
      const membershipId=validate.uuid(membershipIdInput),body=validate.expectedVersionInput(input);
      return membershipTransaction(database,async tx=>{
        const {session:authenticatedSession,organizationId,authority,scope}=await objectAuthority(tx,sessionToken,membershipId,'membership',correlationId);
        const current=await repository.findMembership(scope,organizationId,membershipId,true);
        if(!current || current.lifecycle!=='active') throw new HttpError('RESOURCE_NOT_FOUND');
        if(current.userId===authenticatedSession.user_id) throw new HttpError('ACTION_FORBIDDEN');
        if(!authority) throw new HttpError('RESOURCE_NOT_FOUND');
        manageable(authority,current.role,current.franchiseIds);
        if(current.version!==body.expectedVersion) throw new HttpError('VERSION_CONFLICT');
        if(current.role==='org_admin' && await repository.activeAdminCount(scope,organizationId,current.id)<1) throw new HttpError('ACTION_FORBIDDEN');
        if(!await repository.revokeMembership(scope,current)) throw new HttpError('VERSION_CONFLICT');
        await appendMembership(scope,{organizationId,actorType:'user',actorUserId:authenticatedSession.user_id,
          affectedUserId:current.userId,membershipId:current.id,action:'membership_revoked',role:current.role,franchiseIds:current.franchiseIds});
        return {ok:true};
      });
    },
  };
}
export type MembershipService=ReturnType<typeof createMembershipService>;

export function createMembershipTenancyAuthorizer(database:DatabasePool,sessionToken:string,organizationIdInput:unknown,correlationId:string):TenancyAuthorizer {
  const organizationId=validate.uuid(organizationIdInput);
  return {async authorize(action:TenancyAction) {
    return membershipTransaction(database,async tx=>{
      const session=await authenticated(tx,sessionToken);
      if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId)) throw new HttpError('ACTION_FORBIDDEN');
      if(!await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError('ACTION_FORBIDDEN');
      const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
      const allFranchises=memberships.some(value=>value.role==='org_admin') ? await authorityRepository.organizationFranchiseIds(tx,organizationId) : [];
      const permittedFranchiseIds=tenancyScope(action,memberships,allFranchises);
      if(permittedFranchiseIds===null) throw new HttpError('ACTION_FORBIDDEN');
      return {action,actor:{type:'user' as const,id:session.user_id},organizationId,
        permittedFranchiseIds,correlationId};
    });
  }};
}

/** Operation-lifetime entry point for future private queries and export projections.
 * The callback gets no raw executor; live authority and work share one transaction.
 */
export async function withStaffTenantScope<T>(database:DatabasePool,sessionToken:string,organizationIdInput:unknown,
  action:TenancyAction|'operations.export'|'financial.export',work:(scope:import('../security/scope.ts').TenantAccess)=>Promise<T>):Promise<T> {
  const organizationId=validate.uuid(organizationIdInput);
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId)) throw new HttpError('ACTION_FORBIDDEN');
    if(!await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError('ACTION_FORBIDDEN');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    let permittedFranchiseIds:string[]|null;
    if(action==='operations.export' || action==='financial.export') {
      // E01 / E03 ceilings; no staff/configuration export is created by this seam.
      permittedFranchiseIds=[...new Set(memberships.filter(value=>value.role==='franchise_admin' ||
        (action==='financial.export' && value.role==='accountant')).flatMap(value=>value.franchiseIds))];
      if(!permittedFranchiseIds.length) throw new HttpError('ACTION_FORBIDDEN');
    } else {
      const allFranchises=memberships.some(value=>value.role==='org_admin') ? await authorityRepository.organizationFranchiseIds(tx,organizationId) : [];
      permittedFranchiseIds=tenancyScope(action,memberships,allFranchises);
      if(permittedFranchiseIds===null) throw new HttpError('ACTION_FORBIDDEN');
    }
    return work(issueTenantAccess(tx,{action,actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds,organizationWide:false,correlationId:randomUUID(),provenance:'membership'}));
  });
}

/** R28 general administrative projection. Finance producers remain with their domains;
 * accountant has no permission for the administrative facts currently stored here. */
export async function withAuditScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,
  correlationId:string,work:(scope:import('../security/scope.ts').TenantAccess,revision:string)=>Promise<T>):Promise<T> {
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('ACTION_FORBIDDEN');
    if(!await authorityRepository.lockOrganization(tx,organizationId))throw new HttpError('ACTION_FORBIDDEN');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const authority=managementAuthority(memberships);
    if(!authority)throw new HttpError('ACTION_FORBIDDEN');
    const scope=issueTenantAccess(tx,{action:'audit.read',actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds:authority.franchiseIds,organizationWide:authority.organizationWide,correlationId,provenance:'membership'});
    return work(scope,JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds])));
  });
}

export function createMembershipService(database:DatabasePool) {
  return {...createMembershipCore(database),withCorrelation:(id:string)=>createMembershipCore(database,id)};
}
