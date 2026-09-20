import type { ParcelTransitionDto } from '@shippingco/shared';
import type { CommandIntent } from './command-intent';
import { array, choice, instant, integer, list, object, text, uuid, type Decoder, protocol } from './dto';
import type { ScopedApi } from './scoped-api';

export const parcelStatuses = ['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto'] as const;
export type ParcelStatus = typeof parcelStatuses[number];
export interface ParcelRead {
  id:string; booking_id:string; version:number; status:ParcelStatus; custody:string; docket:string;
  weight_grams:number; confirmed_at:string;
  sender:{source_customer_id:string;source_customer_version:number;name:string;phone:string;phone_display:string;address:string};
  recipient:{name:string;phone_normalized:string;phone_display:string;address:string};
}
export interface ParcelTimelineItem {event_id:string;sequence:number;occurred_at:string;code:string;status:ParcelStatus;label:string}
export interface ParcelListFilter {docket?:string;status?:ParcelStatus;from?:string;to?:string;sort?:'created_at_desc'|'created_at_asc'|'docket_asc'|'docket_desc';limit?:number;cursor?:string|null}
export type ParcelCommand =
  {kind:'check_in';parcelId:string;body:{expected_version:number;evidence_ref:string;location_ref:string}}|
  {kind:'dispatch';parcelId:string;body:{expected_version:number;evidence_ref:string;manifest_id:string}}|
  {kind:'transit';parcelId:string;body:{expected_version:number;evidence_ref:string;route_id:string}}|
  {kind:'failed_attempt';parcelId:string;body:{expected_version:number;evidence_ref:string;attempt_id:string;reason_code:'customer_unavailable'|'customer_requests_pickup'|'address_issue'|'recipient_refusal'|'payment_not_collected'|'operational_issue'|'other_controlled';failure_subreason_code?:'weather_disruption'|'vehicle_breakdown'|'route_access_restricted'|'device_or_network_failure'}}|
  {kind:'rto';parcelId:string;body:{expected_version:number;evidence_ref:string;approval_ref:string;return_plan_ref:string;override_reason_code?:'safety_risk'|'legal_restriction'|'operationally_unserviceable'}};

const party = object({source_customer_id:uuid,source_customer_version:integer(1),name:text,phone:text,phone_display:text,address:text});
const recipient = object({name:text,phone_normalized:text,phone_display:text,address:text});
export const parcelDto:Decoder<ParcelRead> = object({id:uuid,booking_id:uuid,version:integer(1),status:choice(...parcelStatuses),custody:text,
  docket:text,weight_grams:integer(1),confirmed_at:instant,sender:party,recipient});
export const timelineItem:Decoder<ParcelTimelineItem> = object({event_id:uuid,sequence:integer(),occurred_at:instant,code:text,status:choice(...parcelStatuses),label:text});
const transition:Decoder<ParcelTransitionDto> = object({id:uuid,booking_id:uuid,docket:text,version:integer(1),status:choice(...parcelStatuses),
  custody:choice('awaiting_intake','franchise_office','route_dispatch','delivery_agent','recipient'),attempts_started:integer(),failed_attempt_count:integer(),event_id:uuid,transitioned_at:instant});
const transitionTarget:Record<ParcelCommand['kind'],ParcelStatus>={check_in:'checked_in',dispatch:'dispatched',transit:'in_transit',failed_attempt:'failed_attempt',rto:'rto'};
const paths:Record<ParcelCommand['kind'],string>={check_in:'check-in',dispatch:'dispatch',transit:'transit',failed_attempt:'failed-attempt',rto:'rto'};
const operations:Record<ParcelCommand['kind'],string>={check_in:'api.v1.parcels.check_in',dispatch:'api.v1.parcels.dispatch',transit:'api.v1.parcels.transit',failed_attempt:'api.v1.parcels.fail_delivery',rto:'api.v1.parcels.approve_rto'};

export function parcels(api:ScopedApi) {
  return {
    list(filter:ParcelListFilter={},signal?:AbortSignal) {
      const params=new URLSearchParams();
      for(const [key,value] of Object.entries(filter))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
      const path=api.path('/api/v1/parcels')+(params.size?'&'+params:'');
      return api.read(path,list(parcelDto),signal);
    },
    read(id:string,signal?:AbortSignal){return api.read(api.path(`/api/v1/parcels/${uuid(id)}`),parcelDto,signal);},
    timeline(id:string,signal?:AbortSignal){return api.read(api.path(`/api/v1/parcels/${uuid(id)}/timeline`),object({items:array(timelineItem,1000)}),signal);},
    intent(command:ParcelCommand){
      const id=uuid(command.parcelId),expected=integer(1)(command.body.expected_version);
      return api.intent(operations[command.kind],api.path(`/api/v1/parcels/${id}/${paths[command.kind]}`),command.body,'POST',expected);
    },
    execute(intent:CommandIntent){
      const kind=(Object.entries(operations).find(([,operation])=>operation===intent.operation)?.[0]) as ParcelCommand['kind']|undefined;
      if(!kind)return protocol();
      const sent=JSON.parse(intent.bodyJson) as {expected_version:number},id=/\/parcels\/([0-9a-f-]{36})\//.exec(intent.path)?.[1];
      return api.execute(intent,value=>{const result=transition(value);if(!id||result.id!==id||result.version!==sent.expected_version+1||result.status!==transitionTarget[kind])return protocol();return result;},
        ['$','expected_version','evidence_ref','location_ref','manifest_id','route_id','attempt_id','reason_code','failure_subreason_code','approval_ref','return_plan_ref','override_reason_code']);
    },
  };
}
export type ParcelSource=ReturnType<typeof parcels>;
