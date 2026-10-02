import { object,uuid,text,nullable,instant,integer,choice,array } from './dto';
import type { ScopedApi } from './scoped-api';
import type { CommandIntent } from './command-intent';
const window=object({start:instant,end:instant});
const fields={id:uuid,state:choice('submitted','accepted','declined','canceled'),version:integer(1),review_reason:nullable(text),requested_window:window,agreed_window:nullable(window)};
const summary=object(fields);
const detail=object({...fields,address:text,contact:nullable(text),assigned_staff_id:nullable(uuid),shipment:object({origin_key:text,destination_key:text,weight_grams:integer(1),dimensions_mm:array(integer(1),3),service:text}),
 notification:nullable(object({id:uuid,state:text,reason_code:text,version:integer(1),attempts:integer(),created_at:instant}))});
export type PickupDetail=ReturnType<typeof detail>;
export function pickups(api:ScopedApi) {
 return {
  async list(after:string|null,signal?:AbortSignal){const r=await api.read(api.path('/api/v1/pickups')+(after?'&after='+uuid(after):''),object({items:array(summary,50),next:nullable(uuid)}),signal);return {items:r.items,page:{has_more:r.next!==null,next_cursor:r.next}};},
  detail(id:string,signal?:AbortSignal){return api.read(api.path('/api/v1/pickups/'+uuid(id)),detail,signal);},
  decide(id:string,body:unknown){return api.intent('pickups.decide',api.path('/api/v1/pickups/'+uuid(id)+'/decision'),body);},
  execute(intent:CommandIntent){return api.execute(intent,summary);},
 };
}
export type PickupSource=ReturnType<typeof pickups>;
