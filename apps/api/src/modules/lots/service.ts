import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError,FieldValidationError } from '../../plugins/errors.ts';
import { withLotScope } from '../memberships/service.ts';
import { instant } from '../pricing/types.ts';
import { command,selection,idempotencyKey,uuid,filter,stateGuard } from './validation.ts';
import { fingerprint,keyDigest } from './idempotency.ts';
import { lotCursorCodec } from './cursor.ts';
import type { LotDto,LotMembershipDto,LotRow,MembershipRow,LotOperation,LotMembershipResult } from './types.ts';
import { appendLot } from '../audit/repository.ts';
import * as repository from './repository.ts';
export function lotDto(r:LotRow):LotDto {
  return {id:r.id,code:r.code,name:r.name,destination_key:r.destination_key,state:r.state,version:r.version,
    created_at:instant(r.created_at),updated_at:instant(r.updated_at),archived_at:r.archived_at?instant(r.archived_at):null,active_member_count:r.active_member_count};
}
export function membershipDto(r:MembershipRow):LotMembershipDto {
  return {id:r.id,lot_id:r.lot_id,parcel_id:r.parcel_id,started_at:instant(r.started_at),ended_at:r.ended_at?instant(r.ended_at):null,end_reason:r.end_reason};
}
export function createLotService(database:DatabasePool,cursorKey:Buffer) {
  const codec=lotCursorCodec(cursorKey);
  async function execute(session:string,lotInput:unknown,parcelInput:unknown,query:unknown,keyInput:unknown,rawHeaders:readonly string[],bodyInput:unknown,
    operation:LotOperation,correlation:string):Promise<LotDto|LotMembershipResult> {
    const id=operation==='lots.create'?null:uuid(lotInput,'lot_id'),body=command(operation,bodyInput),selected=selection(query);
    const parcelId=body.parcel_id??(operation==='lots.membership.move'||operation==='lots.membership.remove'?uuid(parcelInput,'parcel_id'):null);
    const intent=fingerprint(operation,id,parcelId,body),key=keyDigest(idempotencyKey(keyInput,rawHeaders));
    return withLotScope(database,session,selected.organizationId,selected.franchiseId,operation,correlation,async s=>{
      const now=await repository.active(s.command);
      const previous=await repository.replay(s.command,operation,key);
      if(previous){
        if(previous.dispatcher_required&&!s.dispatcher)throw new HttpError('ACTION_FORBIDDEN');
        if(previous.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');
        if(previous.state!=='committed'||!previous.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
        return structuredClone(previous.result);
      }
      const lots:LotRow[]=[];
      if(id)for(const lotId of [...new Set([id,...(body.target_lot_id?[body.target_lot_id]:[])])].sort())lots.push(await repository.load(s.command,lotId,true));
      // Authorize every nested resource before exposing version/destination/state conflicts.
      const parcel=parcelId?await repository.parcel(s.command,parcelId,true):null;
      if(body.membership_id)await repository.membershipById(s.command,body.membership_id);
      const current=parcel?await repository.currentMembership(s.command,parcel.id):null;
      if(operation==='lots.create'&&!await repository.knownDestination(s.command,body.destination_key!))throw new FieldValidationError('destination_key','INVALID_FORMAT');
      if(body.target_lot_id===id)throw new HttpError('LOT_MEMBERSHIP_CONFLICT');
      for(const lot of lots){
        if(lot.state!=='active')throw new HttpError('LOT_STATE_CONFLICT');
        if(lot.version!==(lot.id===id?body.expected_version:body.expected_target_version))throw new HttpError('VERSION_CONFLICT');
      }
      if(operation!=='lots.update')for(const lot of lots)await repository.guardActiveRoute(s.command,lot.id);
      let restricted=false;
      if(operation!=='lots.update')for(const lot of lots)restricted=(await repository.locked(s.command,lot.id))||restricted;
      if(parcel){
        const entering=operation!=='lots.membership.remove';
        if(!stateGuard(parcel.status,s.dispatcher,entering,restricted))throw new HttpError('ACTION_FORBIDDEN');
        restricted=restricted||!['booked','checked_in'].includes(parcel.status);
        if(operation==='lots.membership.add') {if(current)throw new HttpError('LOT_MEMBERSHIP_CONFLICT');}
        else if(!current||current.id!==body.membership_id||current.lot_id!==id)throw new HttpError('LOT_MEMBERSHIP_CONFLICT');
        const target=lots.find(l=>l.id===(body.target_lot_id??id))!;
        if(entering&&parcel.destination_key!==target.destination_key)throw new HttpError('LOT_DESTINATION_MISMATCH');
      }
      if(restricted&&!s.dispatcher)throw new HttpError('ACTION_FORBIDDEN');
      const commandId=randomUUID(),lotId=id??randomUUID(),time=instant(now);
      const newMemberId=parcel&&operation!=='lots.membership.remove'?randomUUID():null;
      await repository.reserve(s.command,commandId,operation,key,intent,lotId,parcel,current?.id??newMemberId,body,restricted,time);
      if(operation==='lots.create')await repository.create(s.command,lotId,commandId,body,time);
      if(operation==='lots.archive'||operation==='lots.membership.remove'||operation==='lots.membership.move')
        await repository.endMembership(s.command,lotId,operation==='lots.archive'?null:current!.id,commandId,time,
          operation==='lots.archive'?'archived':operation==='lots.membership.move'?'moved':'removed');
      let membership:MembershipRow|null=null;
      if(newMemberId)membership=await repository.startMembership(s.command,newMemberId,body.target_lot_id??lotId,parcel!,commandId,time);
      for(const lot of lots)await repository.revise(s.command,lot.id,lot.version,commandId,time,operation==='lots.update'?body.name!:lot.name,operation==='lots.archive');
      const changed:LotDto[]=[];
      for(const affected of (id?lots.map(l=>l.id):[lotId])){
        const row=await repository.load(s.command,affected),eventId=randomUUID();
        const type=operation==='lots.create'?'lot.created':operation==='lots.update'?'lot.updated':operation==='lots.archive'?'lot.archived':
          operation==='lots.membership.remove'||(operation==='lots.membership.move'&&affected===id)?'lot.parcel_removed':'lot.parcel_added';
        const payload:Record<string,string>=parcel?{parcel_id:parcel.id,membership_id:type==='lot.parcel_added'?newMemberId!:current!.id,
          ...(body.target_lot_id?{counterpart_lot_id:affected===id?body.target_lot_id:id!}:{})}:{};
        await appendLot(s.audit!,affected,commandId,eventId);
        await repository.appendEvent(s.events!,row,commandId,eventId,type,payload,time);
        changed.push(lotDto(row));
      }
      const result:LotDto|LotMembershipResult=parcel?{lots:changed,membership:membership?membershipDto(membership):null}:changed[0]!;
      await repository.complete(s.command,commandId,result,operation==='lots.create');return result;
    });
  }
  async function read(session:string,idInput:unknown,query:unknown,correlation:string,parcel=false) {
    const id=uuid(idInput,parcel?'parcel_id':'lot_id'),selected=selection(query);
    return withLotScope(database,session,selected.organizationId,selected.franchiseId,'lots.read',correlation,async s=>{
      if(!parcel)return lotDto(await repository.load(s.command,id));
      await repository.parcel(s.command,id);const member=await repository.currentMembership(s.command,id);return member?membershipDto(member):null;
    });
  }
  async function list(session:string,query:unknown,correlation:string,lotInput?:unknown) {
    const id=lotInput===undefined?null:uuid(lotInput,'lot_id'),f=filter(query,!!id);
    return withLotScope(database,session,f.organizationId,f.franchiseId,id?'lots.read':'lots.list',correlation,async s=>{
      if(id)await repository.load(s.command,id);
      const binding=keyDigest(JSON.stringify({actor:s.command.context.actor.id,revision:s.revision,...f,cursor:null,id}));
      const boundary=f.cursor?codec.decode(f.cursor,binding):null;
      const rows=id?await repository.memberships(s.command,id,f,boundary):await repository.list(s.command,f,boundary);
      const hasMore=rows.length>f.limit,visible=rows.slice(0,f.limit),last=visible.at(-1);
      return {items:visible.map(r=>'code' in r?lotDto(r):membershipDto(r)),page:{has_more:hasMore,next_cursor:hasMore&&last?
        codec.encode(binding,{id:last.id,value:instant('created_at' in last?last.created_at:last.started_at)}):null}};
    });
  }
  return {execute,read,list};
}
