import type { BulkParcelAction, BulkParcelItem, BulkParcelResult } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import type { CommandIntent } from './command-intent';
import { ApiFailure, recoveryFor } from './errors';
import { createParcelBulkSource, type ParcelBulkSource } from './parcel-bulk';

export interface ParcelBulkState {
  phase: 'idle'|'pending'|'confirmed'|'uncertain'|'error';
  selected: readonly BulkParcelItem[];
  result: BulkParcelResult|null;
  error: ApiFailure|null;
}
export type RefreshFailed = (items: readonly BulkParcelItem[], signal: AbortSignal) => Promise<readonly BulkParcelItem[]>;
/** Scope-owned ephemeral controller. #34 supplies authoritative reads and refresh integration. */
export function createParcelBulkController(scope: ScopeController, source: ParcelBulkSource = createParcelBulkSource()) {
  let state: ParcelBulkState = { phase:'idle',selected:[],result:null,error:null };
  let intent: CommandIntent|null = null;
  const listeners = new Set<() => void>();
  const set = (next: ParcelBulkState) => { state = next; listeners.forEach(listener => listener()); };
  const clear = () => { intent=null; set({phase:'idle',selected:[],result:null,error:null}); };
  // ScopeRuntime callbacks are one-shot. Register for every new selection/command lifetime.
  let unregister = scope.runtime.onInvalidate(clear);
  function watch() { unregister(); unregister=scope.runtime.onInvalidate(clear); }
  async function send(command: CommandIntent) {
    intent=command; watch(); set({...state,phase:'pending',error:null});
    try {
      const received = await scope.command(() => source.execute(command,scope.runtime.ticket));
      if (!scope.runtime.isCurrent(command.scope)) return;
      const merged = new Map(state.result?.items.map(item=>[item.parcel_id,item])??[]);
      for(const item of received.items)merged.set(item.parcel_id,item);
      const items=[...merged.values()],succeeded=items.filter(item=>item.outcome==='succeeded').length;
      const result:BulkParcelResult={action:received.action,items,summary:{succeeded,failed:items.length-succeeded}};
      const failed = new Set(result.items.filter(item => item.outcome==='failed').map(item => item.parcel_id));
      const selected = state.selected.filter(item => failed.has(item.parcel_id));
      intent=null; set({phase:'confirmed',selected,result,error:null});
    } catch (error) {
      if (!scope.runtime.isCurrent(command.scope)) return;
      const safe = error instanceof ApiFailure ? error : new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true});
      const recovery = recoveryFor(safe,true);
      set({...state,phase:recovery==='uncertain'||recovery==='pending'?'uncertain':'error',error:safe});
    }
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(items: readonly BulkParcelItem[]) {
      if (state.phase==='pending'||intent) return;
      watch(); set({phase:'idle',selected:structuredClone(items),result:null,error:null});
    },
    async submit(action: BulkParcelAction) {
      if (state.phase==='pending'||intent||!state.selected.length) return;
      try { await send(source.intent({action,items:[...state.selected]},scope.runtime.ticket())); }
      catch(error) { set({...state,error:error instanceof ApiFailure?error:new ApiFailure('VALIDATION_FAILED')}); }
    },
    async retryUncertain() { if (intent && state.phase!=='pending') await send(intent); },
    async retryFailed(refresh: RefreshFailed) {
      if (state.phase!=='confirmed'||!state.result||!state.selected.length) return;
      const ticket=scope.runtime.ticket(), previous=state, failed=new Map(previous.selected.map(item=>[item.parcel_id,item]));
      set({...state,phase:'pending'});
      try {
        const refreshed=await scope.command(()=>refresh(previous.selected,ticket.signal));
        if (!scope.runtime.isCurrent(ticket)) return;
        // Refresh may omit unavailable rows but can never add an already successful item.
        if (!refreshed.length || new Set(refreshed.map(item=>item.parcel_id)).size!==refreshed.length || refreshed.some(item=>!failed.has(item.parcel_id))) throw new ApiFailure('VALIDATION_FAILED');
        const items=refreshed.map(item=>{
          const old=failed.get(item.parcel_id)!;
          const canonical=(command:BulkParcelItem['command'])=>JSON.stringify(Object.entries(command).sort(([a],[b])=>a<b?-1:a>b?1:0));
          const unchanged=canonical(old.command)===canonical(item.command);
          return {...item,idempotency_key:unchanged?old.idempotency_key:crypto.randomUUID()};
        });
        set({...previous,selected:previous.selected.map(old=>items.find(item=>item.parcel_id===old.parcel_id)??old)});
        await send(source.intent({action:previous.result!.action,items},ticket));
      } catch (error) {
        if (scope.runtime.isCurrent(ticket)) set({...previous,error:error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE')});
      }
    },
    dispose() { unregister(); clear(); listeners.clear(); },
  };
}
export type ParcelBulkController = ReturnType<typeof createParcelBulkController>;
