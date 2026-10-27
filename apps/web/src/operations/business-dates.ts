/** Operational business dates follow the existing Asia/Kolkata contract. */
export const businessTimezone='Asia/Kolkata';
export function businessDay(now=new Date()):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:businessTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftDay(day:string,days:number):string {return new Date(Date.parse(day+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function weekMonday(day:string):string {return shiftDay(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));}
export function dayStart(day:string):string {return new Date(day+'T00:00:00+05:30').toISOString();}
export function datePreset(kind:'today'|'week',now=new Date()) {const to=businessDay(now);return {from:kind==='week'?weekMonday(to):to,to};}
