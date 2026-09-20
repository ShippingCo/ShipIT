import { useCallback,useEffect,useRef,useState } from 'react';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure,recoveryFor } from '../data-access/errors';

export type ResourceState<T>={phase:'loading'|'ready'|'empty'|'error';value:T|null;error:ApiFailure|null};
export function useResource<T>(key:string,load:(signal:AbortSignal)=>Promise<T>,empty:(value:T)=>boolean=()=>false){
 const loader=useRef(load),emptyCheck=useRef(empty);loader.current=load;emptyCheck.current=empty;const [revision,setRevision]=useState(0);
 const [state,setState]=useState<ResourceState<T>>({phase:'loading',value:null,error:null});
 const reload=useCallback(()=>setRevision(value=>value+1),[]);
 useEffect(()=>{const abort=new AbortController();setState({phase:'loading',value:null,error:null});void loader.current(abort.signal).then(value=>{if(!abort.signal.aborted)setState({phase:emptyCheck.current(value)?'empty':'ready',value,error:null});}).catch(error=>{if(!abort.signal.aborted&&(!(error instanceof ApiFailure)||error.code!=='SCOPE_CHANGED'))setState({phase:'error',value:null,error:error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network'})});});return()=>abort.abort();},[key,revision]);
 return {...state,reload};
}
export function useCommand<T>(execute:(intent:CommandIntent)=>Promise<T>){
 const executor=useRef(execute);executor.current=execute;const intent=useRef<CommandIntent|null>(null);
 const [state,setState]=useState<{phase:'idle'|'pending'|'confirmed'|'error'|'uncertain';error:ApiFailure|null;result:T|null}>({phase:'idle',error:null,result:null});
 const send=useCallback(async(command:CommandIntent)=>{intent.current=command;setState({phase:'pending',error:null,result:null});try{const result=await executor.current(command);intent.current=null;setState({phase:'confirmed',error:null,result});return result;}catch(error){const safe=error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true});const recovery=recoveryFor(safe,true);if(!['uncertain','pending','conflict'].includes(recovery))intent.current=null;setState({phase:recovery==='uncertain'||recovery==='pending'?'uncertain':'error',error:safe,result:null});throw safe;}},[]);
 const run=useCallback((command:CommandIntent)=>send(command),[send]);
 const retry=useCallback(()=>intent.current?send(intent.current):Promise.resolve(null),[send]);
 const reset=useCallback(()=>{intent.current=null;setState({phase:'idle',error:null,result:null});},[]);
 return {...state,run,retry,reset,canRetry:intent.current!==null};
}

export interface PagedValue<T>{items:T[];page:{has_more:boolean;next_cursor:string|null}}
export function usePagedResource<T>(key:string,load:(cursor:string|null,signal:AbortSignal)=>Promise<PagedValue<T>>){
 const loader=useRef(load);loader.current=load;const abort=useRef<AbortController|null>(null);const [revision,setRevision]=useState(0);
 const [state,setState]=useState<{phase:'loading'|'ready'|'empty'|'error'|'more';items:T[];page:PagedValue<T>['page'];error:ApiFailure|null}>({phase:'loading',items:[],page:{has_more:false,next_cursor:null},error:null});
 const fetchPage=useCallback((cursor:string|null,append:boolean)=>{abort.current?.abort();const request=new AbortController();abort.current=request;setState(previous=>({...previous,phase:append?'more':'loading',...(append?{}:{items:[]}),error:null}));void loader.current(cursor,request.signal).then(value=>{if(request.signal.aborted)return;setState(previous=>({phase:(append?previous.items.length+value.items.length:value.items.length)?'ready':'empty',items:append?[...previous.items,...value.items]:value.items,page:value.page,error:null}));}).catch(error=>{if(request.signal.aborted||error instanceof ApiFailure&&error.code==='SCOPE_CHANGED')return;setState(previous=>({...previous,phase:'error',error:error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network'})}));});},[]);
 useEffect(()=>{fetchPage(null,false);return()=>abort.current?.abort();},[key,revision,fetchPage]);
 const reload=useCallback(()=>setRevision(value=>value+1),[]);
 const loadMore=useCallback(()=>{if(state.page.next_cursor)fetchPage(state.page.next_cursor,true);},[fetchPage,state.page.next_cursor]);
 return {...state,reload,loadMore};
}
