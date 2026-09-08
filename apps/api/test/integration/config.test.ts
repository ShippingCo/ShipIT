import { describe, it, expect, vi } from 'vitest';
import { parseEnvironment, ConfigurationError } from '../../src/env.ts';
import { developerSecretResolver } from '../../src/secrets.ts';
import { startRuntime } from '../../src/runtime.ts';
import { syntheticEnv } from '../support.ts';

describe('fail-closed runtime configuration', () => {
  it('validates and freezes one mode mapping with synthetic input', () => {
    const config = parseEnvironment(syntheticEnv);
    expect(config.environment).toBe('developer'); expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
    for (const mode of ['demo', 'staging', 'production']) {
      expect(parseEnvironment({ ...syntheticEnv, NODE_ENV: mode, DATABASE_SECRET_REF: 'managed/db/version-1',
        DATABASE_TLS_MODE: 'verify-full', ALLOWED_ORIGINS: 'https://console.example.test' }).environment).toBe(mode);
    }
  });
  it.each(Object.keys(syntheticEnv))('rejects missing %s', field => {
    expect(() => parseEnvironment({ ...syntheticEnv, [field]: undefined })).toThrow(ConfigurationError);
  });
  it.each([
    ['NODE_ENV', 'test'], ['NODE_ENV', 'developer'], ['NODE_ENV', '__proto__'], ['PORT', '0'], ['PORT', '65536'], ['PORT', '1e3'],
    ['PORT', ' 3000'], ['LOG_LEVEL', 'SYN_SECRET'], ['HOST', 'example.test'], ['TRUSTED_PROXY_HOPS', '-1'], ['TRUSTED_PROXY_HOPS', '6'],
    ['TRUSTED_PROXY_HOPS', '1'], ['DATABASE_TLS_MODE', 'prefer'], ['DATABASE_SECRET_REF', 'postgresql://SYN_SECRET@host/db'],
    ['DATABASE_CA_PEM', 'SYN_SECRET'], ['ALLOWED_ORIGINS', '*'], ['ALLOWED_ORIGINS', 'https://user:pass@example.test'],
    ['ALLOWED_ORIGINS', 'https://example.test/'], ['ALLOWED_ORIGINS', 'https://example.test/path'],
    ['ALLOWED_ORIGINS', 'https://example.test?'], ['ALLOWED_ORIGINS', 'https://example.test#'],
    ['ALLOWED_ORIGINS', 'https://*.example.test'], ['ALLOWED_ORIGINS', 'null'], ['ALLOWED_ORIGINS', 'http://remote.example.test'],
    ['ALLOWED_ORIGINS', 'http://localhost:5173,'], ['TRUSTED_PROXY_ADDRESSES', '127.0.0.1'],
  ])('rejects malformed %s (%s) without rejected values', (field, value) => {
    try { parseEnvironment({ ...syntheticEnv, [field]: value }); expect.fail('accepted invalid configuration'); }
    catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(JSON.stringify(error)).not.toContain('SYN_SECRET');
      expect((error as ConfigurationError).issues.every(issue => Object.keys(issue).sort().join(',') === 'code,field')).toBe(true);
    }
  });
  it('rejects malformed certificate content before resolving or connecting', () => {
    expect(() => parseEnvironment({ ...syntheticEnv, DATABASE_TLS_MODE: 'verify-full',
      DATABASE_CA_PEM: '-----BEGIN CERTIFICATE-----\nSYN_CA_SECRET\n-----END CERTIFICATE-----' })).toThrow(ConfigurationError);
  });
  it('rejects local resolution, HTTP origins and disabled TLS outside developer', async () => {
    for (const mode of ['demo', 'staging', 'production']) {
      expect(() => parseEnvironment({ ...syntheticEnv, NODE_ENV: mode })).toThrow(ConfigurationError);
      const config = parseEnvironment({ ...syntheticEnv, NODE_ENV: mode, DATABASE_SECRET_REF: 'managed/version-1',
        ALLOWED_ORIGINS: 'https://example.test', DATABASE_TLS_MODE: 'verify-full' });
      expect(() => developerSecretResolver(config, 'SYN_SECRET')).toThrow(ConfigurationError);
      await expect(startRuntime({ config, secretResolver: { kind: 'developer-local', resolve: async () => 'SYN_SECRET' } })).rejects.toThrow(ConfigurationError);
      expect(() => parseEnvironment({ ...syntheticEnv, NODE_ENV: mode, LOCAL_DATABASE_URL: 'SYN_SECRET' })).toThrow(ConfigurationError);
    }
  });
  it('local resolver requires the exact isolated developer database and identity', async () => {
    const config = parseEnvironment(syntheticEnv);
    for (const value of [undefined, 'SYN_SECRET', 'postgresql://db_production:SYN_SECRET@localhost/production',
      'postgresql://db_developer:SYN_SECRET@remote.test/shipit_developer', 'postgresql://db_developer:SYN_SECRET@localhost/shipit_developer?sslmode=disable']) {
      expect(() => developerSecretResolver(config, value)).toThrow(ConfigurationError);
    }
    const value = 'postgresql://db_developer:SYN_LOCAL_PASSWORD@127.0.0.1/shipit_developer';
    expect(await developerSecretResolver(config, value).resolve(config.databaseSecretRef, new AbortController().signal)).toBe(value);
  });
  it('managed resolver failures are sanitized before creating resources', async () => {
    const config = parseEnvironment({ ...syntheticEnv, DATABASE_SECRET_REF: 'managed/version-1' });
    try {
      await startRuntime({ config, secretResolver: { kind: 'managed', resolve: async () => { throw new Error('SYN_SECRET'); } } });
      expect.fail('accepted failed resolution');
    } catch (error) { expect(error).toBeInstanceOf(ConfigurationError); expect(String(error) + JSON.stringify(error)).not.toContain('SYN_SECRET'); }
  });
});

it('secret resolution timeout aborts the resolver and fails without secret-bearing errors', async () => {
  vi.useFakeTimers();
  let receivedSignal: AbortSignal | undefined;
  const config = parseEnvironment({ ...syntheticEnv, DATABASE_SECRET_REF: 'managed/version-1' });
  try {
    const pending = startRuntime({ config, secretResolver: { kind: 'managed', resolve: async (_reference, signal) => {
      receivedSignal = signal; return new Promise<string>(() => {});
    } } });
    const rejected = expect(pending).rejects.toThrow('CONFIGURATION_INVALID');
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(receivedSignal?.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});
