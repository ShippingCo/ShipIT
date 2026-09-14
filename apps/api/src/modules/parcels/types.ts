import type { ParcelStatus } from '../bookings/types.ts';

export type ParcelAction='parcels.check_in'|'parcels.dispatch'|'parcels.transit'|'parcels.fail_delivery'|'parcels.approve_rto'|'parcels.events';
export type ParcelOperation=Exclude<ParcelAction,'parcels.events'>;
export type FailureReason='customer_unavailable'|'customer_requests_pickup'|'address_issue'|'recipient_refusal'|'payment_not_collected'|'operational_issue'|'other_controlled';
export type FailureSubreason='weather_disruption'|'vehicle_breakdown'|'route_access_restricted'|'device_or_network_failure';
export type RtoOverrideReason='safety_risk'|'legal_restriction'|'operationally_unserviceable';
export type ParcelCustody='awaiting_intake'|'franchise_office'|'route_dispatch'|'delivery_agent'|'recipient';

export interface ParcelCommandInput { expected_version:number; evidence_ref:string; reason_code?:FailureReason; attempt_id?:string;
  failure_subreason_code?:FailureSubreason; manifest_id?:string; route_id?:string; location_ref?:string; approval_ref?:string;
  return_plan_ref?:string; override_reason_code?:RtoOverrideReason }
export interface ParcelLifecycleRow { id:string;booking_id:string;organization_id:string;franchise_id:string;docket:string;version:number;
  status:ParcelStatus;custody:ParcelCustody;attempts_started:number;failed_attempt_count:number;active_attempt_id:string|null;assigned_agent_id:string|null }
export type { ParcelTransitionDto } from '@shippingco/shared';

export const eventFor:Readonly<Record<ParcelOperation,string>>={
  'parcels.check_in':'parcel.checked_in','parcels.dispatch':'parcel.dispatched','parcels.transit':'parcel.in_transit',
  'parcels.fail_delivery':'delivery.attempt_failed','parcels.approve_rto':'parcel.rto_approved',
};
export const targetFor:Readonly<Record<ParcelOperation,ParcelStatus>>={
  'parcels.check_in':'checked_in','parcels.dispatch':'dispatched','parcels.transit':'in_transit',
  'parcels.fail_delivery':'failed_attempt','parcels.approve_rto':'rto',
};
