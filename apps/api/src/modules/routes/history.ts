import type {DatabasePool} from '@shippingco/db';
import {withRouteScope} from '../memberships/service.ts';
import {scopedQuery} from '../security/scope.ts';
import {keyDigest} from '../pricing/idempotency.ts';
import {uuid,filter} from './validation.ts';
import {routeCursorCodec} from './cursor.ts';
import * as repository from './repository.ts';
export function createRouteHistory(database:DatabasePool,key:Buffer){
 const codec=routeCursorCodec(key);
 return async(session:string,idInput:unknown,query:unknown,correlation:string)=>{
  const id=uuid(idInput,'route_id'),f=filter(query);
  return withRouteScope(database,session,f.organizationId,f.franchiseId,'routes.read',correlation,async s=>{
   await repository.load(s.command,id);
   const binding=keyDigest(JSON.stringify({history:id,actor:s.command.context.actor.id,revision:s.revision,...f,cursor:null}));
   const boundary=f.cursor?codec.decode(f.cursor,binding):null;
   const rows=(await scopedQuery<{id:string;event_id:string;event_type:string;version:number;at:Date;note:string|null;progress:string|null;planning_delay:string|null;delay:string|null}>(s.command,['routes.read'],`SELECT c.id,e.event_id,e.event_type,COALESCE(c.expected_version,0)+1 AS version,
     COALESCE((c.input->>'effective_at')::timestamptz,c.occurred_at) AS at,c.input->>'note' AS note,c.input->>'planning_progress' AS progress,
     c.input->>'planning_delay_minutes' AS planning_delay,c.input->>'total_delay_minutes' AS delay
     FROM shipit.route_commands c JOIN shipit.domain_events e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.route_command_id=c.id
     WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.route_id=$1 AND c.state='committed'
       AND ($2::integer IS NULL OR COALESCE(c.expected_version,0)+1<$2)
     ORDER BY COALESCE(c.expected_version,0) DESC LIMIT $3`,[id,boundary?Number(boundary.value):null,f.limit+1])).rows;
   const hasMore=rows.length>f.limit,visible=rows.slice(0,f.limit),last=visible.at(-1);
   return {items:visible.map(r=>({id:r.event_id,type:r.progress==='departed'?'route.departed':r.progress==='arrived'?'route.arrived':r.planning_delay!==null?'route.delayed':r.event_type,
    at:r.at.toISOString(),note:r.note??'',total_delay_minutes:Number(r.planning_delay??r.delay??0),planning:r.progress!==null||r.planning_delay!==null})),page:{has_more:hasMore,next_cursor:hasMore&&last?codec.encode(binding,{id:last.id,value:String(last.version)}):null}};
  });
 };
}
