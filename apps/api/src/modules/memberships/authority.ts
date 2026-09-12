import { assertActiveTransaction, type QueryExecutor, type TransactionExecutor } from '@shippingco/db';
import type { Invitation, InvitationState, Membership, MembershipLifecycle, Role } from './types.ts';
import { assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';

// Organization-wide occupancy is a conflict fact, never permission to load the
// conflicting grant. Only the authorized membership service may call this module.
export async function activeRoleExists(tx:TransactionExecutor,scope:TenantAccess,userId:string,role:Role,exceptId?:string) {
  const context=assertTenantAccess(scope,['memberships.manage','invitations.accept']);
  assertActiveTransaction(tx);
  if(context.action==='invitations.accept' && (userId!==context.actor.id || exceptId)) throw new HttpError('ACTION_FORBIDDEN');
  return (await tx.query<{occupied:boolean}>(`SELECT EXISTS (SELECT 1 FROM shipit.memberships
    WHERE organization_id=$1 AND user_id=$2 AND role=$3 AND lifecycle='active'
    AND ($4::uuid IS NULL OR id<>$4)) AS occupied`,[context.organizationId,userId,role,exceptId??null])).rows[0]!.occupied;
}
export async function pendingInvitationExists(tx:TransactionExecutor,scope:TenantAccess,userId:string,role:Role) {
  const context=assertTenantAccess(scope,['memberships.manage']);
  assertActiveTransaction(tx);
  return (await tx.query<{occupied:boolean}>(`SELECT EXISTS (SELECT 1 FROM shipit.membership_invitations
    WHERE organization_id=$1 AND invitee_user_id=$2 AND role=$3 AND state='pending') AS occupied`,
  [context.organizationId,userId,role])).rows[0]!.occupied;
}

interface MembershipRow {
  id:string;user_id:string;organization_id:string;role:Role;lifecycle:MembershipLifecycle;version:number;
  created_at:Date;updated_at:Date;revoked_at:Date|null;franchise_ids:string[];
}
interface InvitationRow {
  id:string;invitee_user_id:string;organization_id:string;role:Role;state:InvitationState;version:number;
  expires_at:Date;created_by_user_id:string;created_at:Date;updated_at:Date;
  accepted_at:Date|null;revoked_at:Date|null;franchise_ids:string[];
}
const membershipColumns=`m.id,m.user_id,m.organization_id,m.role,m.lifecycle,m.version,m.created_at,m.updated_at,m.revoked_at,
  COALESCE(array_agg(s.franchise_id ORDER BY s.franchise_id) FILTER (WHERE s.franchise_id IS NOT NULL),'{}') AS franchise_ids`;
const invitationColumns=`i.id,i.invitee_user_id,i.organization_id,i.role,i.state,i.version,i.expires_at,i.created_by_user_id,
  i.created_at,i.updated_at,i.accepted_at,i.revoked_at,
  COALESCE(array_agg(s.franchise_id ORDER BY s.franchise_id) FILTER (WHERE s.franchise_id IS NOT NULL),'{}') AS franchise_ids`;
const membershipGroup='m.id';
const invitationGroup='i.id';
function membership(row:MembershipRow):Membership {
  return {id:row.id,userId:row.user_id,organizationId:row.organization_id,role:row.role,lifecycle:row.lifecycle,
    version:row.version,franchiseIds:row.franchise_ids,createdAt:row.created_at,updatedAt:row.updated_at,revokedAt:row.revoked_at};
}
function invitation(row:InvitationRow):Invitation {
  return {id:row.id,inviteeUserId:row.invitee_user_id,organizationId:row.organization_id,role:row.role,state:row.state,
    version:row.version,franchiseIds:row.franchise_ids,expiresAt:row.expires_at,createdByUserId:row.created_by_user_id,
    createdAt:row.created_at,updatedAt:row.updated_at,acceptedAt:row.accepted_at,revokedAt:row.revoked_at};
}
export async function activeMemberships(db:QueryExecutor,userId:string,organizationId:string) {
  const result=await db.query<MembershipRow>(`SELECT ${membershipColumns} FROM shipit.memberships m
    LEFT JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id AND s.organization_id=m.organization_id
    WHERE m.user_id=$1 AND m.organization_id=$2 AND m.lifecycle='active' GROUP BY ${membershipGroup} ORDER BY m.id`,[userId,organizationId]);
  return result.rows.map(membership);
}
export async function organizationFranchiseIds(db:QueryExecutor,organizationId:string) {
  return (await db.query<{id:string}>('SELECT id FROM shipit.franchises WHERE organization_id=$1 ORDER BY id',[organizationId])).rows.map(row=>row.id);
}
export async function lockOrganization(tx:TransactionExecutor,organizationId:string) {
  assertActiveTransaction(tx);
  return (await tx.query<{id:string;lifecycle:string}>('SELECT id,lifecycle FROM shipit.organizations WHERE id=$1 FOR UPDATE',[organizationId])).rows[0];
}
export async function activeUser(tx:TransactionExecutor,userId:string,lock=false) {
  assertActiveTransaction(tx);
  return (await tx.query<{id:string}>(`SELECT id FROM shipit.auth_users WHERE id=$1 AND lifecycle='active' ${lock?'FOR SHARE':''}`,[userId])).rows[0];
}
export async function invitationOrganization(db:QueryExecutor,tokenHash:string,userId:string) {
  return (await db.query<{organization_id:string}>(`SELECT organization_id FROM shipit.membership_invitations
    WHERE token_hash=$1 AND invitee_user_id=$2 AND state='pending' AND expires_at>clock_timestamp()`,[tokenHash,userId])).rows[0]?.organization_id;
}
export async function findInvitationByToken(tx:TransactionExecutor,organizationId:string,tokenHash:string,userId:string) {
  assertActiveTransaction(tx);
  const locked=await tx.query<{id:string}>('SELECT id FROM shipit.membership_invitations WHERE organization_id=$1 AND token_hash=$2 AND invitee_user_id=$3 FOR UPDATE',[organizationId,tokenHash,userId]);
  if (!locked.rows[0]) return undefined;
  const result=await tx.query<InvitationRow>(`SELECT ${invitationColumns} FROM shipit.membership_invitations i
    LEFT JOIN shipit.invitation_franchise_scopes s ON s.invitation_id=i.id AND s.organization_id=i.organization_id
    WHERE i.organization_id=$1 AND i.id=$2 GROUP BY ${invitationGroup}`,[organizationId,locked.rows[0].id]);
  return result.rows[0] ? invitation(result.rows[0]) : undefined;
}
export async function userOrganizationIds(db:QueryExecutor,userId:string) {
  return (await db.query<{organization_id:string}>(`SELECT DISTINCT organization_id FROM shipit.memberships
    WHERE user_id=$1 AND lifecycle='active' ORDER BY organization_id`,[userId])).rows.map(row=>row.organization_id);
}

// Pre-tenant identity discovery for the onboarding coordinator, never a raw-key lookup.
export async function onboardingHistory(tx: TransactionExecutor, userId: string) {
  assertActiveTransaction(tx);
  return (await tx.query<{ request_key: string; fingerprint: string; organization_id: string;
    franchise_id: string; membership_id: string; result: import('@shippingco/shared').OnboardingResult }>(
    'SELECT request_key,fingerprint,organization_id,franchise_id,membership_id,result FROM shipit.onboarding_commands WHERE user_id=$1', [userId])).rows[0];
}
export async function hasMembershipHistory(tx: TransactionExecutor, userId: string) {
  assertActiveTransaction(tx);
  return (await tx.query<{ present: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM shipit.memberships WHERE user_id=$1) AS present', [userId])).rows[0]!.present;
}
export async function saveOnboarding(tx: TransactionExecutor, userId: string, key: string, fingerprint: string,
  membershipId: string, result: import('@shippingco/shared').OnboardingResult) {
  assertActiveTransaction(tx);
  await tx.query(`INSERT INTO shipit.onboarding_commands
    (user_id,command_id,operation_id,request_key,fingerprint,normalization_version,organization_id,franchise_id,membership_id,result)
    VALUES ($1,$2,'api.v1.onboarding.create',$3,$4,1,$5,$6,$7,$8)`,
  [userId, result.command_id, key, fingerprint, result.organization.id, result.franchise.id, membershipId, result]);
}
