import { object,uuid,text,nullable,instant,integer,choice,array,protocol } from './dto';
import type { ScopedApi } from './scoped-api';
import type { CommandIntent } from './command-intent';
const fields={id:uuid,state:choice('open','claimed','resolved'),reason:text,assigned_staff_id:nullable(uuid),version:integer(1),created_at:instant,updated_at:instant};
const summary=object(fields);
const detail=object({...fields,parcel_id:nullable(uuid),current_actor_id:uuid,availability:text,staff:array(object({id:uuid}),100),
 history:array(object({id:uuid,action:text,reason:text,actor_id:text,actor_type:text,occurred_at:instant,text:nullable(text),message_state:nullable(text),message_reason:nullable(text),attempts:nullable(integer())}),50),
 context:array(object({intent:text,outcome:text,recorded_at:instant}),20)});
export type SupportDetail=ReturnType<typeof detail>;
export function support(api:ScopedApi) {
 return {
  async list(after:string|null,signal?:AbortSignal){const r=await api.read(api.path('/api/v1/support')+(after?'&after='+uuid(after):''),object({items:array(summary,50),next:nullable(uuid)}),signal);return {items:r.items,page:{has_more:r.next!==null,next_cursor:r.next}};},
  detail(id:string,signal?:AbortSignal){return api.read(api.path('/api/v1/support/'+uuid(id)),detail,signal);},
  command(id:string,body:unknown){return api.intent('support.write',api.path('/api/v1/support/'+uuid(id)+'/commands'),body);},
  execute(intent:CommandIntent){if(intent.operation!=='support.write')return protocol();const body=JSON.parse(intent.bodyJson) as {expected_version:number;action:string};return api.execute(intent,value=>{const result=summary(value);if(!intent.path.includes('/support/'+result.id+'/commands?')||result.version!==body.expected_version+1||(['claim','assign'].includes(body.action)?result.state!=='claimed':body.action==='resolve'?result.state!=='resolved':body.action==='reopen'?result.state!=='open':false))return protocol();return result;});},
 };
}
export type SupportSource=ReturnType<typeof support>;
