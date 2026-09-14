import { FieldValidationError, type ValidationField } from '../../plugins/errors.ts';
import { object,integer,uuid,timestamp } from '../pricing/validation.ts';
import type { RouteOperation,RouteInput,RouteFilter } from './types.ts';
export { uuid } from '../pricing/validation.ts';
export { selection,idempotencyKey } from '../bookings/validation.ts';
function label(value:unknown,field:ValidationField) {
  if(typeof value!=='string')throw new FieldValidationError(field,'INVALID_TYPE');
  const result=value.trim();
  if([...result].length<1||[...result].length>120||[...result].some(c=>{const n=c.codePointAt(0)!;return n<32||(n>=127&&n<=159)||(n>=0xd800&&n<=0xdfff);}))throw new FieldValidationError(field,'INVALID_FORMAT');
  return result;
}
export function command(operation:RouteOperation,value:unknown):RouteInput {
  const metadata=['origin','destination','mode','carrier_code','scheduled_departure_at'];
  const fields=operation==='routes.create'?metadata:operation==='routes.update'?['expected_version',...metadata]:
    operation==='routes.lot.attach'?['expected_version','lot_id']:operation==='routes.parcel.attach'?['expected_version','parcel_id']:['expected_version'];
  const b=object(value,fields),version=operation==='routes.create'?{}:{expected_version:integer(b.expected_version,'expected_version',1,2147483646)};
  if(operation==='routes.create'||operation==='routes.update'){
    if(!['road','rail','air','sea'].includes(b.mode as string))throw new FieldValidationError('mode','INVALID_FORMAT');
    const carrier=b.carrier_code===undefined||b.carrier_code===null?null:b.carrier_code;
    if(carrier!==null&&(typeof carrier!=='string'||carrier.length>64||!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(carrier)||carrier.includes('\n')))throw new FieldValidationError('carrier_code','INVALID_FORMAT');
    return {...version,origin:label(b.origin,'origin'),destination:label(b.destination,'destination'),mode:b.mode as RouteInput['mode'],
      carrier_code:carrier as string|null,scheduled_departure_at:timestamp(b.scheduled_departure_at,'scheduled_departure_at')};
  }
  return {...version,...(operation==='routes.lot.attach'?{lot_id:uuid(b.lot_id,'lot_id')}:
    operation==='routes.parcel.attach'?{parcel_id:uuid(b.parcel_id,'parcel_id')}:{})};
}
export function filter(value:unknown,collection=false):RouteFilter {
  const b=object(value,['organization_id','franchise_id','limit','cursor',...(collection?['state']:[])]);
  if(b.state!==undefined&&!['planning','finalized','archived'].includes(b.state as string))throw new FieldValidationError('state','INVALID_FORMAT');
  const limit=b.limit===undefined?50:typeof b.limit==='string'&&/^[1-9][0-9]{0,2}$/.test(b.limit)?Number(b.limit):NaN;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new FieldValidationError('limit','OUT_OF_RANGE');
  if(b.cursor!==undefined&&(typeof b.cursor!=='string'||b.cursor.length<1||b.cursor.length>4096))throw new FieldValidationError('cursor','INVALID_FORMAT');
  return {organizationId:uuid(b.organization_id,'organization_id'),franchiseId:uuid(b.franchise_id,'franchise_id'),
    state:b.state as string??null,limit,cursor:b.cursor as string??null};
}
