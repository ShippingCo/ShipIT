import { HttpError } from '../../plugins/errors.ts';
import { timestamp } from '../pricing/validation.ts';

export interface PickupDraft {quote_id:string;request_key:string;address?:string;window_start?:string;window_end?:string}
export const expectations='This is a pickup request, not a booking or a guarantee of courier arrival. Staff must review capacity and agree a window.';
export function address(value:unknown):string {
 if(typeof value!=='string')throw new HttpError('VALIDATION_FAILED');
 const text=value.trim();
 if(text.length<12||text.length>500||/[\p{Cc}\p{Cf}]/u.test(text)||!/[\p{L}]/u.test(text))throw new HttpError('VALIDATION_FAILED');
 return text;
}
export function windowInput(start:unknown,end:unknown,now:Date) {
 const from=timestamp(start,'$'),to=timestamp(end,'$'),a=Date.parse(from),b=Date.parse(to);
 if(a<=now.getTime()||a>now.getTime()+30*86400000||b<=a||b-a>86400000)throw new HttpError('VALIDATION_FAILED');
 return {window_start:from,window_end:to};
}
export function transition(current:string,action:string,version:number,expected:number) {
 if(version!==expected||current!=='submitted'||!['accepted','declined','canceled'].includes(action))throw new HttpError('VERSION_CONFLICT');
}
