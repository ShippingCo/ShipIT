import type { LotDto,LotMembershipDto } from '@shippingco/shared';
import type { TenantAccess } from '../security/scope.ts';
export type { LotDto,LotMembershipDto,LotMembershipResult } from '@shippingco/shared';
export type LotOperation='lots.create'|'lots.update'|'lots.archive'|'lots.membership.add'|'lots.membership.move'|'lots.membership.remove';
export type LotAction=LotOperation|'lots.read'|'lots.list'|'lots.audit'|'lots.events';
export interface LotInput { name?:string; destination_key?:string; expected_version?:number; parcel_id?:string;
  membership_id?:string; target_lot_id?:string; expected_target_version?:number }
export interface LotRow extends Omit<LotDto,'created_at'|'updated_at'|'archived_at'> {
  created_at:Date; updated_at:Date; archived_at:Date|null;
}
export interface MembershipRow extends Omit<LotMembershipDto,'started_at'|'ended_at'> {started_at:Date; ended_at:Date|null}
export interface LotScopes { command:TenantAccess; audit:TenantAccess|null; events:TenantAccess|null; dispatcher:boolean; revision:string }
export interface LotFilter {organizationId:string;franchiseId:string;state:string|null;destination:string|null;limit:number;cursor:string|null}
export interface LotBoundary {value:string;id:string}
export interface ParcelReference {id:string;booking_id:string;status:string;destination_key:string}
