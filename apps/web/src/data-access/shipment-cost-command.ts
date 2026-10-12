import type {CommandIntent} from './command-intent';
import type {ScopeTicket} from './scope-runtime';
import type {ShipmentCostSource} from './shipment-cost';
import {ApiFailure,recoveryFor} from './errors';
type Result=Awaited<ReturnType<ShipmentCostSource['execute']>>;
type State={phase:'idle'|'pending'|'confirmed'|'error'|'uncertain';error:ApiFailure|null;result:Result|null;canRetry:boolean};
const empty=():State=>({phase:'idle',error:null,result:null,canRetry:false});
const commands=new WeakMap<ScopeTicket,ReturnType<typeof create>>();
/** One ephemeral command lifetime per authorized scope, independent of route mounts. */
function create(source:ShipmentCostSource){
 const scope=source.api.scope,listeners=new Set<()=>void>();let intent:CommandIntent|null=null,state=empty();
 const set=(next:State)=>{state=next;listeners.forEach(listener=>listener());};
 const current=()=>{if(scope.signal.aborted)throw new ApiFailure('SCOPE_CHANGED',{kind:'scope'});};
 const send=async(command:CommandIntent)=>{current();intent=command;set({phase:'pending',error:null,result:null,canRetry:true});try{const result=await source.execute(command);current();intent=null;set({phase:'confirmed',error:null,result,canRetry:false});return result;}catch(error){if(scope.signal.aborted)throw error;const safe=error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}),recovery=recoveryFor(safe,true);if(!['uncertain','pending','conflict'].includes(recovery))intent=null;set({phase:recovery==='uncertain'||recovery==='pending'?'uncertain':'error',error:safe,result:null,canRetry:intent!==null});throw safe;}};
 scope.signal.addEventListener('abort',()=>{intent=null;commands.delete(scope);set(empty());listeners.clear();},{once:true});
 return {snapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},run:(command:CommandIntent)=>{current();if(intent||state.phase==='pending')throw new ApiFailure('IDEMPOTENCY_IN_PROGRESS');if(command.scope!==scope)throw new ApiFailure('SCOPE_CHANGED',{kind:'scope'});return send(command);},retry:()=>{current();return intent&&state.phase!=='pending'?send(intent):Promise.resolve(null);},reset:()=>{current();if(state.phase==='pending'||state.phase==='uncertain')return;intent=null;set(empty());}};
}
export function shipmentCostCommand(source:ShipmentCostSource){const scope=source.api.scope;let command=commands.get(scope);if(!command){command=create(source);if(!scope.signal.aborted)commands.set(scope,command);}return command;}
