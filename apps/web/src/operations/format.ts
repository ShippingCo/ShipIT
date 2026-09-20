export function formatMoney(paise:number){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);}
export function formatKolkata(instant:string,options:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'}){
 return new Intl.DateTimeFormat('en-IN',{...options,timeZone:'Asia/Kolkata'}).format(new Date(instant));
}
// India Standard Time is UTC+05:30 and currently has no daylight-saving transitions.
// Keep the offset boundary here so datetime-local values never inherit the browser timezone.
const kolkataOffsetMilliseconds=330*60*1000;
const localDateTime=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
export function instantToKolkataInput(instant:string){
 const milliseconds=Date.parse(instant);if(!Number.isFinite(milliseconds))return null;
 const shifted=new Date(milliseconds+kolkataOffsetMilliseconds);if(!Number.isFinite(shifted.getTime()))return null;
 const local=shifted.toISOString().slice(0,-1);
 return local.endsWith(':00.000')?local.slice(0,16):local.endsWith('.000')?local.slice(0,-4):local;
}
export function kolkataInputToInstant(value:string){
 const match=localDateTime.exec(value);if(!match)return null;
 const [,year,month,day,hour,minute,second='00',fraction='']=match;
 const parts=[Number(year),Number(month),Number(day),Number(hour),Number(minute),Number(second),Number(fraction.padEnd(3,'0'))] as const;
 const localMilliseconds=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5],parts[6]);
 const normalized=new Date(localMilliseconds).toISOString();
 if(normalized.slice(0,10)!==`${year}-${month}-${day}`||normalized.slice(11,19)!==`${hour}:${minute}:${second}`)return null;
 return new Date(localMilliseconds-kolkataOffsetMilliseconds).toISOString();
}
export function rupeesToPaise(value:string){
 const match=/^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(value.trim());if(!match)return null;
 const paise=BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'));return paise<=BigInt(Number.MAX_SAFE_INTEGER)?Number(paise):null;
}
