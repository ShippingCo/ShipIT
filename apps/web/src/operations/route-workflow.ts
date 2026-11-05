import type {RouteDto,RouteEventInput,RouteEventResult,RouteManifestDto} from '@shippingco/shared';
import type {CommandIntent} from '../data-access/command-intent';
import type {RouteSource,RouteCommand} from '../data-access/routes';
import type {LotSource} from '../data-access/lots';
import type {ParcelSource,ParcelRead} from '../data-access/parcels';
import {ApiFailure} from '../data-access/errors';
export const routeMetadata=(route:RouteDto)=>({origin:route.origin,destination:route.destination,mode:route.mode,carrier_code:route.carrier_code,scheduled_departure_at:route.scheduled_departure_at});
type RouteCreate=Extract<RouteCommand,{kind:'create'}>['body'];
/** Retain one exact request per step; never repeat confirmed effects with fresh keys. */
function steps(){
 let pending:{intent:CommandIntent;send:(intent:CommandIntent)=>Promise<unknown>}|null=null,changed=false;
 return {get changed(){return changed;},async run<T>(prepare:()=>Promise<{intent:CommandIntent;send:(intent:CommandIntent)=>Promise<T>}>):Promise<T>{
  pending??=await prepare();const value=await pending.send(pending.intent);pending=null;changed=true;return value as T;
 }};
}
export function routeAttachmentPlan(input:{source:RouteSource;lots:LotSource;route?:RouteDto;create?:RouteCreate;lotIds:string[];parcelIds:string[];entryIds:string[]}){
 const step=steps();let route=input.route,initialized=false,lotIndex=0,lotPhase=0,parcelIndex=0;
 return {get currentRoute(){return route;},get hasChanges(){return step.changed;},async execute():Promise<RouteDto>{
  if(!initialized){
   if(!route){route=await step.run<RouteDto>(async()=>({intent:input.source.intent({kind:'create',body:{...input.create!,...(input.entryIds.length?{planning_entry_ids:input.entryIds}:{})}}),send:intent=>input.source.execute(intent) as Promise<RouteDto>}));}
   else if(input.entryIds.length){route=await step.run<RouteDto>(async()=>{const current=await input.source.read(route!.id);return {intent:input.source.intent({kind:'update',routeId:current.id,body:{...routeMetadata(current),expected_version:current.version,planning_entry_ids:[...new Set([...(current.planning_entry_ids??[]),...input.entryIds])]}}),send:intent=>input.source.execute(intent) as Promise<RouteDto>};});}
   initialized=true;
  }
  for(;lotIndex<input.lotIds.length;lotIndex++,lotPhase=0){
   const lotId=input.lotIds[lotIndex]!;
   if(lotPhase===0){
    const lot=await input.lots.read(lotId);
    if(lot.active_member_count){route=await step.run<RouteDto>(async()=>{const current=await input.source.read(route!.id);return {intent:input.source.intent({kind:'attach_lot',routeId:current.id,body:{expected_version:current.version,lot_id:lotId}}),send:intent=>input.source.execute(intent) as Promise<RouteDto>};});}
    lotPhase=1;
   }
   if(lotPhase===1){
    await step.run<unknown>(async()=>{const lot=await input.lots.read(lotId);return {intent:input.lots.intent({kind:'update',lotId,body:{expected_version:lot.version,name:lot.name,planning_route_id:route!.id}}),send:intent=>input.lots.execute(intent)};});lotPhase=2;
   }
  }
  for(;parcelIndex<input.parcelIds.length;parcelIndex++)route=await step.run<RouteDto>(async()=>{const current=await input.source.read(route!.id);return {intent:input.source.intent({kind:'attach_parcel',routeId:current.id,body:{expected_version:current.version,parcel_id:input.parcelIds[parcelIndex]!}}),send:intent=>input.source.execute(intent) as Promise<RouteDto>};});
  return route!;
 }};
}
export function routeJourneyPlan(input:{source:RouteSource;parcels:ParcelSource;route:RouteDto;manifest:RouteManifestDto;rows:ParcelRead[];kind:RouteEventInput['kind'];note:string;effectiveAt:string;baseEta:string|null;delayMinutes:number}){
 const step=steps();let route=input.route,manifest=input.manifest,finalized=route.state==='finalized',index=0,eventDone=false,result:RouteDto|RouteEventResult|null=null;
 const evidence=crypto.randomUUID(),planningOnly=manifest.parcel_count===0,planningDelay=input.kind==='delay'&&route.state==='planning';
 return {get hasChanges(){return step.changed;},get currentRoute(){return route;},async execute():Promise<RouteDto|RouteEventResult>{
  if(eventDone)return result!;
  if(planningOnly||planningDelay){
   result=await step.run<RouteDto>(async()=>({intent:input.source.intent({kind:'update',routeId:route.id,body:{...routeMetadata(route),expected_version:route.version,note:input.note,...(input.kind==='delay'?{planning_delay_minutes:input.delayMinutes}:{planning_progress:input.kind==='departure'?'departed':'arrived'})}}),send:intent=>input.source.execute(intent) as Promise<RouteDto>}));route=result;eventDone=true;return result;
  }
  if(input.kind==='departure'){
   if(!finalized){
    if(input.rows.length!==manifest.parcel_count||input.rows.some(p=>p.status!=='checked_in'))throw new ApiFailure('PARCEL_STATE_CONFLICT');
    route=await step.run<RouteDto>(async()=>({intent:input.source.intent({kind:'finalize',routeId:route.id,body:{expected_version:route.version}}),send:intent=>input.source.execute(intent) as Promise<RouteDto>}));finalized=true;
   }
   const current=await input.source.manifest(route.id);manifest=current.manifest;
   for(;index<input.rows.length;index++){
    const row=input.rows[index]!;if(row.status==='dispatched'||row.status==='in_transit'||row.status==='delivered'||row.status==='rto')continue;
    if(row.status!=='checked_in')throw new ApiFailure('PARCEL_STATE_CONFLICT');
    await step.run(async()=>({intent:input.parcels.intent({kind:'dispatch',parcelId:row.id,body:{expected_version:row.version,evidence_ref:evidence,manifest_id:manifest.id}}),send:intent=>input.parcels.execute(intent)}));
   }
  }
  result=await step.run<RouteEventResult>(async()=>({intent:input.source.intent({kind:'event',routeId:route.id,body:{kind:input.kind,expected_version:route.version,manifest_id:manifest.id,manifest_version:manifest.version,effective_at:input.effectiveAt,evidence_ref:evidence,note:input.note,...(input.kind==='departure'?{base_eta_at:input.baseEta}:input.kind==='delay'?{total_delay_minutes:input.delayMinutes}:{})}}),send:intent=>input.source.execute(intent) as Promise<RouteEventResult>}));eventDone=true;return result;
 }};
}
