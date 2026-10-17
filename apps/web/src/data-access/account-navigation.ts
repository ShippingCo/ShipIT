import type {ScopeTicket} from './scope-runtime';
const pending=new WeakMap<ScopeTicket,()=>void>();
/** Router POP as well as links must preserve a mounted exact unresolved account command. */
export function retainAccountNavigation(scope:ScopeTicket,blocked:()=>void){pending.set(scope,blocked);const clear=()=>pending.delete(scope);scope.signal.addEventListener('abort',clear,{once:true});return()=>{clear();scope.signal.removeEventListener('abort',clear);};}
export function accountNavigationPending(scope:ScopeTicket){return pending.has(scope);}
export function accountNavigationBlocked(scope:ScopeTicket){pending.get(scope)?.();}
