import { ApiFailure } from './errors';
export type AuthorityContext = Readonly<{ userId: string; organizationId: string | null; franchiseId: string | null; permissions: string }>;
export type ScopeTicket = Readonly<{ generation: number; authority: AuthorityContext | null; signal: AbortSignal }>;
export type PrivateQuery = Readonly<{ resource: string; parameters?: Readonly<Record<string, string | number | boolean | null>> }>;

/** Ephemeral only. This is a client lifetime guard; it never grants server authorization. */
export function createScopeRuntime(onFailure: (error: unknown) => void = () => {}) {
  let generation = 0;
  let abort = new AbortController();
  let ticket: ScopeTicket = Object.freeze({ generation, authority: null, signal: abort.signal });
  const cache = new Map<string, unknown>(), requests = new Map<string, symbol>();
  const cleanup = new Set<() => void>();
  function invalidate() {
    generation++; abort.abort(); abort = new AbortController(); cache.clear(); requests.clear();
    ticket = Object.freeze({ generation, authority: null, signal: abort.signal });
    const disposers = [...cleanup]; cleanup.clear();
    disposers.forEach(dispose => { try { dispose(); } catch { /* Cleanup must never prevent private-state invalidation. */ } });
  }
  function key(query: PrivateQuery) {
    const a = ticket.authority;
    if (!a) throw new ApiFailure('SCOPE_CHANGED', { kind: 'scope' });
    return JSON.stringify([ticket.generation, a.userId, a.organizationId, a.franchiseId, a.permissions,
      query.resource, Object.entries(query.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  }
  return {
    invalidate,
    ticket: () => ticket,
    isCurrent: (candidate: ScopeTicket) => candidate === ticket && !candidate.signal.aborted,
    bind(authority: AuthorityContext) {
      if (ticket.authority) invalidate();
      ticket = Object.freeze({ generation, authority: Object.freeze({ ...authority }), signal: abort.signal });
    },
    onInvalidate(dispose: () => void) { cleanup.add(dispose); return () => { cleanup.delete(dispose); }; },
    read<T>(query: PrivateQuery): T | undefined { return cache.get(key(query)) as T | undefined; },
    async query<T>(query: PrivateQuery, work: (signal: AbortSignal) => Promise<T>, paint: (result: T) => void) {
      const current = ticket, queryKey = key(query), requestId = Symbol(); requests.set(queryKey, requestId);
      let result: T;
      try { result = await work(current.signal); } catch (error) {
        if (current === ticket && !current.signal.aborted && requests.get(queryKey) === requestId) {
          invalidate(); onFailure(error);
        }
        return;
      }
      if (current === ticket && !current.signal.aborted && requests.get(queryKey) === requestId) {
        requests.delete(queryKey);
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(queryKey, result); paint(result);
      }
    },
  };
}
