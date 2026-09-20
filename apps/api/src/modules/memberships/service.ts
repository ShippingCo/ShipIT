import { active as bookingActive } from '../bookings/repository.ts';
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
import { canManageGrant, managementAuthority, tenancyScope, customerScope, pricingScope, taxScope, shipmentReadScope, parcelCommandScope, lotScope, routeScope, paymentScope, receiptScope, type ManagementAuthority } from './policy.ts';
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
          if(error.constraint==='lot_memberships_one_active_idx') domainError=new HttpError('LOT_MEMBERSHIP_CONFLICT');
          if(error.constraint==='lots_active_code_idx') domainError=new HttpError('LOT_CODE_CONFLICT');
          if(error.constraint==='memberships_one_active_role_idx') domainError=new HttpError('MEMBERSHIP_CONFLICT');
          if(error.constraint==='invitations_one_pending_role_idx') domainError=new HttpError('INVITATION_CONFLICT');
        }
        if(error instanceof DatabaseError&&error.code==='DB_QUERY_FAILED'){
          if(error.sqlState==='23505'&&['route_manifest_dispatch_once_idx','route_lots_active_idx','route_parcels_active_idx'].includes(error.constraint??''))domainError=new HttpError('ROUTE_MANIFEST_CONFLICT');
          if(error.sqlState==='23514'&&error.constraint==='lot_active_route_guard')domainError=new HttpError('LOT_ACTIVE_ROUTE');
        }
        throw domainError??error;
      }
    });
  } catch(error) {
    if(domainError && error instanceof DatabaseError && error.code==='DB_TRANSACTION_FAILED') throw domainError;
    throw new HttpError('TEMPORARILY_UNAVAILABLE');
  }
}

/** R18 sanitized operations and W44 controlled redrive; no org-admin write inheritance. */
export async function withOutboxScope<T>(database:DatabasePool,token:string,organizationId:string,franchiseId:string,
  action:'outbox.read'|'outbox.redrive',correlationId:string,
  work:(scope:import('../security/scope.ts').TenantAccess,revision:string)=>Promise<T>):Promise<T> {
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,token);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
    const parent=await authorityRepository.lockOrganization(tx,organizationId);
    if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const orgAdmin=memberships.some(m=>m.role==='org_admin');
    const all=orgAdmin?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
    const local=memberships.filter(m=>m.franchiseIds.includes(franchiseId));
    if(!all.includes(franchiseId)&&!local.length)throw new HttpError('RESOURCE_NOT_FOUND');
    if(!local.some(m=>m.role==='franchise_admin')&&!(action==='outbox.read'&&orgAdmin))throw new HttpError('ACTION_FORBIDDEN');
    if(action==='outbox.redrive'&&parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
    const access=issueTenantAccess(tx,{action,actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds:[franchiseId],organizationWide:false,correlationId,provenance:'membership'});
    return work(access,JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds])));
  });
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
  action:TenancyAction|'operations.export'|'financial.export'|import('../customers/types.ts').CustomerAction|import('../pricing/types.ts').PricingAction,
  work:(scope:import('../security/scope.ts').TenantAccess,revision:string)=>Promise<T>,
  selection?:{franchiseId:string;correlationId:string;object:boolean}):Promise<T> {
  const organizationId=validate.uuid(organizationIdInput);
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId)) throw new HttpError(selection?.object ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN');
    if(!await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError(selection?.object ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    let permittedFranchiseIds:string[]|null;
    if (action.startsWith('pricing.')) {
      const all=memberships.some(m=>m.role==='org_admin') ? await authorityRepository.organizationFranchiseIds(tx,organizationId) : [];
      permittedFranchiseIds=pricingScope(action as import('../pricing/types.ts').PricingAction,memberships,all);
      if(!permittedFranchiseIds.length)throw new HttpError(selection?.object?'RESOURCE_NOT_FOUND':'ACTION_FORBIDDEN');
      if(!selection||!permittedFranchiseIds.includes(selection.franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');
      permittedFranchiseIds=[selection.franchiseId];
      // The effective approval action comes only from current W43 membership, never browser claims.
      if((action==='pricing.override'||action==='pricing.validate')&&pricingScope('pricing.override.approve',memberships,[]).includes(selection.franchiseId))action='pricing.override.approve';
    } else if (action==='customer.read'||action==='customer.list'||action==='customer.create'||action==='customer.update') {
      permittedFranchiseIds=customerScope(memberships);
      if(!permittedFranchiseIds.length) throw new HttpError(selection?.object ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN');
      if(!selection || !permittedFranchiseIds.includes(selection.franchiseId)) throw new HttpError('RESOURCE_NOT_FOUND');
      permittedFranchiseIds=[selection.franchiseId];
    } else if(action==='operations.export' || action==='financial.export') {
      // E01 / E03 ceilings; no staff/configuration export is created by this seam.
      permittedFranchiseIds=[...new Set(memberships.filter(value=>value.role==='franchise_admin' ||
        (action==='financial.export' && value.role==='accountant')).flatMap(value=>value.franchiseIds))];
      if(!permittedFranchiseIds.length) throw new HttpError(selection?.object ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN');
    } else {
      const allFranchises=memberships.some(value=>value.role==='org_admin') ? await authorityRepository.organizationFranchiseIds(tx,organizationId) : [];
      permittedFranchiseIds=tenancyScope(action as TenancyAction,memberships,allFranchises);
      if(permittedFranchiseIds===null) throw new HttpError(selection?.object ? 'RESOURCE_NOT_FOUND' : 'ACTION_FORBIDDEN');
    }
    return work(issueTenantAccess(tx,{action,actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds,organizationWide:false,correlationId:selection?.correlationId??randomUUID(),provenance:'membership'}),
      JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds])));
  });
}

/** R28: accountants receive only financial facts within their explicit franchises. */
export async function withAuditScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,
  correlationId:string,work:(scope:import('../security/scope.ts').TenantAccess,revision:string,administrativeFranchises:readonly string[])=>Promise<T>):Promise<T> {
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('ACTION_FORBIDDEN');
    if(!await authorityRepository.lockOrganization(tx,organizationId))throw new HttpError('ACTION_FORBIDDEN');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const authority=managementAuthority(memberships);
    const finance=memberships.filter(m=>m.role==='accountant').flatMap(m=>m.franchiseIds);
    if(!authority&&!finance.length)throw new HttpError('ACTION_FORBIDDEN');
    const scope=issueTenantAccess(tx,{action:'audit.read',actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds:[...new Set([...(authority?.franchiseIds??[]),...finance])].sort(),organizationWide:authority?.organizationWide??false,correlationId,provenance:'membership'});
    return work(scope,JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds])),authority?.franchiseIds??[]);
  });
}

/** Domain-specific coordinator: independent capabilities, one authenticated and locked transaction.
 * No executor or capability issuer escapes to the tax/booking consumer.
 */
export async function withTaxTenantScope<T>(database: DatabasePool, sessionToken: string, organizationId: string,
  franchiseId: string, action: import('../tax/types.ts').TaxAction, correlationId: string,
  work: (scopes: { tax: import('../security/scope.ts').TenantAccess; pricing: import('../security/scope.ts').TenantAccess|null }) => Promise<T>): Promise<T> {
  validate.uuid(organizationId); validate.uuid(franchiseId);
  return membershipTransaction(database, async tx => {
    const session = await authenticated(tx,sessionToken);
    if (!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId) ||
      !await authorityRepository.lockOrganization(tx,organizationId)) throw new HttpError('RESOURCE_NOT_FOUND');
    const memberships = await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const all = action === 'tax.read' && memberships.some(m => m.role === 'org_admin') ? await authorityRepository.organizationFranchiseIds(tx,organizationId) : [];
    const permitted = taxScope(action,memberships,all);
    if (!permitted.length) throw new HttpError('ACTION_FORBIDDEN');
    if (!permitted.includes(franchiseId)) throw new HttpError('RESOURCE_NOT_FOUND');
    const context = { actor: { type: 'user' as const,id: session.user_id }, organizationId, permittedFranchiseIds: [franchiseId],
      organizationWide: false, correlationId, provenance: 'membership' as const };
    const tax = issueTenantAccess(tx,{ ...context,action });
    let pricing: import('../security/scope.ts').TenantAccess|null = null;
    if (['tax.prepare','tax.calculate','tax.validate'].includes(action)) {
      if (!pricingScope('pricing.validate',memberships,[]).includes(franchiseId)) throw new HttpError('ACTION_FORBIDDEN');
      pricing = issueTenantAccess(tx,{ ...context,action: pricingScope('pricing.override.approve',memberships,[]).includes(franchiseId) ? 'pricing.override.approve' : 'pricing.validate' });
    }
    return work({ tax,pricing });
  });
}

export function createMembershipService(database:DatabasePool) {
  return {...createMembershipCore(database),withCorrelation:(id:string)=>createMembershipCore(database,id)};
}

/** Issue 22's narrower activation: only a live operator in the selected franchise.
 * Every capability is independent and expires with this transaction. */
export async function withBookingTenantScope<T>(database: DatabasePool, sessionToken: string, organizationId: string,
  franchiseId: string, correlationId: string, work: (s: import('../bookings/types.ts').BookingScopes) => Promise<T>): Promise<T> {
  validate.uuid(organizationId); validate.uuid(franchiseId);
  return membershipTransaction(database,async tx => {
    const session = await authenticated(tx,sessionToken);
    if (!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId)) throw new HttpError('RESOURCE_NOT_FOUND');
    const parent = await authorityRepository.lockOrganization(tx,organizationId);
    if (!parent) throw new HttpError('RESOURCE_NOT_FOUND');
    const memberships = await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const operators = memberships.filter(m => m.role === 'operator');
    if (!operators.length) throw new HttpError('ACTION_FORBIDDEN');
    if (!operators.some(m => m.franchiseIds.includes(franchiseId))) throw new HttpError('RESOURCE_NOT_FOUND');
    if (parent.lifecycle !== 'active') throw new HttpError('ORGANIZATION_DISABLED');
    const context = { actor:{type:'user' as const,id:session.user_id},organizationId,permittedFranchiseIds:[franchiseId],
      organizationWide:false,correlationId,provenance:'membership' as const };
    const scopes = { bookings:issueTenantAccess(tx,{...context,action:'bookings.create'}),
      parcels:issueTenantAccess(tx,{...context,action:'parcels.create'}),customer:issueTenantAccess(tx,{...context,action:'customer.snapshot.read'}),
      pricing:issueTenantAccess(tx,{...context,action:pricingScope('pricing.override.approve',memberships,[]).includes(franchiseId)?'pricing.override.approve':'pricing.validate'}),tax:issueTenantAccess(tx,{...context,action:'tax.validate'}),
      audit:issueTenantAccess(tx,{...context,action:'bookings.audit'}),events:issueTenantAccess(tx,{...context,action:'bookings.events'}) };
    await bookingActive(scopes.bookings);
    return work(scopes);
  });
}

/** R06/R07 read coordinator. Every request/page resolves live identity, grants and
 * Organization-owned franchise scope before a selector or cursor can reach SQL. */
export async function withShipmentReadScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,
  franchiseId:string|null,action:'bookings.read'|'bookings.list'|'parcels.read'|'parcels.list'|'parcels.timeline',
  correlationId:string,work:(scope:import('../security/scope.ts').TenantAccess,revision:string)=>Promise<T>):Promise<T> {
  validate.uuid(organizationId);if(franchiseId)validate.uuid(franchiseId);
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    const object=action.endsWith('.read')||action==='parcels.timeline';
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError(object?'RESOURCE_NOT_FOUND':'ACTION_FORBIDDEN');
    if(!await authorityRepository.lockOrganization(tx,organizationId))throw new HttpError(object?'RESOURCE_NOT_FOUND':'ACTION_FORBIDDEN');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const all=memberships.some(m=>m.role==='org_admin')?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
    let permitted=shipmentReadScope(action.startsWith('bookings.')?'booking':'parcel',memberships,all);
    if(!permitted.length)throw new HttpError(object?'RESOURCE_NOT_FOUND':'ACTION_FORBIDDEN');
    if(franchiseId){if(!permitted.includes(franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');permitted=[franchiseId];}
    const scope=issueTenantAccess(tx,{action,actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds:permitted,organizationWide:false,correlationId,provenance:'membership'});
    return work(scope,JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds])));
  });
}

/** W07-W09/W12/W14 command boundary. It deliberately issues only owning-franchise F;
 * future custody/assignment services must add C/A authority from durable records. */
export async function withParcelCommandScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,
  franchiseId:string,action:import('../parcels/types.ts').ParcelOperation,correlationId:string,
  work:(scopes:{command:import('../security/scope.ts').TenantAccess;events:import('../security/scope.ts').TenantAccess})=>Promise<T>):Promise<T> {
  validate.uuid(organizationId);validate.uuid(franchiseId);
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
    const parent=await authorityRepository.lockOrganization(tx,organizationId);
    if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const permitted=parcelCommandScope(action,memberships);
    if(!permitted.length)throw new HttpError('ACTION_FORBIDDEN');
    if(!permitted.includes(franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');
    if(parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
    const context={actor:{type:'user' as const,id:session.user_id},organizationId,permittedFranchiseIds:[franchiseId],
      organizationWide:false,correlationId,provenance:'membership' as const};
    return work({command:issueTenantAccess(tx,{...context,action}),events:issueTenantAccess(tx,{...context,action:'parcels.events'})});
  });
}

/** Lot read/command work and current RBAC share one transaction and independent capabilities. */
export async function withLotScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,franchiseId:string,
  action:import('../lots/types.ts').LotOperation|'lots.read'|'lots.list',correlationId:string,
  work:(scopes:import('../lots/types.ts').LotScopes)=>Promise<T>):Promise<T> {
  const reading=action==='lots.read'||action==='lots.list';
  return membershipTransaction(database,async tx=>{
    try {
      const session=await authenticated(tx,sessionToken);
      if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
      const parent=await authorityRepository.lockOrganization(tx,organizationId);
      if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
      const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
      const all=reading&&memberships.some(m=>m.role==='org_admin')?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
      const permitted=lotScope(action,memberships,all);
      if(!permitted.length)throw new HttpError('ACTION_FORBIDDEN');
      if(!permitted.includes(franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');
      if(!reading&&parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
      const context={actor:{type:'user' as const,id:session.user_id},organizationId,permittedFranchiseIds:[franchiseId],
        organizationWide:false,correlationId,provenance:'membership' as const};
      return await work({command:issueTenantAccess(tx,{...context,action}),audit:reading?null:issueTenantAccess(tx,{...context,action:'lots.audit'}),
        events:reading?null:issueTenantAccess(tx,{...context,action:'lots.events'}),
        dispatcher:memberships.some(m=>m.role==='dispatcher'&&m.franchiseIds.includes(franchiseId)),
        revision:JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds]))});
    } catch(error) {
      // Only expose a command retry conflict after membershipTransaction confirms rollback.
      if(!reading&&error instanceof DatabaseError&&error.code==='DB_TIMEOUT')throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
      throw error;
    }
  });
}

/** Route read/command work and current RBAC share one transaction and independent capabilities. */
export async function withRouteScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,franchiseId:string,
  action:import('../routes/types.ts').RouteOperation|import('../routes/event-types.ts').RouteEventOperation|'routes.read'|'routes.list',correlationId:string,
  work:(scopes:import('../routes/types.ts').RouteScopes)=>Promise<T>):Promise<T> {
  const reading=action==='routes.read'||action==='routes.list';
  return membershipTransaction(database,async tx=>{
    try {
      const session=await authenticated(tx,sessionToken);
      if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
      const parent=await authorityRepository.lockOrganization(tx,organizationId);
      if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
      const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
      const all=reading&&memberships.some(m=>m.role==='org_admin')?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
      const permitted=routeScope(action,memberships,all);
      if(!permitted.length)throw new HttpError('ACTION_FORBIDDEN');
      if(!permitted.includes(franchiseId))throw new HttpError('RESOURCE_NOT_FOUND');
      if(!reading&&parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
      const context={actor:{type:'user' as const,id:session.user_id},organizationId,permittedFranchiseIds:[franchiseId],
        organizationWide:false,correlationId,provenance:'membership' as const};
      return await work({command:issueTenantAccess(tx,{...context,action}),audit:reading?null:issueTenantAccess(tx,{...context,action:'routes.audit'}),
        events:reading?null:issueTenantAccess(tx,{...context,action:'routes.events'}),
        transit:action==='routes.departure'&&parcelCommandScope('parcels.transit',memberships).includes(franchiseId)?issueTenantAccess(tx,{...context,action:'parcels.transit'}):null,
        parcelEvents:action==='routes.departure'?issueTenantAccess(tx,{...context,action:'parcels.events'}):null,
        revision:JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds]))});
    } catch(error) {
      // Only expose a command retry conflict after membershipTransaction confirms rollback.
      if(!reading&&error instanceof DatabaseError&&error.code==='DB_TIMEOUT')throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
      throw error;
    }
  });
}

/** Financial commands and R11 reads use live membership and one scoped transaction. */
export async function withPaymentScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,franchiseId:string,
  action:import('../payments/types.ts').PaymentOperation|'payments.read',correlationId:string,
  work:(scopes:import('../payments/types.ts').PaymentScopes)=>Promise<T>):Promise<T> {
  const reading=action==='payments.read';
  return membershipTransaction(database,async tx=>{
    try {
      const session=await authenticated(tx,sessionToken);
      if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
      const parent=await authorityRepository.lockOrganization(tx,organizationId);
      if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
      const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
      const all=memberships.some(m=>m.role==='org_admin')?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
      // Check membership scope before role so guessed foreign selectors remain 404.
      if(!all.includes(franchiseId)&&!memberships.some(m=>m.franchiseIds.includes(franchiseId)))throw new HttpError('RESOURCE_NOT_FOUND');
      if(!paymentScope(action,memberships,all).includes(franchiseId))throw new HttpError('ACTION_FORBIDDEN');
      if(!reading&&parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
      const context={actor:{type:'user' as const,id:session.user_id},organizationId,permittedFranchiseIds:[franchiseId],
        organizationWide:false,correlationId,provenance:'membership' as const};
      return await work({command:issueTenantAccess(tx,{...context,action}),audit:reading?null:issueTenantAccess(tx,{...context,action:'payments.audit'}),
        events:reading?null:issueTenantAccess(tx,{...context,action:'payments.events'})});
    } catch(error) {
      if(!reading&&error instanceof DatabaseError&&error.code==='DB_TIMEOUT')throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
      throw error;
    }
  });
}

/** R13 retrieval owns only canonical materialization and a minimum immutable payment entry. */
export async function withReceiptScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,franchiseId:string,
  correlationId:string,work:(scopes:import('../receipts/types.ts').ReceiptScopes)=>Promise<T>):Promise<T> {
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
    if(!await authorityRepository.lockOrganization(tx,organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const all=memberships.some(m=>m.role==='org_admin')?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
    if(!all.includes(franchiseId)&&!memberships.some(m=>m.franchiseIds.includes(franchiseId)))throw new HttpError('RESOURCE_NOT_FOUND');
    if(!receiptScope(memberships,all).includes(franchiseId))throw new HttpError('ACTION_FORBIDDEN');
    const context={actor:{type:'user' as const,id:session.user_id},organizationId,permittedFranchiseIds:[franchiseId],
      organizationWide:false,correlationId,provenance:'membership' as const};
    return work({read:issueTenantAccess(tx,{...context,action:'receipts.read'}),
      materialize:issueTenantAccess(tx,{...context,action:'receipts.materialize'}),payment:issueTenantAccess(tx,{...context,action:'payments.receipt.read'})});
  });
}

/** R14/W22: explicit independent grants; assigned proof never implies Booking access. */
export async function withAttachmentScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,franchiseId:string,
  action:'attachments.read'|'attachments.write'|'attachments.download',correlationId:string,
  work:(scope:import('../attachments/types.ts').AttachmentScope)=>Promise<T>):Promise<T> {
  return membershipTransaction(database,async tx=>{
    const session=await authenticated(tx,sessionToken);
    if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
    const parent=await authorityRepository.lockOrganization(tx,organizationId);
    if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
    const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
    const organizationAdmin=memberships.some(m=>m.role==='org_admin');
    const all=organizationAdmin?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
    const local=memberships.filter(m=>m.franchiseIds.includes(franchiseId));
    if(!all.includes(franchiseId)&&!local.length)throw new HttpError('RESOURCE_NOT_FOUND');
    const staff=local.some(m=>(action==='attachments.write'?['franchise_admin','operator']:['franchise_admin','operator','dispatcher']).includes(m.role));
    const agent=local.some(m=>m.role==='delivery_agent');
    const metadata=action==='attachments.read'&&organizationAdmin;
    if(!staff&&!agent&&!metadata)throw new HttpError('ACTION_FORBIDDEN');
    if(action!=='attachments.read'&&parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
    return work({access:issueTenantAccess(tx,{action,actor:{type:'user',id:session.user_id},organizationId,
      permittedFranchiseIds:[franchiseId],organizationWide:false,correlationId,provenance:'membership'}),
      agentOnly:!staff&&!metadata,metadataOnly:metadata&&!staff&&!agent});
  });
}

/** R15/W23: one selected owner chain, no operational role inheritance. */
export async function withEwayScope<T>(database:DatabasePool,sessionToken:string,organizationId:string,franchiseId:string,
  action:import('../eway/types.ts').EwayAction,correlationId:string,
  work:(scope:import('../eway/types.ts').EwayScope)=>Promise<T>):Promise<T> {
  return membershipTransaction(database,async tx=>{
    try {
      const session=await authenticated(tx,sessionToken);
      if(!(await authorityRepository.userOrganizationIds(tx,session.user_id)).includes(organizationId))throw new HttpError('RESOURCE_NOT_FOUND');
      const parent=await authorityRepository.lockOrganization(tx,organizationId);if(!parent)throw new HttpError('RESOURCE_NOT_FOUND');
      const memberships=await authorityRepository.activeMemberships(tx,session.user_id,organizationId);
      const organizationAdmin=memberships.some(m=>m.role==='org_admin');
      const all=organizationAdmin?await authorityRepository.organizationFranchiseIds(tx,organizationId):[];
      const local=memberships.filter(m=>m.franchiseIds.includes(franchiseId));
      if(!all.includes(franchiseId)&&!local.length)throw new HttpError('RESOURCE_NOT_FOUND');
      const operational=local.some(m=>(action==='eway.write'?['franchise_admin','operator']:['franchise_admin','operator','dispatcher']).includes(m.role));
      const orgRead=action==='eway.read'&&organizationAdmin,finance=action==='eway.read'&&local.some(m=>m.role==='accountant');
      if(!operational&&!orgRead&&!finance)throw new HttpError('ACTION_FORBIDDEN');
      if(action==='eway.write'&&parent.lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
      return await work({access:issueTenantAccess(tx,{action,actor:{type:'user',id:session.user_id},organizationId,
        permittedFranchiseIds:[franchiseId],organizationWide:false,correlationId,provenance:'membership'}),
        accountantOnly:finance&&!operational&&!orgRead,revision:JSON.stringify(memberships.map(m=>[m.id,m.version,m.role,m.franchiseIds]))});
    }catch(error){
      if(action==='eway.write'&&error instanceof DatabaseError&&error.code==='DB_TIMEOUT')throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
      throw error;
    }
  });
}
