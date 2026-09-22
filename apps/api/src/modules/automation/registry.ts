import { createHash } from 'node:crypto';
import type { Event } from '../outbox/types.ts';
import type { AutomationPolicyBinding } from '../whatsapp/types.ts';

export const notificationConsumerId='customer-notifications';
export interface NotificationPolicy {
  id:string;version:number;event:string;aggregate:'booking'|'parcel'|'route';kind:string;affected:'booking'|'parcel';
  variables:readonly string[];notify:boolean;
}
export const notificationPolicies:readonly NotificationPolicy[]=Object.freeze([
  {id:'booking-confirmation',version:1,event:'booking.created',aggregate:'booking',kind:'booking_confirmation',affected:'booking',variables:['booking_id','parcel_count','confirmed_at'],notify:true},
  {id:'parcel-checked-in',version:1,event:'parcel.checked_in',aggregate:'parcel',kind:'parcel_checked_in',affected:'parcel',variables:['docket','occurred_at'],notify:true},
  {id:'parcel-dispatched',version:1,event:'parcel.dispatched',aggregate:'parcel',kind:'parcel_dispatched',affected:'parcel',variables:['docket','occurred_at'],notify:true},
  {id:'parcel-route-overlap',version:1,event:'parcel.in_transit',aggregate:'parcel',kind:'route_departed',affected:'parcel',variables:[],notify:false},
  {id:'route-departed',version:1,event:'route.departed',aggregate:'route',kind:'route_departed',affected:'parcel',variables:['docket','route_id','effective_at','base_eta_at','revised_eta_at'],notify:true},
  {id:'route-delayed',version:1,event:'route.delayed',aggregate:'route',kind:'route_delayed',affected:'parcel',variables:['docket','effective_at','revised_eta_at'],notify:true},
  {id:'route-arrived',version:1,event:'route.arrived',aggregate:'route',kind:'route_arrived',affected:'parcel',variables:['docket','route_id','effective_at'],notify:true},
]);
export const notificationSubscriptions=Object.freeze(Object.fromEntries(notificationPolicies.map(p=>[p.event,Object.freeze([1])])));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function policyFor(event:string){return notificationPolicies.find(p=>p.event===event);}
export function validateNotificationEvent(event:Event) {
  const policy=policyFor(event.event_type);if(!policy||event.schema_version!==1||event.aggregate_type!==policy.aggregate)return false;
  const p=event.payload;if(!record(p))return false;
  if(event.event_type==='booking.created')return exact(p,['parcel_set_ref'])&&typeof p.parcel_set_ref==='string'&&uuid.test(p.parcel_set_ref);
  if(event.event_type==='parcel.checked_in')return exact(p,['receipt_ref','location_ref'])&&[p.receipt_ref,p.location_ref].every(v=>typeof v==='string'&&uuid.test(v));
  if(event.event_type==='parcel.dispatched')return exact(p,['manifest_id','dispatch_evidence_ref'])&&[p.manifest_id,p.dispatch_evidence_ref].every(v=>typeof v==='string'&&uuid.test(v));
  if(event.event_type==='parcel.in_transit')return exact(p,['route_id','movement_evidence_ref'])&&[p.route_id,p.movement_evidence_ref].every(v=>typeof v==='string'&&uuid.test(v));
  return exact(p,['manifest_id','affected_set_ref'])&&[p.manifest_id,p.affected_set_ref].every(v=>typeof v==='string'&&uuid.test(v))&&p.affected_set_ref===event.event_id;
}
export function policyBindings(input:readonly AutomationPolicyBinding[]) {
  const result=new Map<string,AutomationPolicyBinding>();
  for(const binding of input) {
    const policy=notificationPolicies.find(p=>p.id===binding.policy_id&&p.version===binding.policy_version&&p.notify);
    if(!policy||binding.variables.length!==new Set(binding.variables).size||binding.variables.some(v=>!policy.variables.includes(v)))throw new Error('NOTIFICATION_POLICY_CONFIGURATION_INVALID');
    const identity=`${policy.id}:${policy.version}`;if(result.has(identity))throw new Error('NOTIFICATION_POLICY_CONFIGURATION_INVALID');
    result.set(identity,binding);
  }
  return result;
}
export interface NotificationPolicyActivation { readonly id:string;readonly version:number;readonly binding_hash:string }
export function policyActivationDocument(input:readonly AutomationPolicyBinding[]):readonly NotificationPolicyActivation[] {
  const bindings=policyBindings(input);
  return Object.freeze(notificationPolicies.map(policy=>{
    const binding=bindings.get(`${policy.id}:${policy.version}`);
    const identity={policy:{id:policy.id,version:policy.version,event:policy.event,aggregate:policy.aggregate,kind:policy.kind,
      affected:policy.affected,variables:[...policy.variables],notify:policy.notify},binding:binding?{template_name:binding.template_name,
      template_language:binding.template_language,variables:[...binding.variables]}:null};
    const binding_hash=createHash('sha256').update('shipit:notification-policy-activation:v1\0').update(JSON.stringify(identity)).digest('hex');
    return Object.freeze({id:policy.id,version:policy.version,binding_hash});
  }));
}
