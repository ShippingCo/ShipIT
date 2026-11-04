import type {LotDto,LotMembershipResult} from '@shippingco/shared';
import type {LotSource} from '../data-access/lots';
import type {RouteSource} from '../data-access/routes';
import type {CommandIntent} from '../data-access/command-intent';

/** A resumable sequence of existing audited commands. A lost response retries
 * the exact current intent; confirmed steps are never repeated with new keys. */
export function lotPlan(input:{lots:LotSource;routes:RouteSource;lot?:LotDto;attachedRouteId?:string;planningSources?:LotDto[];name:string;destination:string;note:string;entries:string[];parcels:string[];routeId:string}){
 let lot=input.lot,initialized=false,index=0,planningIndex=0,attached=false,detached=false;
 let pending:{source:'lot'|'route';intent:CommandIntent}|null=null;
 async function send(){
  if(!pending)throw new Error('Missing lot plan step');
  const result=pending.source==='lot'?await input.lots.execute(pending.intent):await input.routes.execute(pending.intent);
  pending=null;return result;
 }
 return {get currentLot(){return lot;},async execute():Promise<LotDto>{
  if(input.attachedRouteId&&!detached){
   if(!pending){const route=await input.routes.read(input.attachedRouteId);pending={source:'route',intent:input.routes.intent({kind:'detach_lot',routeId:route.id,lotId:lot!.id,body:{expected_version:route.version}})};}
   await send();detached=true;
  }
  const planningSources=input.planningSources??[];
  for(;planningIndex<planningSources.length;planningIndex++){
   const source=planningSources[planningIndex]!;
   if(!pending){const current=await input.lots.read(source.id);pending={source:'lot',intent:input.lots.intent({kind:'update',lotId:current.id,body:{expected_version:current.version,name:current.name,planning_entry_ids:(current.planning_entry_ids??[]).filter(id=>!input.entries.includes(id))}})};}
   await send();
  }
  if(!initialized){
   pending??={source:'lot',intent:input.lots.intent(lot?{kind:'update',lotId:lot.id,body:{expected_version:lot.version,name:lot.name,note:input.note,...(input.routeId?{planning_route_id:input.routeId}:{}),planning_entry_ids:[...new Set([...(lot.planning_entry_ids??[]),...input.entries])]}}:{kind:'create',body:{name:input.name,destination_key:input.destination,note:input.note,...(input.routeId?{planning_route_id:input.routeId}:{}),planning_entry_ids:input.entries}})};
   lot=await send() as LotDto;initialized=true;
  }
  for(;index<input.parcels.length;index++){
   const parcelId=input.parcels[index]!;
   if(!pending){
    const member=await input.lots.currentMembership(parcelId);
    if(member?.lot_id===lot!.id)continue;
    const target=await input.lots.read(lot!.id);
    if(member){const source=await input.lots.read(member.lot_id);pending={source:'lot',intent:input.lots.intent({kind:'move',lotId:source.id,parcelId,body:{expected_version:source.version,membership_id:member.id,target_lot_id:target.id,expected_target_version:target.version}})};}
    else pending={source:'lot',intent:input.lots.intent({kind:'add',lotId:target.id,body:{expected_version:target.version,parcel_id:parcelId}})};
   }
   const result=await send() as LotMembershipResult;lot=result.lots.find(l=>l.id===lot!.id)!;
  }
  if(input.routeId&&input.parcels.length&&!attached){
   if(!pending){const route=await input.routes.read(input.routeId);pending={source:'route',intent:input.routes.intent({kind:'attach_lot',routeId:route.id,body:{expected_version:route.version,lot_id:lot!.id}})};}
   await send();attached=true;
  }
  return lot!;
 }};
}
