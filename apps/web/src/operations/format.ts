export function formatMoney(paise:number){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);}
export function formatKolkata(instant:string,options:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'}){
 return new Intl.DateTimeFormat('en-IN',{...options,timeZone:'Asia/Kolkata'}).format(new Date(instant));
}
export function localInputToInstant(value:string){const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toISOString():null;}
export function rupeesToPaise(value:string){
 const match=/^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(value.trim());if(!match)return null;
 const paise=BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'));return paise<=BigInt(Number.MAX_SAFE_INTEGER)?Number(paise):null;
}
