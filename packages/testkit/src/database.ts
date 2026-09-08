export interface TestDatabaseEnvironment {
  NODE_ENV?: string;
  TEST_DATABASE_URL?: string;
  TEST_DATABASE_IDENTITY?: string;
}
export interface TestDatabasePolicy {
  // Trusted runner configuration, never inferred from the submitted URL.
  allowedHosts: readonly string[];
  forbiddenHosts: readonly string[];
  forbiddenIdentities: readonly string[];
}
const localPolicy: TestDatabasePolicy = {
  allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  forbiddenHosts: [], forbiddenIdentities: ['db_production', 'db_staging', 'db_demo', 'db_developer'],
};
const hostKey = (host: string) => host.toLowerCase().replace(/\.$/, '');
export function validateTestDatabaseConfig(env: TestDatabaseEnvironment, policy: TestDatabasePolicy = localPolicy) {
  const refuse = (): never => { throw new Error('UNSAFE_TEST_DATABASE_CONFIGURATION'); };
  if (env.NODE_ENV !== 'test' || !env.TEST_DATABASE_URL || !env.TEST_DATABASE_IDENTITY) refuse();
  const identity = env.TEST_DATABASE_IDENTITY!;
  if (!/^db_test(?:_[a-z0-9]+)?$/.test(identity) || policy.forbiddenIdentities.includes(identity)) refuse();
  let url: URL;
  try { url = new URL(env.TEST_DATABASE_URL!); } catch { return refuse(); }
  // Query options can override pg's host/database. #10 must review any extension.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash ||
      url.href.includes('?') || url.href.includes('#') || url.hostname.includes('%')) refuse();
  const hostname = hostKey(url.hostname);
  const database = url.pathname.slice(1);
  if (!/^[a-z][a-z0-9_]*_test(?:_[a-z0-9]+)?$/.test(database) || database.length > 63) refuse();
  if (/(^|[._-])(prod|production|staging)([._-]|$)/.test(hostname) ||
      policy.forbiddenHosts.map(hostKey).includes(hostname) ||
      !policy.allowedHosts.map(hostKey).includes(hostname)) refuse();
  return Object.freeze({ connectionString: url.href, hostname, database, identity });
}
