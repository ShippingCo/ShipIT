import type { OperatorContext } from '@shippingco/shared';
import { OperatorError, request } from './api';
export type ScopeState = { status: 'loading' | 'signed_out' | 'error' | 'loaded'; context: OperatorContext | null; path: string };

/** One generation for all scope-bound work. Abort is an optimization; generation is the correctness guard. */
export function createScopeController() {
  let generation = 0, abort = new AbortController();
  let state: ScopeState = { status: 'loading', context: null, path: '' };
  const listeners = new Set<() => void>();
  const set = (next: ScopeState) => { state = next; listeners.forEach(listener => listener()); };
  function clear(status: ScopeState['status'] = 'loading', path = state.path) {
    generation++; abort.abort(); abort = new AbortController(); set({ status, context: null, path });
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    clear,
    async load(selected?: string, path = '') {
      clear('loading', path);
      const current = generation;
      try {
        const context = await request<OperatorContext>('/api/v1/operator-context' + (selected ? `/franchises/${encodeURIComponent(selected)}` : ''), { signal: abort.signal });
        if (current === generation) set({ status: 'loaded', context, path });
      } catch (error) {
        if (current === generation) clear(error instanceof OperatorError && error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error', path);
      }
    },
    async run<T>(work: (signal: AbortSignal) => Promise<T>, paint: (value: T) => void) {
      if (state.status !== 'loaded' || state.context?.state !== 'ready') return;
      const current = generation;
      try {
        const result = await work(abort.signal);
        if (current === generation) paint(result);
      } catch (error) {
        if (current === generation) clear(error instanceof OperatorError && error.code === 'UNAUTHENTICATED' ? 'signed_out' : 'error');
      }
    },
  };
}
