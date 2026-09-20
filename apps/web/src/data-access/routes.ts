import type { RouteDto,RouteEventInput,RouteEventResult,RouteManifestDto,RouteManifestItem } from '@shippingco/shared';
import type { CommandIntent } from './command-intent';
import { array, choice, instant, integer, list, nullable, object, text, uuid, type Decoder, protocol } from './dto';
import type { ScopedApi } from './scoped-api';

export const routeDto:Decoder<RouteDto>=object({id:uuid,origin:text,destination:text,mode:choice('road','rail','air','sea'),carrier_code:nullable(text),scheduled_departure_at:instant,state:choice('planning','finalized','archived'),version:integer(1),current_manifest_id:uuid,created_at:instant,updated_at:instant});
const manifestDto:Decoder<RouteManifestDto>=object({id:uuid,route_id:uuid,version:integer(1),finalized:choice(true,false),parcel_count:integer(),created_at:instant});
const direct=object({kind:choice('direct'),source_id:uuid});
const lot=object({kind:choice('lot'),source_id:uuid,lot_id:uuid,lot_membership_id:uuid});
const source:Decoder<RouteManifestItem['sources'][number]>=value=>{const kind=(value as {kind?:unknown}|null)?.kind;return kind==='direct'?direct(value):kind==='lot'?lot(value):protocol();};
const manifestItem:Decoder<RouteManifestItem>=object({parcel_id:uuid,sources:array(source,200)});
export const routeEventResult:Decoder<RouteEventResult>=object({event_id:uuid,route_id:uuid,version:integer(1),manifest_id:uuid,manifest_version:integer(1),kind:choice('departure','delay','arrival'),effective_at:instant,updated_count:integer(),skipped_count:integer(),eta:object({state:choice('available','unavailable','arrived'),base_at:nullable(instant),revised_at:nullable(instant),total_delay_minutes:integer()})});
export type RouteCommand=
 {kind:'create';body:{origin:string;destination:string;mode:'road'|'rail'|'air'|'sea';carrier_code:string|null;scheduled_departure_at:string}}|
 {kind:'update';routeId:string;body:{expected_version:number;origin:string;destination:string;mode:'road'|'rail'|'air'|'sea';carrier_code:string|null;scheduled_departure_at:string}}|
 {kind:'archive'|'finalize';routeId:string;body:{expected_version:number}}|
 {kind:'attach_lot';routeId:string;body:{expected_version:number;lot_id:string}}|
 {kind:'detach_lot';routeId:string;lotId:string;body:{expected_version:number}}|
 {kind:'attach_parcel';routeId:string;body:{expected_version:number;parcel_id:string}}|
 {kind:'detach_parcel';routeId:string;parcelId:string;body:{expected_version:number}}|
 {kind:'event';routeId:string;body:RouteEventInput};
const operations:Record<Exclude<RouteCommand['kind'],'event'>,string>={create:'api.v1.routes.create',update:'api.v1.routes.update',archive:'api.v1.routes.archive',finalize:'api.v1.routes.finalize',attach_lot:'api.v1.routes.lot.attach',detach_lot:'api.v1.routes.lot.detach',attach_parcel:'api.v1.routes.parcel.attach',detach_parcel:'api.v1.routes.parcel.detach'};
const eventOperations:Record<RouteEventInput['kind'],string>={departure:'api.v1.routes.departure',delay:'api.v1.routes.delay',arrival:'api.v1.routes.arrival'};
export function routes(api:ScopedApi){const base='/api/v1/routes';return {
 list(filter:{state?:RouteDto['state'];limit?:number;cursor?:string|null}={},signal?:AbortSignal){const q=new URLSearchParams();for(const[k,v]of Object.entries(filter))if(v!==undefined&&v!==null)q.set(k,String(v));return api.read(api.path(base)+(q.size?'&'+q:''),list(routeDto),signal);},
 read(id:string,signal?:AbortSignal){return api.read(api.path(`${base}/${uuid(id)}`),routeDto,signal);},
 manifest(routeId:string,manifestId?:string,filter:{limit?:number;cursor?:string|null}={},signal?:AbortSignal){const q=new URLSearchParams();for(const[k,v]of Object.entries(filter))if(v!==undefined&&v!==null)q.set(k,String(v));const path=manifestId?`${base}/${uuid(routeId)}/manifests/${uuid(manifestId)}`:`${base}/${uuid(routeId)}/parcels`;return api.read(api.path(path)+(q.size?'&'+q:''),object({manifest:manifestDto,items:array(manifestItem,100),page:object({has_more:choice(true,false),next_cursor:nullable(text)})}),signal);},
 latest(routeId:string,signal?:AbortSignal){return api.read(api.path(`${base}/${uuid(routeId)}/events`),object({route_id:uuid,version:integer(1),latest:nullable(routeEventResult)}),signal);},
 intent(command:RouteCommand){let path=base,method:'POST'|'PATCH'='POST';if(command.kind==='update'){path+=`/${uuid(command.routeId)}`;method='PATCH';}else if(command.kind==='archive'||command.kind==='finalize')path+=`/${uuid(command.routeId)}/${command.kind}`;else if(command.kind==='attach_lot')path+=`/${uuid(command.routeId)}/lots`;else if(command.kind==='detach_lot')path+=`/${uuid(command.routeId)}/lots/${uuid(command.lotId)}/remove`;else if(command.kind==='attach_parcel')path+=`/${uuid(command.routeId)}/parcels`;else if(command.kind==='detach_parcel')path+=`/${uuid(command.routeId)}/parcels/${uuid(command.parcelId)}/remove`;else if(command.kind==='event')path+=`/${uuid(command.routeId)}/events`;const expected='expected_version'in command.body?command.body.expected_version:undefined;const operation=command.kind==='event'?eventOperations[command.body.kind]:operations[command.kind];return api.intent(operation,api.path(path),command.body,method,expected);},
 execute(intent:CommandIntent){const fields=['$','origin','destination','mode','carrier_code','scheduled_departure_at','expected_version','lot_id','parcel_id','kind','manifest_id','manifest_version','effective_at','evidence_ref','base_eta_at','total_delay_minutes'],routeId=/\/routes\/([0-9a-f-]{36})/.exec(intent.path)?.[1],body=JSON.parse(intent.bodyJson)as Record<string,unknown>;
  const eventKind=(Object.entries(eventOperations).find(([,operation])=>operation===intent.operation)?.[0])as RouteEventInput['kind']|undefined;
  if(eventKind)return api.execute(intent,value=>{const result=routeEventResult(value);if(!routeId||result.route_id!==routeId||result.kind!==eventKind||result.kind!==body.kind||result.manifest_id!==body.manifest_id||result.manifest_version!==body.manifest_version||result.version!==Number(body.expected_version)+1)return protocol();return result;},fields);
  if(!Object.values(operations).includes(intent.operation))return protocol();
  return api.execute(intent,value=>{const result=routeDto(value);if(routeId&&result.id!==routeId)return protocol();if(routeId&&result.version!==Number(body.expected_version)+1)return protocol();return result;},fields);},
};}
export type RouteSource=ReturnType<typeof routes>;
