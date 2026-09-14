import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withRouteScope } from '../memberships/service.ts';
import { instant } from '../pricing/types.ts';
import { routeLot,routeMembers } from '../lots/repository.ts';
import { routeParcel } from '../parcels/repository.ts';
import { appendRoute } from '../audit/repository.ts';
import { command,selection,idempotencyKey,uuid,filter } from './validation.ts';
import { fingerprint,keyDigest } from './idempotency.ts';
import { routeCursorCodec } from './cursor.ts';
import type { RouteDto,RouteRow,ManifestRow,RouteOperation,Contribution,RouteScopes } from './types.ts';
import * as repository from './repository.ts';
export function routeDto(r:RouteRow):RouteDto {
  return {id:r.id,origin:r.origin,destination:r.destination,mode:r.mode,carrier_code:r.carrier_code,scheduled_departure_at:instant(r.scheduled_departure_at),
    state:r.state,version:r.version,current_manifest_id:r.current_manifest_id,created_at:instant(r.created_at),updated_at:instant(r.updated_at)};
}
function manifestDto(m:ManifestRow) {return {id:m.id,route_id:m.route_id,version:m.version,finalized:m.finalized,parcel_count:m.parcel_count,created_at:instant(m.created_at)};}
const events:Record<RouteOperation,string>={'routes.create':'route.created','routes.update':'route.updated','routes.archive':'route.archived',
  'routes.finalize':'route.manifest_finalized','routes.lot.attach':'route.lot_attached','routes.lot.detach':'route.lot_detached',
  'routes.parcel.attach':'route.parcel_attached','routes.parcel.detach':'route.parcel_detached'};
async function resolve(scopes:RouteScopes,id:string,finalized:boolean) {
  const sources=await repository.sources(scopes.command,id);
  if(sources.length>100)throw new HttpError('ROUTE_LIMIT_EXCEEDED');
  const rows:Contribution[]=[];
  for(const source of sources){
    if(source.kind==='lot'){
      const lot=await routeLot(scopes.command,source.lot_id!);if(lot.state!=='active')throw new HttpError('LOT_STATE_CONFLICT');
      const members=await routeMembers(scopes.command,lot.id);
      if(!members.length)throw new HttpError('ROUTE_MANIFEST_CONFLICT');
      rows.push(...members.map(m=>({...m,source_id:source.id,lot_id:lot.id})));
    }else rows.push({...await routeParcel(scopes.command,source.parcel_id!),source_id:source.id,lot_id:null,lot_membership_id:null});
    if(new Set(rows.map(r=>r.parcel_id)).size>1000)throw new HttpError('ROUTE_LIMIT_EXCEEDED');
  }
  if(rows.some(r=>r.booking_state!=='active'||!(finalized?['checked_in']:['booked','checked_in']).includes(r.status)))throw new HttpError('PARCEL_STATE_CONFLICT');
  if(finalized&&!rows.length)throw new HttpError('ROUTE_MANIFEST_CONFLICT');
  return rows.sort((a,b)=>a.parcel_id.localeCompare(b.parcel_id)||a.source_id.localeCompare(b.source_id));
}
export function createRouteService(database:DatabasePool,cursorKey:Buffer) {
  const codec=routeCursorCodec(cursorKey);
  async function execute(session:string,routeInput:unknown,resourceInput:unknown,query:unknown,keyInput:unknown,rawHeaders:readonly string[],bodyInput:unknown,operation:RouteOperation,correlation:string) {
    const id=operation==='routes.create'?null:uuid(routeInput,'route_id'),b=command(operation,bodyInput),selected=selection(query);
    const resource=b.lot_id??b.parcel_id??(operation.endsWith('.detach')?uuid(resourceInput,operation==='routes.lot.detach'?'lot_id':'parcel_id'):null);
    const intent=fingerprint(operation,id,resource,b),key=keyDigest(idempotencyKey(keyInput,rawHeaders));
    return withRouteScope(database,session,selected.organizationId,selected.franchiseId,operation,correlation,async s=>{
      const now=await repository.active(s.command),previous=await repository.replay(s.command,operation,key);
      if(previous){if(previous.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');
        if(previous.state!=='committed'||!previous.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');return structuredClone(previous.result);}
      const before=id?await repository.load(s.command,id,true):null;
      // Nested visibility precedes even stale/locked Route information.
      const lot=resource&&operation.startsWith('routes.lot.')?await routeLot(s.command,resource):null;
      const parcel=resource&&operation.startsWith('routes.parcel.')?await routeParcel(s.command,resource):null;
      if(before&&before.version!==b.expected_version)throw new HttpError('VERSION_CONFLICT');
      if(before&&before.state!=='planning')throw new HttpError('ROUTE_STATE_CONFLICT');
      if(operation.endsWith('.attach')){
        if(lot&&lot.state!=='active')throw new HttpError('LOT_STATE_CONFLICT');
        if(parcel&&(parcel.booking_state!=='active'||!['booked','checked_in'].includes(parcel.status)))throw new HttpError('PARCEL_STATE_CONFLICT');
        const current=await repository.sources(s.command,id!);
        if(current.some(r=>(lot?r.lot_id:r.parcel_id)===resource))throw new HttpError('ROUTE_MANIFEST_CONFLICT');
      }
      const route=id??randomUUID(),manifest=operation==='routes.archive'?before!.current_manifest_id:randomUUID(),cmd=randomUUID(),event=randomUUID(),time=instant(now);
      await repository.reserve(s.command,cmd,route,operation,key,intent,b,resource,time);
      if(!before)await repository.create(s.command,route,manifest,cmd,b,time);
      if(resource)await repository.changeSource(s.command,route,resource,cmd,operation,time);
      if(operation!=='routes.archive')await repository.snapshot(s.command,route,manifest,(before?.version??0)+1,operation==='routes.finalize',cmd,
        before?await resolve(s,route,operation==='routes.finalize'):[],time);
      if(before)await repository.revise(s.command,before,manifest,cmd,b,operation,time);
      const row=await repository.load(s.command,route);
      await appendRoute(s.audit!,route,cmd,event);
      await repository.appendEvent(s.events!,row,cmd,event,events[operation],time);
      const result=routeDto(row);await repository.complete(s.command,cmd,result,!before);return result;
    });
  }
  async function read(session:string,routeInput:unknown,query:unknown,correlation:string) {
    const id=uuid(routeInput,'route_id'),f=selection(query);
    return withRouteScope(database,session,f.organizationId,f.franchiseId,'routes.read',correlation,async s=>routeDto(await repository.load(s.command,id)));
  }
  async function list(session:string,query:unknown,correlation:string) {
    const f=filter(query,true);
    return withRouteScope(database,session,f.organizationId,f.franchiseId,'routes.list',correlation,async s=>{
      const binding=keyDigest(JSON.stringify({actor:s.command.context.actor.id,revision:s.revision,...f,cursor:null}));
      const rows=await repository.list(s.command,f,f.cursor?codec.decode(f.cursor,binding):null),hasMore=rows.length>f.limit,items=rows.slice(0,f.limit),last=items.at(-1);
      return {items:items.map(routeDto),page:{has_more:hasMore,next_cursor:hasMore&&last?codec.encode(binding,{value:instant(last.created_at),id:last.id}):null}};
    });
  }
  async function manifest(session:string,routeInput:unknown,manifestInput:unknown,query:unknown,correlation:string) {
    const id=uuid(routeInput,'route_id'),manifestId=manifestInput===undefined?null:uuid(manifestInput,'manifest_id'),f=filter(query);
    return withRouteScope(database,session,f.organizationId,f.franchiseId,'routes.read',correlation,async s=>{
      const route=await repository.load(s.command,id),m=await repository.manifest(s.command,id,manifestId??route.current_manifest_id);
      const binding=keyDigest(JSON.stringify({actor:s.command.context.actor.id,revision:s.revision,...f,cursor:null,route:id,manifest:m.id}));
      const rows=await repository.items(s.command,m.id,f.limit,f.cursor?codec.decode(f.cursor,binding):null),hasMore=rows.length>f.limit,items=rows.slice(0,f.limit),last=items.at(-1);
      return {manifest:manifestDto(m),items,page:{has_more:hasMore,next_cursor:hasMore&&last?codec.encode(binding,{value:m.id,id:last.parcel_id}):null}};
    });
  }
  return {execute,read,list,manifest};
}
