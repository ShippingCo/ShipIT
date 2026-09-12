export class OperatorError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
// Same-origin deployment/proxy. No bearer secrets in browser storage or logs.
export async function request<T>(path: string, options: { body?: unknown; key?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    const boot = await fetch('/auth/bootstrap', { credentials: 'include', cache: 'no-store', signal: options.signal });
    if (!boot.ok) throw new OperatorError('TEMPORARILY_UNAVAILABLE');
    const csrf = await boot.json() as { csrf_token: string };
    headers['X-CSRF-Token'] = csrf.csrf_token;
    headers['Content-Type'] = 'application/json';
    if (options.key) headers['Idempotency-Key'] = options.key;
  }
  const response = await fetch(path, { method: options.body === undefined ? 'GET' : 'POST', headers,
    credentials: 'include', cache: 'no-store', signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new OperatorError(result?.error?.code ?? 'TEMPORARILY_UNAVAILABLE');
  }
  return response.json() as Promise<T>;
}
