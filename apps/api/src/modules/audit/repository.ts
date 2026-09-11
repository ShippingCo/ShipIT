import { randomUUID } from 'node:crypto';
import type { Role } from '../memberships/types.ts';
import { HttpError } from '../../plugins/errors.ts';
import { assertTenantAccess, assertFranchises, assertOrganization, scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { TenancyAuditFact } from '../tenancy/types.ts';
import type { AuditBoundary, AuditFilter, AuditRow } from './types.ts';

export async function appendTenancy(scope:TenantAccess,fact:Readonly<TenancyAuditFact>) {
  const c=assertTenantAccess(scope,['organization.bootstrap','franchise.create','organization.profile.update',
    'organization.lifecycle.manage','franchise.profile.update','franchise.lifecycle.manage']);
  assertOrganization(scope,fact.organization_id);
  if(fact.franchise_id) assertFranchises(scope,[fact.franchise_id]);
  await scopedQuery(scope,['organization.bootstrap','franchise.create','organization.profile.update',
    'organization.lifecycle.manage','franchise.profile.update','franchise.lifecycle.manage'],
  `SELECT shipit.append_tenancy_audit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) WHERE {{organization:$1}}`,
  [c.organizationId,fact.franchise_id,c.actor.type,c.actor.id,c.action,fact.franchise_id?'franchise':'organization',
    fact.franchise_id??c.organizationId,fact.reason_code,c.correlationId,fact.occurred_at,
    fact.previous_lifecycle,fact.new_lifecycle,fact.committed_version]);
}

export async function list(scope:TenantAccess,filter:AuditFilter,boundary:AuditBoundary|null) {
  assertTenantAccess(scope,['audit.read']);
  // All current facts are administrative/identity. The financial projection has
  // no producers yet; accountant authority never becomes general audit authority.
  return (await scopedQuery<AuditRow>(scope,['audit.read'],`SELECT a.id,a.organization_id,a.franchise_ids,
    a.actor_type,a.actor_id,a.action,a.resource_type,a.resource_id,a.result,a.reason_code,a.correlation_id,
    to_char(a.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
    a.previous_lifecycle,a.new_lifecycle,a.committed_version,a.role
    FROM shipit.audit_history a WHERE {{organization:a.organization_id}}
      AND ({{organizationWide}}::boolean OR (cardinality(a.franchise_ids)>0 AND a.franchise_ids <@ {{franchises}}::uuid[]))
      AND ($1::uuid IS NULL OR $1=ANY(a.franchise_ids))
      AND ($2::text IS NULL OR a.resource_type=$2) AND ($3::uuid IS NULL OR a.resource_id=$3)
      AND ($4::timestamptz IS NULL OR a.occurred_at >= $4) AND ($5::timestamptz IS NULL OR a.occurred_at < $5)
      AND ($6::timestamptz IS NULL OR (a.occurred_at,a.id COLLATE "C") < ($6,$7::text COLLATE "C"))
    ORDER BY a.occurred_at DESC,a.id COLLATE "C" DESC LIMIT $8`,
  [filter.franchiseId,filter.resourceType,filter.resourceId,filter.from,filter.to,boundary?.time??null,boundary?.id??null,filter.limit+1])).rows;
}

export async function appendMembership(tx:TenantAccess,input:{organizationId:string;actorType:'user'|'service';actorUserId:string|null;
  affectedUserId:string;membershipId?:string;invitationId?:string;action:string;role:Role;franchiseIds:readonly string[]}) {
  assertTenantAccess(tx,['memberships.manage','memberships.bootstrap','invitations.accept']);
  assertOrganization(tx,input.organizationId); assertFranchises(tx,input.franchiseIds);
  if(!tx.context.organizationWide && (input.role==='org_admin'||!input.franchiseIds.length))throw new HttpError('RESOURCE_NOT_FOUND');
  await scopedQuery(tx, ['memberships.manage','memberships.bootstrap','invitations.accept'], `INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,actor_user_id,affected_user_id,
    membership_id,invitation_id,action,role,franchise_ids,correlation_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11 WHERE {{organization:$2}}`,
  [randomUUID(),tx.context.organizationId,tx.context.actor.type,tx.context.actor.type==='user'?tx.context.actor.id:null,input.affectedUserId,input.membershipId??null,
    input.invitationId??null,input.action,input.role,input.franchiseIds,tx.context.correlationId]);
}
