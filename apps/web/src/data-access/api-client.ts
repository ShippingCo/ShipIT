import { browserConfig } from '../config';
import { parseBrowserConfig } from '../config/browser-config';
import { ApiFailure, responseFailure } from './errors';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RequestOptions = { method?: HttpMethod; body?: unknown; key?: string; signal?: AbortSignal; validationFields?: readonly string[] };
export function createApiClient(apiBaseUrl = browserConfig.apiBaseUrl) {
  parseBrowserConfig({ VITE_API_BASE_URL: apiBaseUrl });
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // Paths belong to domain adapters, never arbitrary URLs supplied by a screen/persona.
    if (!/^\/(api\/v1|auth)\/[A-Za-z0-9/?=&%._~-]+$/.test(path) || path.includes('..') || /%2e|%2f|%5c/i.test(path)) throw new ApiFailure('MALFORMED_REQUEST');
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const mutation = method !== 'GET';
    const headers: Record<string, string> = { Accept: 'application/json' };
    let dispatched = false;
    try {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      if (mutation) {
        const boot = await request<{ csrf_token: string }>('/auth/bootstrap', { signal: options.signal });
        if (typeof boot?.csrf_token !== 'string' || !/^[A-Za-z0-9._-]{1,512}$/.test(boot.csrf_token)) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol' });
        headers['X-CSRF-Token'] = boot.csrf_token;
        headers['Content-Type'] = 'application/json';
        if (options.key) headers['Idempotency-Key'] = options.key;
      }
      // A signal can be cancelled while the CSRF request is in flight even if fetch ignores abort.
      if (options.signal?.aborted) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'aborted' });
      dispatched = mutation;
      const response = await fetch(apiBaseUrl + path, { method, headers, body, signal: options.signal,
        credentials: 'include', cache: 'no-store', redirect: 'error' });
      let result: unknown;
      try { result = response.status === 204 ? undefined : await response.json(); } catch {
        if (!response.ok) throw responseFailure(response.status, null, response.headers.get('retry-after'), [], dispatched);
        throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol', dispatched });
      }
      if (!response.ok) throw responseFailure(response.status, result, response.headers.get('retry-after'), options.validationFields ?? ['$'], dispatched);
      if (options.signal?.aborted) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'aborted', dispatched });
      return result as T;
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: options.signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'aborted' : 'network', dispatched });
    }
  }
  return { request };
}
