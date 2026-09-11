import { HttpError } from '../../plugins/errors.ts';
import { randomUUID } from 'node:crypto';
import { scopedQuery, assertTenantAccess, assertOrganization, assertFranchises, type TenantAccess } from '../security/scope.ts';
import type { Invitation, InvitationState, Membership, MembershipLifecycle, Role } from './types.ts';

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

function assertGrant(scope:TenantAccess,role:Role,franchiseIds:readonly string[]) {
  const context=assertTenantAccess(scope);
  assertFranchises(scope,franchiseIds);
  if(!context.organizationWide && (role==='org_admin' || !franchiseIds.length)) throw new HttpError('RESOURCE_NOT_FOUND');
}

export async function findMembership(tx:TenantAccess,organizationId:string,id:string,lock=false) {
  assertOrganization(tx,organizationId);
  assertTenantAccess(tx);
  if (lock) {
    const locked=await scopedQuery(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], 'SELECT m.id FROM shipit.memberships m WHERE {{membership:m}} AND m.organization_id=$1 AND m.id=$2 FOR UPDATE',[organizationId,id]);
    if (!locked.rows[0]) return undefined;
  }
  const result=await scopedQuery<MembershipRow>(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `SELECT ${membershipColumns} FROM shipit.memberships m
    LEFT JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id AND s.organization_id=m.organization_id AND ({{organizationWide}}::boolean OR s.franchise_id=ANY({{franchises}}::uuid[]))
    WHERE {{membership:m}} AND m.organization_id=$1 AND m.id=$2 GROUP BY ${membershipGroup}`,[organizationId,id]);
  return result.rows[0] ? membership(result.rows[0]) : undefined;
}

export async function listMemberships(db:TenantAccess,organizationId:string) {
  assertOrganization(db,organizationId);
  const result=await scopedQuery<MembershipRow>(db, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `SELECT ${membershipColumns} FROM shipit.memberships m
    LEFT JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id AND s.organization_id=m.organization_id AND ({{organizationWide}}::boolean OR s.franchise_id=ANY({{franchises}}::uuid[]))
    WHERE {{membership:m}} AND m.organization_id=$1 GROUP BY ${membershipGroup} ORDER BY m.created_at,m.id`,[organizationId]);
  return result.rows.map(membership);
}
export async function listInvitations(db:TenantAccess,organizationId:string) {
  assertOrganization(db,organizationId);
  const result=await scopedQuery<InvitationRow>(db, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `SELECT ${invitationColumns} FROM shipit.membership_invitations i
    LEFT JOIN shipit.invitation_franchise_scopes s ON s.invitation_id=i.id AND s.organization_id=i.organization_id AND ({{organizationWide}}::boolean OR s.franchise_id=ANY({{franchises}}::uuid[]))
    WHERE {{invitation:i}} AND i.organization_id=$1 GROUP BY ${invitationGroup} ORDER BY i.created_at,i.id`,[organizationId]);
  return result.rows.map(invitation);
}
export async function findInvitation(tx:TenantAccess,organizationId:string,id:string,lock=false) {
  assertOrganization(tx,organizationId);
  assertTenantAccess(tx);
  if (lock) {
    const locked=await scopedQuery(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], 'SELECT i.id FROM shipit.membership_invitations i WHERE {{invitation:i}} AND i.organization_id=$1 AND i.id=$2 FOR UPDATE',[organizationId,id]);
    if (!locked.rows[0]) return undefined;
  }
  const result=await scopedQuery<InvitationRow>(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `SELECT ${invitationColumns} FROM shipit.membership_invitations i
    LEFT JOIN shipit.invitation_franchise_scopes s ON s.invitation_id=i.id AND s.organization_id=i.organization_id AND ({{organizationWide}}::boolean OR s.franchise_id=ANY({{franchises}}::uuid[]))
    WHERE {{invitation:i}} AND i.organization_id=$1 AND i.id=$2 GROUP BY ${invitationGroup}`,[organizationId,id]);
  return result.rows[0] ? invitation(result.rows[0]) : undefined;
}

export async function validateFranchises(tx:TenantAccess,organizationId:string,ids:readonly string[]) {
  assertOrganization(tx,organizationId); assertFranchises(tx,ids);
  if (!ids.length) return true;
  const count=(await scopedQuery<{count:string}>(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], 'SELECT count(*) AS count FROM shipit.franchises WHERE {{organization:organization_id}} AND organization_id=$1 AND id=ANY($2::uuid[])',[organizationId,ids])).rows[0]?.count;
  return count===String(ids.length);
}
async function replaceMembershipScopes(tx:TenantAccess,id:string,organizationId:string,ids:readonly string[]) {
  assertTenantAccess(tx, ['memberships.manage','memberships.bootstrap','invitations.accept']); assertOrganization(tx,organizationId); assertFranchises(tx,ids);
  await scopedQuery(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], 'DELETE FROM shipit.membership_franchise_scopes WHERE {{organization:organization_id}} AND membership_id=$1 AND EXISTS (SELECT 1 FROM shipit.memberships m WHERE m.id=$1 AND {{membership:m}})',[id]);
  if (ids.length) await scopedQuery(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id)
    SELECT $1,$2,value FROM unnest($3::uuid[]) AS value WHERE {{organization:$2}} AND ({{organizationWide}}::boolean OR value=ANY({{franchises}}::uuid[]))`,[id,organizationId,ids]);
}
export async function insertMembership(tx:TenantAccess,input:{userId:string;organizationId:string;role:Role;franchiseIds:readonly string[]}) {
  assertTenantAccess(tx, ['memberships.manage','memberships.bootstrap','invitations.accept']); assertOrganization(tx,input.organizationId); assertGrant(tx,input.role,input.franchiseIds);
  if(tx.context.action==='invitations.accept' && input.userId!==tx.context.actor.id) throw new HttpError('RESOURCE_NOT_FOUND');
  const id=randomUUID();
  await scopedQuery(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], 'INSERT INTO shipit.memberships(id,user_id,organization_id,role) SELECT $1,$2,$3,$4 WHERE {{organization:$3}}',[id,input.userId,input.organizationId,input.role]);
  await replaceMembershipScopes(tx,id,input.organizationId,input.franchiseIds);
  return (await findMembership(tx,input.organizationId,id))!;
}
export async function updateMembership(tx:TenantAccess,current:Membership,role:Role,franchiseIds:readonly string[]) {
  assertTenantAccess(tx, ['memberships.manage']); assertOrganization(tx,current.organizationId); assertGrant(tx,current.role,current.franchiseIds); assertGrant(tx,role,franchiseIds);
  const result=await scopedQuery(tx, ['memberships.manage'], `UPDATE shipit.memberships m SET role=$3,version=version+1,
    updated_at=date_trunc('milliseconds',clock_timestamp()) WHERE {{membership:m}} AND organization_id=$1 AND id=$2 AND version=$4 RETURNING id`,
  [current.organizationId,current.id,role,current.version]);
  if (!result.rows[0]) return undefined;
  await replaceMembershipScopes(tx,current.id,current.organizationId,franchiseIds);
  return findMembership(tx,current.organizationId,current.id);
}
export async function revokeMembership(tx:TenantAccess,current:Membership) {
  assertTenantAccess(tx, ['memberships.manage']); assertOrganization(tx,current.organizationId); assertGrant(tx,current.role,current.franchiseIds);
  const result=await scopedQuery(tx, ['memberships.manage'], `UPDATE shipit.memberships m SET lifecycle='revoked',revoked_at=date_trunc('milliseconds',clock_timestamp()),
    version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE {{membership:m}} AND organization_id=$1 AND id=$2 AND version=$3 AND lifecycle='active' RETURNING id`,[current.organizationId,current.id,current.version]);
  return !!result.rows[0];
}
export async function activeAdminCount(tx:TenantAccess,organizationId:string,exceptId?:string) {
  if(!assertTenantAccess(tx,['memberships.manage']).organizationWide) throw new HttpError('ACTION_FORBIDDEN');
  assertOrganization(tx,organizationId);
  return Number((await scopedQuery<{count:string}>(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `SELECT count(*) AS count FROM shipit.memberships WHERE {{organization:organization_id}} AND organization_id=$1
    AND role='org_admin' AND lifecycle='active' AND ($2::uuid IS NULL OR id<>$2)`,[organizationId,exceptId??null])).rows[0]?.count??'0');
}
export async function expiredPendingInvitation(tx:TenantAccess,userId:string,organizationId:string,role:Role) {
  assertOrganization(tx,organizationId);
  const row=(await scopedQuery<{id:string}>(tx, ['memberships.read','memberships.manage','memberships.bootstrap','invitations.accept'], `SELECT id FROM shipit.membership_invitations i WHERE {{invitation:i}} AND invitee_user_id=$1
    AND organization_id=$2 AND role=$3 AND state='pending' AND expires_at<=clock_timestamp() FOR UPDATE`,
  [userId,organizationId,role])).rows[0];
  return row ? findInvitation(tx,organizationId,row.id) : undefined;
}
export async function insertInvitation(tx:TenantAccess,input:{inviteeUserId:string;organizationId:string;role:Role;franchiseIds:readonly string[];tokenHash:string;actorUserId:string}) {
  assertTenantAccess(tx, ['memberships.manage']); assertOrganization(tx,input.organizationId); assertGrant(tx,input.role,input.franchiseIds);
  const id=randomUUID();
  await scopedQuery(tx, ['memberships.manage'], `INSERT INTO shipit.membership_invitations(id,invitee_user_id,organization_id,role,token_hash,expires_at,created_by_user_id)
    SELECT $1,$2,$3,$4,$5,clock_timestamp()+interval '7 days',$6 WHERE {{organization:$3}}`,[id,input.inviteeUserId,input.organizationId,input.role,input.tokenHash,tx.context.actor.id]);
  if (input.franchiseIds.length) await scopedQuery(tx, ['memberships.manage'], `INSERT INTO shipit.invitation_franchise_scopes(invitation_id,organization_id,franchise_id)
    SELECT $1,$2,value FROM unnest($3::uuid[]) AS value WHERE {{organization:$2}} AND ({{organizationWide}}::boolean OR value=ANY({{franchises}}::uuid[]))`,[id,input.organizationId,input.franchiseIds]);
  return (await findInvitation(tx,input.organizationId,id))!;
}
export async function revokeInvitation(tx:TenantAccess,current:Invitation) {
  assertTenantAccess(tx, ['memberships.manage']); assertOrganization(tx,current.organizationId); assertGrant(tx,current.role,current.franchiseIds);
  const result=await scopedQuery(tx, ['memberships.manage'], `UPDATE shipit.membership_invitations i SET state='revoked',revoked_at=date_trunc('milliseconds',clock_timestamp()),
    version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE {{invitation:i}} AND organization_id=$1 AND id=$2 AND version=$3 AND state='pending' RETURNING id`,[current.organizationId,current.id,current.version]);
  return !!result.rows[0];
}
export async function acceptInvitation(tx:TenantAccess,current:Invitation) {
  assertTenantAccess(tx, ['invitations.accept']); assertOrganization(tx,current.organizationId); assertGrant(tx,current.role,current.franchiseIds);
  const result=await scopedQuery(tx, ['invitations.accept'], `UPDATE shipit.membership_invitations i SET state='accepted',accepted_at=date_trunc('milliseconds',clock_timestamp()),
    version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE {{invitation:i}} AND organization_id=$1 AND id=$2 AND version=$3 AND state='pending' AND expires_at>clock_timestamp() RETURNING id`,
  [current.organizationId,current.id,current.version]);
  return !!result.rows[0];
}
