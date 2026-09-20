import type { LotDto,LotMembershipDto,LotMembershipResult } from '@shippingco/shared';
import type { CommandIntent } from './command-intent';
import { choice, instant, integer, list, nullable, object, text, uuid, type Decoder, protocol } from './dto';
import type { ScopedApi } from './scoped-api';

export const lotDto:Decoder<LotDto>=object({id:uuid,code:text,name:text,destination_key:text,state:choice('active','archived'),version:integer(1),created_at:instant,updated_at:instant,archived_at:nullable(instant),active_member_count:integer()});
export const lotMembershipDto:Decoder<LotMembershipDto>=object({id:uuid,lot_id:uuid,parcel_id:uuid,started_at:instant,ended_at:nullable(instant),end_reason:nullable(choice('removed','moved','archived'))});
const membershipResult:Decoder<LotMembershipResult>=object({lots:listItemArray(lotDto),membership:nullable(lotMembershipDto)});
function listItemArray<T>(decode:Decoder<T>):Decoder<T[]>{return value=>{if(!Array.isArray(value)||value.length>2)return protocol();return value.map(decode);};}
export type LotCommand=
  {kind:'create';body:{name:string;destination_key:string}}|
  {kind:'update';lotId:string;body:{expected_version:number;name:string}}|
  {kind:'archive';lotId:string;body:{expected_version:number}}|
  {kind:'add';lotId:string;body:{expected_version:number;parcel_id:string}}|
  {kind:'move';lotId:string;parcelId:string;body:{expected_version:number;membership_id:string;target_lot_id:string;expected_target_version:number}}|
  {kind:'remove';lotId:string;parcelId:string;body:{expected_version:number;membership_id:string}};
const operations:Record<LotCommand['kind'],string>={create:'api.v1.lots.create',update:'api.v1.lots.update',archive:'api.v1.lots.archive',add:'api.v1.lots.membership.add',move:'api.v1.lots.membership.move',remove:'api.v1.lots.membership.remove'};
export function lots(api:ScopedApi){
 const base='/api/v1/lots';
 return {
  list(filter:{state?:'active'|'archived';destination_key?:string;limit?:number;cursor?:string|null}={},signal?:AbortSignal){const q=new URLSearchParams();for(const[k,v]of Object.entries(filter))if(v!==undefined&&v!==null&&v!=='')q.set(k,String(v));return api.read(api.path(base)+(q.size?'&'+q:''),list(lotDto),signal);},
  read(id:string,signal?:AbortSignal){return api.read(api.path(`${base}/${uuid(id)}`),lotDto,signal);},
  memberships(id:string,filter:{state?:'active'|'ended';limit?:number;cursor?:string|null}={},signal?:AbortSignal){const q=new URLSearchParams();for(const[k,v]of Object.entries(filter))if(v!==undefined&&v!==null)q.set(k,String(v));return api.read(api.path(`${base}/${uuid(id)}/memberships`)+(q.size?'&'+q:''),list(lotMembershipDto),signal);},
  currentMembership(parcelId:string,signal?:AbortSignal){return api.read(api.path(`/api/v1/parcels/${uuid(parcelId)}/lot-membership`),nullable(lotMembershipDto),signal);},
  intent(command:LotCommand){let path=base,method:'POST'|'PATCH'='POST';if(command.kind==='update'){path+=`/${uuid(command.lotId)}`;method='PATCH';}else if(command.kind==='archive')path+=`/${uuid(command.lotId)}/archive`;else if(command.kind==='add')path+=`/${uuid(command.lotId)}/parcels`;else if(command.kind==='move')path+=`/${uuid(command.lotId)}/parcels/${uuid(command.parcelId)}/move`;else if(command.kind==='remove')path+=`/${uuid(command.lotId)}/parcels/${uuid(command.parcelId)}/remove`;
   const expected='expected_version'in command.body?command.body.expected_version:undefined;return api.intent(operations[command.kind],api.path(path),command.body,method,expected);},
  execute(intent:CommandIntent){const kind=(Object.entries(operations).find(([,v])=>v===intent.operation)?.[0])as LotCommand['kind']|undefined;if(!kind)return protocol();const fields=['$','name','destination_key','expected_version','parcel_id','membership_id','target_lot_id','expected_target_version'],body=JSON.parse(intent.bodyJson)as Record<string,unknown>,lotId=/\/lots\/([0-9a-f-]{36})/.exec(intent.path)?.[1];
   if(kind==='create')return api.execute(intent,lotDto,fields);
   if(kind==='update'||kind==='archive')return api.execute(intent,value=>{const result=lotDto(value);if(!lotId||result.id!==lotId||result.version!==Number(body.expected_version)+1)return protocol();return result;},fields);
   return api.execute(intent,value=>{const result=membershipResult(value);if(!lotId||!result.lots.some(lot=>lot.id===lotId))return protocol();if(result.membership&&('parcel_id'in body&&result.membership.parcel_id!==body.parcel_id||result.membership.lot_id!==('target_lot_id'in body?body.target_lot_id:lotId)))return protocol();return result;},fields);},
 };
}
export type LotSource=ReturnType<typeof lots>;
