import type {BookingParcelDetails} from '@shippingco/shared';
import {FieldValidationError} from '../../plugins/errors.ts';
import {object,integer} from '../tax/validation.ts';
const invalid=():never=>{throw new FieldValidationError('parcels','INVALID_FORMAT');};
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||[...value].some(char=>char.charCodeAt(0)<32||(char.charCodeAt(0)>=127&&char.charCodeAt(0)<=159)))return invalid();return value;}
export function bookingDetails(value:unknown):BookingParcelDetails|undefined{
 if(value===undefined)return undefined;
 const d=object(value,['country','postal_code','city','region','contents_type','contents_description','liquid_quantity_ml']);
 if(d.country!=='IN'||typeof d.postal_code!=='string'||!/^[1-9][0-9]{5}$/.test(d.postal_code)||!['solid','documents','liquid','semi_liquid','other'].includes(String(d.contents_type)))return invalid();
 const liquid=d.contents_type==='liquid'||d.contents_type==='semi_liquid';
 if(!liquid&&d.liquid_quantity_ml!==null)return invalid();
 return {country:'IN',postal_code:d.postal_code,city:text(d.city,80),region:text(d.region,80),contents_type:d.contents_type as BookingParcelDetails['contents_type'],contents_description:text(d.contents_description,200),liquid_quantity_ml:liquid?integer(d.liquid_quantity_ml,'weight_grams',1,100000000):null};
}
