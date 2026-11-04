import {object,uuid,choice,instant,array,protocol} from './dto';
import type {ScopedApi} from './scoped-api';
import type {Draft,ParcelDraft} from '../booking/form';
export interface CounterEntryData {fields:Partial<Draft>;additional_parcels:Partial<ParcelDraft>[]}
function fieldValues(value:unknown):Record<string,string>{
 if(!value||typeof value!=='object'||Array.isArray(value))return protocol();
 if(Object.values(value).some(v=>typeof v!=='string'))return protocol();
 return value as Record<string,string>;
}
const data=(v:unknown):CounterEntryData=>object({fields:fieldValues,additional_parcels:array(fieldValues,49)})(v);
const entry=object({id:uuid,state:choice('confirmed'),organization_id:uuid,franchise_id:uuid,confirmed_at:instant,data});
export type CounterEntry=ReturnType<typeof entry>;
export function bookingEntries(api:ScopedApi){return {
 create:(value:CounterEntryData)=>api.intent('api.v1.bookings.entries.create',api.path('/api/v1/bookings/entries'),value),
 execute:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,v=>{
  const result=entry(v);
  if(result.organization_id!==api.organization||result.franchise_id!==api.franchise)return protocol();
  const sent=JSON.parse(intent.bodyJson) as CounterEntryData;
  const same=(a:object,b:object)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
  if(!same(result.data.fields,sent.fields)||result.data.additional_parcels.length!==sent.additional_parcels.length||result.data.additional_parcels.some((p,i)=>!same(p,sent.additional_parcels[i])))return protocol();
  return result;
 }),
 list:(signal?:AbortSignal)=>api.read(api.path('/api/v1/bookings/entries'),object({items:array(entry,100)}),signal),
};}
