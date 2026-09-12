export type BrowserConfig = Readonly<{ dataMode: 'production' | 'demo'; apiBaseUrl: string; appVersion?: string }>;
const publicKeys = new Set(['VITE_DATA_MODE', 'VITE_API_BASE_URL', 'VITE_APP_VERSION']);

/** Only build/deployment input. Never read URL flags, browser storage or server configuration. */
export function parseBrowserConfig(env: Record<string, unknown>): BrowserConfig {
  const invalid = () => { throw new Error('Invalid browser-public configuration'); };
  if (Object.keys(env).some(key => key.startsWith('VITE_') && !publicKeys.has(key))) invalid();
  const dataMode = env.VITE_DATA_MODE ?? 'production';
  if (dataMode !== 'production' && dataMode !== 'demo') invalid();
  const apiBaseUrl = env.VITE_API_BASE_URL ?? '';
  if (typeof apiBaseUrl !== 'string') invalid();
  if (apiBaseUrl !== '') {
    let url: URL;
    try { url = new URL(apiBaseUrl as string); } catch { return invalid(); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== apiBaseUrl || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) invalid();
  }
  // Demo has no API destination. Separate demo origin/identities are deployment responsibilities.
  if (dataMode === 'demo' && apiBaseUrl !== '') invalid();
  const appVersion = env.VITE_APP_VERSION;
  if (appVersion !== undefined && (typeof appVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(appVersion))) invalid();
  return Object.freeze({ dataMode, apiBaseUrl, ...(appVersion === undefined ? {} : { appVersion }) }) as BrowserConfig;
}
