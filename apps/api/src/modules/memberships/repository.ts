import { randomUUID } from 'node:crypto';
import { assertActiveTransaction, type QueryExecutor, type TransactionExecutor } from '@shippingco/db';
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
export async function activeMemberships(db:QueryExecutor,userId:string,organizationId:string) {
  const result=await db.query<MembershipRow>(`SELECT ${membershipColumns} FROM shipit.memberships m
    LEFT JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id
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
export async function findMembership(tx:TransactionExecutor,organizationId:string,id:string,lock=false) {
  assertActiveTransaction(tx);
  if (lock) {
    const locked=await tx.query('SELECT id FROM shipit.memberships WHERE organization_id=$1 AND id=$2 FOR UPDATE',[organizationId,id]);
    if (!locked.rows[0]) return undefined;
  }
  const result=await tx.query<MembershipRow>(`SELECT ${membershipColumns} FROM shipit.memberships m
    LEFT JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id
    WHERE m.organization_id=$1 AND m.id=$2 GROUP BY ${membershipGroup}`,[organizationId,id]);
  return result.rows[0] ? membership(result.rows[0]) : undefined;
}
export async function membershipOrganization(db:QueryExecutor,id:string) {
  return (await db.query<{organization_id:string}>('SELECT organization_id FROM shipit.memberships WHERE id=$1',[id])).rows[0]?.organization_id;
}
export async function listMemberships(db:QueryExecutor,organizationId:string) {
  const result=await db.query<MembershipRow>(`SELECT ${membershipColumns} FROM shipit.memberships m
    LEFT JOIN shipit.membership_franchise_scopes s ON s.membership_id=m.id
    WHERE m.organization_id=$1 GROUP BY ${membershipGroup} ORDER BY m.created_at,m.id`,[organizationId]);
  return result.rows.map(membership);
}
export async function listInvitations(db:QueryExecutor,organizationId:string) {
  const result=await db.query<InvitationRow>(`SELECT ${invitationColumns} FROM shipit.membership_invitations i
    LEFT JOIN shipit.invitation_franchise_scopes s ON s.invitation_id=i.id
    WHERE i.organization_id=$1 GROUP BY ${invitationGroup} ORDER BY i.created_at,i.id`,[organizationId]);
  return result.rows.map(invitation);
}
export async function findInvitation(tx:TransactionExecutor,organizationId:string,id:string,lock=false) {
  assertActiveTransaction(tx);
  if (lock) {
    const locked=await tx.query('SELECT id FROM shipit.membership_invitations WHERE organization_id=$1 AND id=$2 FOR UPDATE',[organizationId,id]);
    if (!locked.rows[0]) return undefined;
  }
  const result=await tx.query<InvitationRow>(`SELECT ${invitationColumns} FROM shipit.membership_invitations i
    LEFT JOIN shipit.invitation_franchise_scopes s ON s.invitation_id=i.id
    WHERE i.organization_id=$1 AND i.id=$2 GROUP BY ${invitationGroup}`,[organizationId,id]);
  return result.rows[0] ? invitation(result.rows[0]) : undefined;
}
export async function invitationOrganization(db:QueryExecutor,tokenHash:string) {
  return (await db.query<{organization_id:string}>('SELECT organization_id FROM shipit.membership_invitations WHERE token_hash=$1',[tokenHash])).rows[0]?.organization_id;
}
export async function invitationOrganizationById(db:QueryExecutor,id:string) {
  return (await db.query<{organization_id:string}>('SELECT organization_id FROM shipit.membership_invitations WHERE id=$1',[id])).rows[0]?.organization_id;
}
export async function findInvitationByToken(tx:TransactionExecutor,organizationId:string,tokenHash:string) {
  assertActiveTransaction(tx);
  const locked=await tx.query<{id:string}>('SELECT id FROM shipit.membership_invitations WHERE organization_id=$1 AND token_hash=$2 FOR UPDATE',[organizationId,tokenHash]);
  if (!locked.rows[0]) return undefined;
  const result=await tx.query<InvitationRow>(`SELECT ${invitationColumns} FROM shipit.membership_invitations i
    LEFT JOIN shipit.invitation_franchise_scopes s ON s.invitation_id=i.id
    WHERE i.organization_id=$1 AND i.id=$2 GROUP BY ${invitationGroup}`,[organizationId,locked.rows[0].id]);
  return result.rows[0] ? invitation(result.rows[0]) : undefined;
}
export async function validateFranchises(tx:TransactionExecutor,organizationId:string,ids:readonly string[]) {
  if (!ids.length) return true;
  const count=(await tx.query<{count:string}>('SELECT count(*) AS count FROM shipit.franchises WHERE organization_id=$1 AND id=ANY($2::uuid[])',[organizationId,ids])).rows[0]?.count;
  return count===String(ids.length);
}
async function replaceMembershipScopes(tx:TransactionExecutor,id:string,organizationId:string,ids:readonly string[]) {
  await tx.query('DELETE FROM shipit.membership_franchise_scopes WHERE membership_id=$1',[id]);
  if (ids.length) await tx.query(`INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id)
    SELECT $1,$2,value FROM unnest($3::uuid[]) AS value`,[id,organizationId,ids]);
}
export async function insertMembership(tx:TransactionExecutor,input:{userId:string;organizationId:string;role:Role;franchiseIds:readonly string[]}) {
  assertActiveTransaction(tx);const id=randomUUID();
  await tx.query('INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[id,input.userId,input.organizationId,input.role]);
  await replaceMembershipScopes(tx,id,input.organizationId,input.franchiseIds);
  return (await findMembership(tx,input.organizationId,id))!;
}
export async function activeRoleExists(tx:TransactionExecutor,userId:string,organizationId:string,role:Role,exceptId?:string) {
  return !!(await tx.query(`SELECT 1 FROM shipit.memberships WHERE user_id=$1 AND organization_id=$2 AND role=$3
    AND lifecycle='active' AND ($4::uuid IS NULL OR id<>$4)`,[userId,organizationId,role,exceptId??null])).rows[0];
}
export async function updateMembership(tx:TransactionExecutor,current:Membership,role:Role,franchiseIds:readonly string[]) {
  const result=await tx.query(`UPDATE shipit.memberships SET role=$3,version=version+1,
    updated_at=date_trunc('milliseconds',clock_timestamp()) WHERE organization_id=$1 AND id=$2 AND version=$4 RETURNING id`,
  [current.organizationId,current.id,role,current.version]);
  if (!result.rows[0]) return undefined;
  await replaceMembershipScopes(tx,current.id,current.organizationId,franchiseIds);
  return findMembership(tx,current.organizationId,current.id);
}
export async function revokeMembership(tx:TransactionExecutor,current:Membership) {
  const result=await tx.query(`UPDATE shipit.memberships SET lifecycle='revoked',revoked_at=date_trunc('milliseconds',clock_timestamp()),
    version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE organization_id=$1 AND id=$2 AND version=$3 AND lifecycle='active' RETURNING id`,[current.organizationId,current.id,current.version]);
  return !!result.rows[0];
}
export async function activeAdminCount(tx:TransactionExecutor,organizationId:string,exceptId?:string) {
  return Number((await tx.query<{count:string}>(`SELECT count(*) AS count FROM shipit.memberships WHERE organization_id=$1
    AND role='org_admin' AND lifecycle='active' AND ($2::uuid IS NULL OR id<>$2)`,[organizationId,exceptId??null])).rows[0]?.count??'0');
}
export async function expiredPendingInvitation(tx:TransactionExecutor,userId:string,organizationId:string,role:Role) {
  const row=(await tx.query<{id:string}>(`SELECT id FROM shipit.membership_invitations WHERE invitee_user_id=$1
    AND organization_id=$2 AND role=$3 AND state='pending' AND expires_at<=clock_timestamp() FOR UPDATE`,
  [userId,organizationId,role])).rows[0];
  return row ? findInvitation(tx,organizationId,row.id) : undefined;
}
export async function pendingInvitationExists(tx:TransactionExecutor,userId:string,organizationId:string,role:Role) {
  return !!(await tx.query(`SELECT 1 FROM shipit.membership_invitations WHERE invitee_user_id=$1 AND organization_id=$2
    AND role=$3 AND state='pending'`,[userId,organizationId,role])).rows[0];
}
export async function insertInvitation(tx:TransactionExecutor,input:{inviteeUserId:string;organizationId:string;role:Role;franchiseIds:readonly string[];tokenHash:string;actorUserId:string}) {
  const id=randomUUID();
  await tx.query(`INSERT INTO shipit.membership_invitations(id,invitee_user_id,organization_id,role,token_hash,expires_at,created_by_user_id)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '7 days',$6)`,[id,input.inviteeUserId,input.organizationId,input.role,input.tokenHash,input.actorUserId]);
  if (input.franchiseIds.length) await tx.query(`INSERT INTO shipit.invitation_franchise_scopes(invitation_id,organization_id,franchise_id)
    SELECT $1,$2,value FROM unnest($3::uuid[]) AS value`,[id,input.organizationId,input.franchiseIds]);
  return (await findInvitation(tx,input.organizationId,id))!;
}
export async function revokeInvitation(tx:TransactionExecutor,current:Invitation) {
  const result=await tx.query(`UPDATE shipit.membership_invitations SET state='revoked',revoked_at=date_trunc('milliseconds',clock_timestamp()),
    version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE organization_id=$1 AND id=$2 AND version=$3 AND state='pending' RETURNING id`,[current.organizationId,current.id,current.version]);
  return !!result.rows[0];
}
export async function acceptInvitation(tx:TransactionExecutor,current:Invitation) {
  const result=await tx.query(`UPDATE shipit.membership_invitations SET state='accepted',accepted_at=date_trunc('milliseconds',clock_timestamp()),
    version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp())
    WHERE organization_id=$1 AND id=$2 AND version=$3 AND state='pending' AND expires_at>clock_timestamp() RETURNING id`,
  [current.organizationId,current.id,current.version]);
  return !!result.rows[0];
}
export async function audit(tx:TransactionExecutor,input:{organizationId:string;actorType:'user'|'service';actorUserId:string|null;
  affectedUserId:string;membershipId?:string;invitationId?:string;action:string;role:Role;franchiseIds:readonly string[]}) {
  await tx.query(`INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,actor_user_id,affected_user_id,
    membership_id,invitation_id,action,role,franchise_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[])`,
  [randomUUID(),input.organizationId,input.actorType,input.actorUserId,input.affectedUserId,input.membershipId??null,
    input.invitationId??null,input.action,input.role,input.franchiseIds]);
}
