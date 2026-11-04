import { FieldValidationError,HttpError } from '../../plugins/errors.ts';
import { object,integer,uuid } from '../pricing/validation.ts';
import type { LotFilter,LotInput,LotOperation } from './types.ts';
export { uuid } from '../pricing/validation.ts';
export { selection,idempotencyKey } from '../bookings/validation.ts';
export function destination(value:unknown):string {
  if(typeof value!=='string'||value.length>32||!/^[A-Z][A-Z0-9_]{0,31}$/.test(value)||value.includes('\n'))throw new FieldValidationError('destination_key','INVALID_FORMAT');
  return value;
}
function name(value:unknown):string {
  if(typeof value!=='string')throw new FieldValidationError('name','INVALID_TYPE');
  const result=value.trim();
  if([...result].length<1||[...result].length>120||[...result].some(c=>{const n=c.codePointAt(0)!;return n<32||(n>=127&&n<=159)||(n>=0xd800&&n<=0xdfff);}))throw new FieldValidationError('name','INVALID_FORMAT');
  return result;
}
export function command(operation:LotOperation,input:unknown):LotInput {
  const fields=operation==='lots.create'?['name','destination_key','note','planning_entry_ids','planning_route_id']:operation==='lots.update'?['expected_version','name','note','planning_entry_ids','planning_route_id']:
    operation==='lots.archive'?['expected_version']:operation==='lots.membership.add'?['expected_version','parcel_id']:
    operation==='lots.membership.remove'?['expected_version','membership_id']:['expected_version','membership_id','target_lot_id','expected_target_version'];
  const b=object(input,fields);
  const metadata:Pick<LotInput,'note'|'planning_entry_ids'|'planning_route_id'>={};
  if(b.planning_route_id!==undefined)metadata.planning_route_id=b.planning_route_id===null?null:uuid(b.planning_route_id,'route_id');
  if(b.note!==undefined){if(typeof b.note!=='string'||b.note.length>1000)throw new FieldValidationError('note','OUT_OF_RANGE');metadata.note=b.note;}
  if(b.planning_entry_ids!==undefined){
    if(!Array.isArray(b.planning_entry_ids)||b.planning_entry_ids.length>50)throw new FieldValidationError('planning_entry_ids','OUT_OF_RANGE');
    metadata.planning_entry_ids=[...new Set(b.planning_entry_ids.map(id=>uuid(id,'planning_entry_ids')))].sort();
  }
  if(operation==='lots.create')return {name:name(b.name),destination_key:destination(b.destination_key),...metadata};
  const common={expected_version:integer(b.expected_version,'expected_version',1,2147483646)};
  if(operation==='lots.update')return {...common,name:name(b.name),...metadata};
  if(operation==='lots.archive')return common;
  if(operation==='lots.membership.add')return {...common,parcel_id:uuid(b.parcel_id,'parcel_id')};
  const member={...common,membership_id:uuid(b.membership_id,'membership_id')};
  return operation==='lots.membership.remove'?member:{...member,target_lot_id:uuid(b.target_lot_id,'target_lot_id'),expected_target_version:integer(b.expected_target_version,'expected_target_version',1,2147483646)};
}
export function filter(value:unknown,members=false):LotFilter {
  const b=object(value,['organization_id','franchise_id','state','limit','cursor',...(!members?['destination_key']:[])]);
  const state=b.state===undefined?null:b.state;
  if(state!==null&&!(members?['active','ended']:['active','archived']).includes(state as string))throw new FieldValidationError('state','INVALID_FORMAT');
  const limit=b.limit===undefined?50:typeof b.limit==='string'&&/^[1-9][0-9]{0,2}$/.test(b.limit)?Number(b.limit):NaN;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new FieldValidationError('limit','OUT_OF_RANGE');
  if(b.cursor!==undefined&&(typeof b.cursor!=='string'||b.cursor.length<1||b.cursor.length>4096))throw new FieldValidationError('cursor','INVALID_FORMAT');
  return {organizationId:uuid(b.organization_id,'organization_id'),franchiseId:uuid(b.franchise_id,'franchise_id'),state:state as string|null,
    destination:b.destination_key===undefined?null:destination(b.destination_key),limit,cursor:b.cursor as string??null};
}
export function stateGuard(status:string,dispatcher:boolean,entering:boolean,locked:boolean) {
  if(!['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto'].includes(status))throw new HttpError('PARCEL_STATE_CONFLICT');
  if(entering&&['delivered','rto'].includes(status))throw new HttpError('PARCEL_STATE_CONFLICT');
  return dispatcher||(!locked&&['booked','checked_in'].includes(status));
}
