import type { OperatorContext } from '@shippingco/shared';
import { ApiFailure } from '../data-access/errors';
import { createScopeRuntime } from '../data-access/scope-runtime';
import { createOperatorDataSource } from './data-source';
import type { OperatorDataSource } from './data-source';
export type ScopeState = { status: 'loading' | 'signed_out' | 'error' | 'loaded'; context: OperatorContext | null; path: string; notice?: string;
  /** Why the shell is in `error`: a revoked authority, or a server we simply could not reach. */
  reason?: 'access' | 'unreachable' };

/** Only 401 means signed out, and only an authorization answer means access changed. A timeout,
 *  a 429, a 5xx or a dropped connection proves nothing about authority, so it must never clear
 *  the workspace or tell a cashier they have been signed out. */
const UNREACHABLE_CODES = ['REQUEST_TIMEOUT', 'RATE_LIMITED', 'INTERNAL_ERROR', 'TEMPORARILY_UNAVAILABLE'];
export function classifyFailure(error: unknown): 'signed_out' | 'access' | 'unreachable' {
  if (!(error instanceof ApiFailure)) return 'unreachable';
  if (error.kind !== 'response') return 'unreachable';
  if (error.code === 'UNAUTHENTICATED') return 'signed_out';
  if (UNREACHABLE_CODES.includes(error.code)) return 'unreachable';
  return 'access';
}

/** #17's shell controller owns one generalized private lifetime for all future domain adapters. */
export function createScopeController(source: OperatorDataSource = createOperatorDataSource()) {
  const runtime = createScopeRuntime(error => fail(error));
  let state: ScopeState = { status: 'loading', context: null, path: '' };
  let navigation=0;
  const listeners = new Set<() => void>();
  const set = (next: ScopeState) => { state = next; listeners.forEach(listener => listener()); };
  function clear(status: ScopeState['status'] = 'loading', path = state.path, reason?: ScopeState['reason']) {
    navigation++; runtime.invalidate(); set({ status, context: null, path, reason });
  }
  const UNREACHABLE_NOTICE = 'The shop could not reach the server just now. Your work is still here — try again in a moment.';
  /** Route a failure by what it actually proves. A server we could not reach keeps the
   *  workspace on screen with a quiet notice; only a real authorization answer clears it. */
  function fail(error: unknown, path = state.path, keep: OperatorContext | null = state.context) {
    const kind = classifyFailure(error);
    if (kind === 'unreachable') {
      if (keep) { set({ status: 'loaded', context: keep, path, notice: UNREACHABLE_NOTICE }); return; }
      clear('error', path, 'unreachable'); return;
    }
    clear(kind === 'signed_out' ? 'signed_out' : 'error', path, kind === 'signed_out' ? undefined : 'access');
  }
  function denied(error: unknown) {
    if (error instanceof ApiFailure && ['UNAUTHENTICATED', 'ACTION_FORBIDDEN', 'RESOURCE_NOT_FOUND'].includes(error.code)) {
      clear(error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error', state.path, error.code === 'UNAUTHENTICATED' ? undefined : 'access');
    }
  }
  return {
    source, runtime,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    clear,
    async load(selected?: string, path = '') {
      clear('loading', path);
      const current = runtime.ticket();
      try {
        const context = await source.loadContext(selected, current.signal);
        if (runtime.isCurrent(current)) {
          const active = context.franchises.find(franchise => franchise.id === context.active_franchise_id);
          runtime.bind({ userId: context.user_id, organizationId: active?.organization.id ?? null,
            franchiseId: active?.id ?? null, permissions: JSON.stringify(active?.roles ?? []) });
          set({ status: 'loaded', context, path });
        }
      } catch (error) {
        if (runtime.isCurrent(current)) fail(error, path, null);
      }
    },
    // Route changes hide private UI while checking current authority, but are not
    // themselves revocations. Explicit loads and every changed/failed context still clear.
    async navigate(selected: string | undefined, path: string) {
      if (!state.context || !runtime.ticket().authority) return this.load(selected,path);
      const previous=state.context,current=runtime.ticket(),request=++navigation;
      set({...state,status:'loading',path});
      try {
        const context=await source.loadContext(selected,current.signal);
        if(request!==navigation||!runtime.isCurrent(current))return;
        if(JSON.stringify(context)!==JSON.stringify(previous)){
          clear('loading',path);
          const active=context.franchises.find(f=>f.id===context.active_franchise_id);
          runtime.bind({userId:context.user_id,organizationId:active?.organization.id??null,franchiseId:active?.id??null,permissions:JSON.stringify(active?.roles??[])});
        }
        set({status:'loaded',context,path});
      } catch(error) {
        if(request===navigation&&runtime.isCurrent(current))fail(error,path,previous);
      }
    },
    async revalidate(selected?: string) {
      const current = runtime.ticket();
      if (state.status !== 'loaded') return;
      try {
        const context = await source.loadContext(selected, current.signal);
        if (!runtime.isCurrent(current)) return;
        if (JSON.stringify(context) !== JSON.stringify(state.context)) {
          clear('loading');
          const active = context.franchises.find(f => f.id === context.active_franchise_id);
          runtime.bind({ userId: context.user_id, organizationId: active?.organization.id ?? null,
            franchiseId: active?.id ?? null, permissions: JSON.stringify(active?.roles ?? []) });
          set({ status: 'loaded', context, path: state.path });
        } else if (state.notice) set({ ...state, notice: undefined });
      } catch (error) {
        if (!runtime.isCurrent(current)) return;
        if (classifyFailure(error) === 'unreachable') set({ ...state, notice: UNREACHABLE_NOTICE });
        else denied(error);
      }
    },
    async command<T>(work: () => Promise<T>): Promise<T> {
      const current = runtime.ticket();
      try { const result = await work(); if (!runtime.isCurrent(current)) throw new ApiFailure('SCOPE_CHANGED', { kind: 'scope' }); return result; }
      catch (error) { if (runtime.isCurrent(current)) denied(error); throw error; }
    },
    async run<T>(work: (signal: AbortSignal) => Promise<T>, paint: (value: T) => void) {
      if (state.status !== 'loaded' || state.context?.state !== 'ready') return;
      const current = runtime.ticket();
      try {
        const result = await work(current.signal);
        if (runtime.isCurrent(current)) paint(result);
      } catch (error) {
        if (runtime.isCurrent(current)) fail(error);
      }
    },
  };
}
export type ScopeController = ReturnType<typeof createScopeController>;
