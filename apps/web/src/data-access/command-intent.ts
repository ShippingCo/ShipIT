import type { HttpMethod } from './api-client';
import { ApiFailure } from './errors';
import type { ScopeTicket } from './scope-runtime';
export type CommandIntent = Readonly<{ operation: string; method: Exclude<HttpMethod, 'GET'>; path: string;
  bodyJson: string; key: string; expectedVersion?: number; scope: ScopeTicket }>;

/** Owning adapter validates the body. Snapshot exact intent; never retain a mutable caller object. */
export function createCommandIntent(input: { operation: string; method?: Exclude<HttpMethod, 'GET'>; path: string;
  body: unknown; key?: string; expectedVersion?: number; scope: ScopeTicket }): CommandIntent {
  if (!input.scope.authority) throw new ApiFailure('SCOPE_CHANGED', { kind: 'scope' });
  if (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      (input.body as { expected_version?: number } | null)?.expected_version !== input.expectedVersion)) throw new ApiFailure('VALIDATION_FAILED');
  return Object.freeze({ operation: input.operation, method: input.method ?? 'POST', path: input.path,
    bodyJson: JSON.stringify(input.body), key: input.key ?? crypto.randomUUID(), expectedVersion: input.expectedVersion, scope: input.scope });
}
export async function executeIntent<T>(intent: CommandIntent, current: () => ScopeTicket,
  send: (path: string, options: { method: Exclude<HttpMethod, 'GET'>; body: unknown; key: string; signal: AbortSignal }) => Promise<T>): Promise<T> {
  const assertScope = () => { if (current() !== intent.scope || intent.scope.signal.aborted) throw new ApiFailure('SCOPE_CHANGED', { kind: 'scope' }); };
  assertScope();
  const result = await send(intent.path, { method: intent.method, body: JSON.parse(intent.bodyJson), key: intent.key, signal: intent.scope.signal });
  assertScope(); return result;
}
