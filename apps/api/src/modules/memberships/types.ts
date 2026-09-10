import { utcInstant } from '../tenancy/types.ts';

export const roles = ['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'] as const;
export type Role = typeof roles[number];
export type MembershipLifecycle = 'active' | 'revoked';
export type InvitationState = 'pending' | 'accepted' | 'revoked';

export interface Membership {
  id: string; userId: string; organizationId: string; role: Role;
  lifecycle: MembershipLifecycle; version: number; franchiseIds: string[];
  createdAt: Date; updatedAt: Date; revokedAt: Date | null;
}
export interface Invitation {
  id: string; inviteeUserId: string; organizationId: string; role: Role;
  state: InvitationState; version: number; franchiseIds: string[];
  expiresAt: Date; createdByUserId: string; createdAt: Date; updatedAt: Date;
  acceptedAt: Date | null; revokedAt: Date | null;
}
export function membershipDto(value: Membership) {
  return { id:value.id,user_id:value.userId,organization_id:value.organizationId,role:value.role,
    lifecycle:value.lifecycle,version:value.version,franchise_ids:[...value.franchiseIds],
    created_at:utcInstant(value.createdAt),updated_at:utcInstant(value.updatedAt),
    revoked_at:value.revokedAt ? utcInstant(value.revokedAt) : null };
}
export function invitationDto(value: Invitation, now = new Date()) {
  const state = value.state === 'pending' && value.expiresAt <= now ? 'expired' : value.state;
  return { id:value.id,invitee_user_id:value.inviteeUserId,organization_id:value.organizationId,
    role:value.role,state,version:value.version,franchise_ids:[...value.franchiseIds],
    expires_at:utcInstant(value.expiresAt),created_at:utcInstant(value.createdAt),
    updated_at:utcInstant(value.updatedAt),accepted_at:value.acceptedAt ? utcInstant(value.acceptedAt) : null,
    revoked_at:value.revokedAt ? utcInstant(value.revokedAt) : null };
}
