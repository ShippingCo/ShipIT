import { createApiClient } from './api-client';
import { createCommandIntent, executeIntent, type CommandIntent } from './command-intent';
import { ApiFailure } from './errors';
import type { ScopeController } from '../operator/scope';
import { uuid, type Decoder } from './dto';
/** Transport/lifetime only. Domain adapters own paths, inputs and response projections. */
export function scopedApi(controller: ScopeController, api = createApiClient()) {
  const scope = controller.runtime.ticket(), a = scope.authority;
  if (!a?.organizationId || !a.franchiseId) throw new ApiFailure('SCOPE_CHANGED');
  const organization = uuid(a.organizationId), franchise = uuid(a.franchiseId);
  const query = new URLSearchParams({ organization_id: organization, franchise_id: franchise }).toString();
  const current = () => { if (!controller.runtime.isCurrent(scope)) throw new ApiFailure('SCOPE_CHANGED'); };
  async function accessFailure(error: unknown) {
    if (!controller.runtime.isCurrent(scope) || !(error instanceof ApiFailure)) return;
    if (error.code === 'UNAUTHENTICATED') controller.clear('signed_out');
    else if (['ACTION_FORBIDDEN', 'RESOURCE_NOT_FOUND'].includes(error.code)) await controller.revalidate(franchise);
  }
  return {
    scope, organization, franchise,
    path: (path: string) => path + '?' + query,
    intent(operation: string, path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST', expectedVersion?: number) {
      current(); return createCommandIntent({ operation, path, body, method, scope, expectedVersion });
    },
    async execute<T>(intent: CommandIntent, decode: Decoder<T>, validationFields: readonly string[] = []) {
      current();
      // 403/404 are controlled feature errors; only 401 invalidates the entire session.
      try { return await executeIntent(intent, controller.runtime.ticket, async (path, options) => decode(await api.request<unknown>(path, { ...options, validationFields }))); }
      catch (error) { await accessFailure(error); throw error; }
    },
    async read<T>(path: string, decode: Decoder<T>, signal?: AbortSignal) {
      current();
      const abort = new AbortController(), cancel = () => abort.abort();
      scope.signal.addEventListener('abort', cancel, { once: true });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) abort.abort();
      try {
        const value = decode(await api.request<unknown>(path, { signal: abort.signal }));
        current(); if (signal?.aborted) throw new ApiFailure('SCOPE_CHANGED'); return value;
      } catch (error) { await accessFailure(error); throw error; }
      finally { scope.signal.removeEventListener('abort', cancel); signal?.removeEventListener('abort', cancel); }
    },
  };
}
export type ScopedApi = ReturnType<typeof scopedApi>;
