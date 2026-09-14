import type { RouteDto, RouteManifestDto } from '@shippingco/shared';
import type { TenantAccess } from '../security/scope.ts';
export type { RouteDto, RouteManifestDto, RouteManifestItem } from '@shippingco/shared';
export type RouteOperation='routes.create'|'routes.update'|'routes.archive'|'routes.finalize'|'routes.lot.attach'|'routes.lot.detach'|'routes.parcel.attach'|'routes.parcel.detach';
export type RouteAction=RouteOperation|'routes.read'|'routes.list'|'routes.audit'|'routes.events';
export interface RouteInput { origin?:string; destination?:string; mode?:'road'|'rail'|'air'|'sea'; carrier_code?:string|null; scheduled_departure_at?:string; expected_version?:number; lot_id?:string; parcel_id?:string }
export interface RouteRow extends Omit<RouteDto,'created_at'|'updated_at'|'scheduled_departure_at'> {created_at:Date; updated_at:Date; scheduled_departure_at:Date}
export interface ManifestRow extends Omit<RouteManifestDto,'created_at'> {created_at:Date}
export interface RouteScopes {command:TenantAccess; audit:TenantAccess|null; events:TenantAccess|null; revision:string}
export interface RouteFilter {organizationId:string;franchiseId:string;state:string|null;limit:number;cursor:string|null}
export interface RouteBoundary {value:string;id:string}
export interface SourceRow {id:string;kind:'lot'|'direct';lot_id:string|null;parcel_id:string|null}
export interface Contribution {parcel_id:string;booking_id:string;status:string;booking_state:string;source_id:string;lot_id:string|null;lot_membership_id:string|null}
