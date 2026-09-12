import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBrowserConfig } from '../config/browser-config';
import { createApiClient } from '../data-access/api-client';
import { ApiFailure, recoveryFor } from '../data-access/errors';
import { createScopeRuntime } from '../data-access/scope-runtime';
import { createCommandIntent, executeIntent } from '../data-access/command-intent';
import { connectInvalidation } from '../data-access/invalidation';
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const correlation = '00000000-0000-4000-8000-000000000018';
const authority = { userId: 'synthetic-user', organizationId: 'synthetic-org', franchiseId: 'A', permissions: 'read_only' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
afterEach(() => vi.unstubAllGlobals());

describe('browser-public composition', () => {
  it('defaults to production and accepts only explicit demo or safe canonical API origins', () => {
    expect(parseBrowserConfig({})).toEqual({ dataMode: 'production', apiBaseUrl: '' });
    expect(parseBrowserConfig({ VITE_DATA_MODE: 'demo' }).dataMode).toBe('demo');
    expect(parseBrowserConfig({ VITE_API_BASE_URL: 'https://api.example.test', VITE_APP_VERSION: '1.2.3+test' }).apiBaseUrl).toBe('https://api.example.test');
    expect(parseBrowserConfig({ VITE_API_BASE_URL: 'http://localhost:3017' }).apiBaseUrl).toBe('http://localhost:3017');
    expect(Object.isFrozen(parseBrowserConfig({}))).toBe(true);
  });
  it.each(['https://user:secret@example.test', 'https://example.test/?token=secret', 'https://example.test/#secret', '//example.test', 'javascript:secret', 'http://remote.test', 'https://example.test/path', 'https://example.test/', 'https://EXAMPLE.test'])('rejects unsafe or noncanonical API base %s without echoing it', base => {
    expect(() => parseBrowserConfig({ VITE_API_BASE_URL: base })).toThrow('Invalid browser-public configuration');
    expect(() => createApiClient(base)).toThrow('Invalid browser-public configuration');
  });
  it('rejects unknown public settings, invalid mode/version and configured demo API', () => {
    for (const env of [{ VITE_DATA_MODE: 'typo' }, { VITE_UNKNOWN: 'secret' }, { VITE_APP_VERSION: 'secret/value' }, { VITE_DATA_MODE: 'demo', VITE_API_BASE_URL: 'https://api.example.test' }]) expect(() => parseBrowserConfig(env)).toThrow('Invalid browser-public configuration');
  });
});

describe('single production API client', () => {
  it('uses configured routing, credentials, no-store, no redirects, CSRF and exact mutation key', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ csrf_token: 'synthetic-csrf' })).mockResolvedValueOnce(json({ saved: true })); vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController(); const client = createApiClient('https://api.example.test');
    expect(await client.request<never>('/api/v1/onboarding', { method: 'POST', body: { display_name: 'Synthetic' }, key: 'same-intent', signal: abort.signal })).toEqual({ saved: true });
    expect(fetcher.mock.calls[0]).toEqual(['https://api.example.test/auth/bootstrap', expect.objectContaining({ method: 'GET', credentials: 'include', signal: abort.signal })]);
    expect(fetcher.mock.calls[1]).toEqual(['https://api.example.test/api/v1/onboarding', expect.objectContaining({ method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': 'synthetic-csrf', 'Idempotency-Key': 'same-intent' }, body: '{"display_name":"Synthetic"}' })]);
  });
  it('reads without bootstrap and supports approved future methods and 204', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ found: true })).mockResolvedValueOnce(json({ csrf_token: 'synthetic-csrf' })).mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetcher);
    const client = createApiClient(); await client.request<never>('/api/v1/operator-context');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.request<never>('/api/v1/test-adapter', { method: 'DELETE' })).toBeUndefined();
    expect(fetcher.mock.calls[2][1].method).toBe('DELETE');
  });
  it('projects only known code, server correlation and declared validation fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'VALIDATION_FAILED', message: 'secret sql body', correlation_id: correlation,
      details: [{ field: 'display_name', code: 'REQUIRED', value: 'secret' }, { field: 'secret', code: 'REQUIRED' }, { field: '$', code: 'secret' }], stack: 'secret' } }, 422)));
    const failure = await createApiClient().request<never>('/api/v1/operator-context', { validationFields: ['display_name'] }).catch(e => e as ApiFailure);
    expect(failure).toMatchObject({ code: 'VALIDATION_FAILED', correlationId: correlation, details: [{ field: 'display_name', code: 'REQUIRED' }] });
    expect(JSON.stringify(failure)).not.toContain('secret'); expect(failure.message).toBe('VALIDATION_FAILED');
  });
  it.each([401, 403, 404, 408, 429, 500, 503])('handles non-JSON HTTP %s without raw response leakage', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private raw proxy detail', { status })));
    const failure = await createApiClient().request<never>('/api/v1/operator-context').catch(e => e as ApiFailure);
    expect(failure).toBeInstanceOf(ApiFailure); expect(failure.status).toBe(status); expect(JSON.stringify(failure)).not.toContain('private');
    if (status === 401) expect(recoveryFor(failure, false)).toBe('reauthenticate');
  });
  it.each([
    [401, 'UNAUTHENTICATED', 'reauthenticate'], [403, 'ACTION_FORBIDDEN', 'unavailable'], [404, 'RESOURCE_NOT_FOUND', 'unavailable'],
    [408, 'REQUEST_TIMEOUT', 'uncertain'], [409, 'VERSION_CONFLICT', 'refresh'], [409, 'IDEMPOTENCY_CONFLICT', 'conflict'],
    [409, 'IDEMPOTENCY_IN_PROGRESS', 'pending'], [422, 'VALIDATION_FAILED', 'validate'], [429, 'RATE_LIMITED', 'retry'],
    [500, 'INTERNAL_ERROR', 'uncertain'], [503, 'TEMPORARILY_UNAVAILABLE', 'uncertain'],
  ])('classifies mutation HTTP %s %s as %s without replay', async (status, code, recovery) => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ csrf_token: 'synthetic-csrf' })).mockResolvedValueOnce(json({ error: { code, details: [{ field: '$', code: 'REQUIRED' }] } }, status as number, { 'Retry-After': '60' })); vi.stubGlobal('fetch', fetcher);
    const failure = await createApiClient().request<never>('/api/v1/onboarding', { body: {}, key: 'intent' }).catch(e => e as ApiFailure);
    expect(recoveryFor(failure, true)).toBe(recovery); expect(fetcher).toHaveBeenCalledTimes(2);
    if (status !== 422) expect(failure.details).toEqual([]);
    if (status === 429) expect(failure.retryAfterSeconds).toBe(60);
  });
  it('sanitizes network exceptions and malformed successes without manufacturing committed results', async () => {
    const client = createApiClient(); const fetcher = vi.fn().mockRejectedValueOnce(new Error('secret network body')).mockResolvedValueOnce(json({ csrf_token: 'synthetic-csrf' })).mockResolvedValueOnce(new Response('private invalid success')); vi.stubGlobal('fetch', fetcher);
    const read = await client.request<never>('/api/v1/operator-context').catch(e => e as ApiFailure);
    expect(read.kind).toBe('network'); expect(read.message).not.toContain('secret'); expect(recoveryFor(read, false)).toBe('retry');
    const mutation = await client.request<never>('/api/v1/onboarding', { body: {} }).catch(e => e as ApiFailure);
    expect(mutation.kind).toBe('protocol'); expect(recoveryFor(mutation, true)).toBe('uncertain');
  });
  it('cancellation during ignored bootstrap prevents sending the mutation; after dispatch remains uncertain', async () => {
    const slow = deferred<Response>(), abort = new AbortController();
    const fetcher = vi.fn().mockReturnValueOnce(slow.promise); vi.stubGlobal('fetch', fetcher);
    const pending = createApiClient().request<never>('/api/v1/onboarding', { body: {}, signal: abort.signal }).catch(e => e as ApiFailure);
    abort.abort(); slow.resolve(json({ csrf_token: 'synthetic-csrf' }));
    expect(recoveryFor(await pending, true)).toBe('cancelled'); expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = deferred<Response>(), after = new AbortController(); fetcher.mockResolvedValueOnce(json({ csrf_token: 'synthetic-csrf' })).mockReturnValueOnce(sent.promise);
    const uncertain = createApiClient().request<never>('/api/v1/onboarding', { body: {}, signal: after.signal }).catch(e => e as ApiFailure);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3)); after.abort(); sent.resolve(json({ committed: true }));
    expect(recoveryFor(await uncertain, true)).toBe('uncertain');
  });
  it('never sends to an arbitrary destination or continues after invalid bootstrap', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ csrf_token: { secret: true } })); vi.stubGlobal('fetch', fetcher);
    for (const path of ['https://evil.test/api/v1/x', '//evil.test/api/v1/x', '/api/v1/../x', '/api/v1/%2e%2e/x']) await expect(createApiClient().request<never>(path)).rejects.toBeInstanceOf(ApiFailure);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(createApiClient().request<never>('/api/v1/onboarding', { body: {} })).rejects.toMatchObject({ kind: 'protocol', dispatched: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('private query and immutable command lifetime', () => {
  it('purges cache/cleanup before B and revisited A; rejects ignored cancellation and stale same-query results', async () => {
    const runtime = createScopeRuntime(); runtime.bind(authority); const query = { resource: 'synthetic-query', parameters: { cursor: 'opaque', filter: 'open' } };
    await runtime.query(query, async () => 'A private', () => {}); expect(runtime.read(query)).toBe('A private');
    const cleanup = vi.fn(); runtime.onInvalidate(cleanup); const old = runtime.ticket(), late = deferred<string>(), paint = vi.fn();
    const pending = runtime.query(query, () => late.promise, paint); runtime.invalidate(); runtime.bind({ ...authority, franchiseId: 'B' });
    expect(old.signal.aborted).toBe(true); expect(cleanup).toHaveBeenCalledOnce(); expect(runtime.read(query)).toBeUndefined();
    await runtime.query(query, async () => 'B private', paint); late.resolve('A stale'); await pending; expect(paint).toHaveBeenCalledExactlyOnceWith('B private');
    runtime.invalidate(); runtime.bind(authority); expect(runtime.read(query)).toBeUndefined();
    const stale = deferred<string>(); const first = runtime.query(query, () => stale.promise, paint);
    await runtime.query(query, async () => 'fresh A', paint); stale.resolve('stale A'); await first; expect(runtime.read(query)).toBe('fresh A');
  });
  it('isolates identity/permission changes and rejects late errors from an old scope', async () => {
    const deny = vi.fn(), runtime = createScopeRuntime(deny); runtime.bind(authority);
    const old = deferred<string>(); const pending = runtime.query({ resource: 'test' }, () => old.promise.then(() => { throw new ApiFailure('UNAUTHENTICATED'); }), vi.fn());
    runtime.invalidate(); runtime.bind({ ...authority, userId: 'other', permissions: 'operator' }); old.resolve(''); await pending;
    expect(deny).not.toHaveBeenCalled(); expect(runtime.read({ resource: 'test' })).toBeUndefined();
    await runtime.query({ resource: 'test' }, async () => { throw new ApiFailure('UNAUTHENTICATED'); }, vi.fn()); expect(deny).toHaveBeenCalledOnce();
    expect(runtime.ticket().authority).toBeNull();
    runtime.bind(authority); expect(runtime.read({ resource: 'test' })).toBeUndefined();
  });
  it('retries exact intent after uncertainty but refuses replay after identity/scope generation changes', async () => {
    const runtime = createScopeRuntime(); runtime.bind(authority);
    const body = { display_name: 'Synthetic', expected_version: 2 };
    const intent = createCommandIntent({ operation: 'test:v1', path: '/api/v1/test-adapter', body, expectedVersion: 2, scope: runtime.ticket() });
    body.display_name = 'Changed'; const send = vi.fn().mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'network', dispatched: true })).mockResolvedValueOnce({ saved: true });
    await expect(executeIntent(intent, runtime.ticket, send)).rejects.toMatchObject({ kind: 'network' });
    expect(await executeIntent(intent, runtime.ticket, send)).toEqual({ saved: true });
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(send.mock.calls[0][1].body.display_name).toBe('Synthetic'); expect(Object.isFrozen(intent)).toBe(true);
    runtime.invalidate(); runtime.bind({ ...authority, userId: 'other-user' });
    await expect(executeIntent(intent, runtime.ticket, send)).rejects.toMatchObject({ code: 'SCOPE_CHANGED' }); expect(send).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it('never publishes a command result after scope changes and enforces expected-version consistency', async () => {
    const runtime = createScopeRuntime(); runtime.bind(authority); const response = deferred<unknown>();
    const intent = createCommandIntent({ operation: 'test:v1', path: '/api/v1/test-adapter', body: {}, scope: runtime.ticket() });
    const pending = executeIntent(intent, runtime.ticket, () => response.promise);
    runtime.invalidate(); runtime.bind({ ...authority, franchiseId: 'B' }); response.resolve({ saved: true });
    await expect(pending).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    expect(() => createCommandIntent({ operation: 'test:v1', path: '/api/v1/test-adapter', body: {}, scope: runtime.ticket(), expectedVersion: 2 })).toThrow('VALIDATION_FAILED');
  });
  it('broadcasts only payload-free invalidation and closes its channel; missing channel needs no storage fallback', () => {
    const sent: unknown[] = []; let receiver!: { onmessage: (event: { data: unknown }) => void }; const close = vi.fn();
    vi.stubGlobal('BroadcastChannel', class { onmessage = (_event: { data: unknown }) => {}; constructor() { receiver = { onmessage: event => this.onmessage(event) }; } postMessage(value: unknown) { sent.push(value); } close = close; });
    const clear = vi.fn(), channel = connectInvalidation(clear); channel.publish(); expect(sent).toEqual(['invalidate']);
    receiver.onmessage({ data: { user: 'secret' } }); expect(clear).not.toHaveBeenCalled();
    receiver.onmessage({ data: 'invalidate' }); expect(clear).toHaveBeenCalledOnce(); expect(sent).toHaveLength(1); channel.close(); expect(close).toHaveBeenCalledOnce();
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('blocked channel'); } });
    expect(() => connectInvalidation(clear).publish()).not.toThrow();
    vi.stubGlobal('BroadcastChannel', undefined); expect(() => connectInvalidation(clear).publish()).not.toThrow(); expect(localStorage.length).toBe(0);
  });
});
