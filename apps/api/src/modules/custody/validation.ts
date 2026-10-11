import type {ParcelHandoverInput,ParcelReturnInput,ParcelCustodyGrantInput,ParcelReleaseInput} from '@shippingco/shared';
import {object,uuid,integer} from '../pricing/validation.ts';
import {FieldValidationError} from '../../plugins/errors.ts';
const nullable=(v:unknown)=>v===null?null:uuid(v,'$');
export function handoverInput(value:unknown):ParcelHandoverInput{
 const b=object(value,['agent_id','items']);
 if(!Array.isArray(b.items)||b.items.length<1||b.items.length>50)throw new FieldValidationError('$','OUT_OF_RANGE');
 const seen=new Set<string>();
 const items=b.items.map(value=>{
  const item=object(value,['parcel_id','expected_parcel_version','previous_receipt_id','instruction_id','grant_id']),id=uuid(item.parcel_id,'$');
  if(seen.has(id))throw new FieldValidationError('$','INVALID_FORMAT');seen.add(id);
  return {parcel_id:id,expected_parcel_version:integer(item.expected_parcel_version,'expected_version',1,2147483646),
   previous_receipt_id:nullable(item.previous_receipt_id),instruction_id:nullable(item.instruction_id),grant_id:nullable(item.grant_id)};
 }).sort((a,b)=>a.parcel_id.localeCompare(b.parcel_id));
 return {agent_id:uuid(b.agent_id,'$'),items};
}
export function acknowledgementInput(value:unknown){
 const b=object(value,['expected_version']);return {expected_version:integer(b.expected_version,'expected_version',1,1)};
}
export function returnInput(value:unknown):ParcelReturnInput{
 const b=object(value,['parcel_id','expected_parcel_version','source_receipt_id','discrepancy']);
 if(!['none','missing','damaged','tampered','label_mismatch'].includes(b.discrepancy as string))throw new FieldValidationError('$','INVALID_FORMAT');
 return {parcel_id:uuid(b.parcel_id,'$'),expected_parcel_version:integer(b.expected_parcel_version,'expected_version',1,2147483646),source_receipt_id:uuid(b.source_receipt_id,'$'),discrepancy:b.discrepancy as ParcelReturnInput['discrepancy']};
}
export function grantInput(value:unknown):ParcelCustodyGrantInput{
 const b=object(value,['parcel_id','source_receipt_id','destination_kind','destination_agent_id']);
 if(b.destination_kind!=='agent'&&b.destination_kind!=='office')throw new FieldValidationError('$','INVALID_FORMAT');
 const target=nullable(b.destination_agent_id);
 if((b.destination_kind==='office')!==(target===null))throw new FieldValidationError('$','INVALID_FORMAT');
 return {parcel_id:uuid(b.parcel_id,'$'),source_receipt_id:uuid(b.source_receipt_id,'$'),destination_kind:b.destination_kind,destination_agent_id:target};
}
export function releaseInput(value:unknown):ParcelReleaseInput{
 const b=object(value,['parcel_id','source_receipt_id','grant_id','manifest_id']);
 return {parcel_id:uuid(b.parcel_id,'$'),source_receipt_id:uuid(b.source_receipt_id,'$'),grant_id:uuid(b.grant_id,'$'),manifest_id:nullable(b.manifest_id)};
}
