import type { OperatorContext } from '@shippingco/shared';
import { ApiFailure } from '../data-access/errors';
import { createScopeRuntime } from '../data-access/scope-runtime';
import { createOperatorDataSource } from './data-source';
import type { OperatorDataSource } from './data-source';
export type ScopeState = { status: 'loading' | 'signed_out' | 'error' | 'loaded'; context: OperatorContext | null; path: string };

/** #17's shell controller owns one generalized private lifetime for all future domain adapters. */
export function createScopeController(source: OperatorDataSource = createOperatorDataSource()) {
  const runtime = createScopeRuntime(error => clear(error instanceof ApiFailure && error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error'));
  let state: ScopeState = { status: 'loading', context: null, path: '' };
  const listeners = new Set<() => void>();
  const set = (next: ScopeState) => { state = next; listeners.forEach(listener => listener()); };
  function clear(status: ScopeState['status'] = 'loading', path = state.path) {
    runtime.invalidate(); set({ status, context: null, path });
  }
  function denied(error: unknown) {
    if (error instanceof ApiFailure && ['UNAUTHENTICATED', 'ACTION_FORBIDDEN', 'RESOURCE_NOT_FOUND'].includes(error.code)) {
      clear(error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error');
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
        if (runtime.isCurrent(current)) clear(error instanceof ApiFailure && error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error', path);
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
        if (runtime.isCurrent(current)) clear(error instanceof ApiFailure && error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error');
      }
    },
  };
}
export type ScopeController = ReturnType<typeof createScopeController>;
