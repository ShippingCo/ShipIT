import {array,choice,integer,nullable,object,protocol,text} from './dto';
import type {ScopedApi} from './scoped-api';

/**
 * Assistant outcomes for one closed week.
 *
 * This is the only place the product can honestly say what the assistant did: the counts come
 * from recorded conversation turns, not from a count of messages sent. The server serves whole
 * closed Monday weeks and hides any cell with fewer than five conversations behind it, so a
 * small shop's figures cannot single out one customer. Both properties are carried through to
 * the screen rather than smoothed over — a hidden cell says it is hidden.
 */
const shape=object({
  definition_version:choice(1),week:text,minimum_conversations:integer(1),
  items:array(object({category:text,suppressed:choice(true,false),events:nullable(integer()),latency_ms:nullable(integer())}),40),
});
export type AssistantMetrics=ReturnType<typeof shape>;
export interface AssistantCount {events:number|null;suppressed:boolean}

/**
 * The last week that has closed long enough ago for the server to serve it.
 *
 * The server requires a Monday that closed at least fifteen minutes ago, so in the first
 * quarter-hour of a Monday the newest finished week is not yet available and the week before
 * it is the honest answer. Working in UTC throughout matches how the weeks are defined.
 */
export function lastClosedWeek(now=new Date()):string {
  const monday=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-((now.getUTCDay()+6)%7)*86400000;
  const candidate=monday-7*86400000;
  return new Date(monday+900000>now.getTime()?candidate-7*86400000:candidate).toISOString().slice(0,10);
}

export function assistantCount(metrics:AssistantMetrics|null,category:string):AssistantCount {
  if(!metrics)return {events:null,suppressed:false};
  // A category the server did not mention is zero, not unknown: it names every one it knows.
  const row=metrics.items.find(item=>item.category===category);
  return {events:row?.suppressed?null:row?.events??0,suppressed:!!row?.suppressed};
}

export const assistantMetrics=(api:ScopedApi)=>({
  read(week:string,signal?:AbortSignal) {
    return api.read(api.path('/api/v1/assistant/metrics')+'&week='+encodeURIComponent(week),value=>{
      const result=shape(value);
      return result.week===week?result:protocol();
    },signal);
  },
});
