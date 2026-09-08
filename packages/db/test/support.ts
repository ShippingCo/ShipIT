import { randomBytes } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import pg, { type QueryResultRow } from 'pg';
import { validateTestDatabaseConfig, type TestDatabasePolicy } from '@shippingco/testkit';
import { createDatabaseConfig, createPool, pgOptions, runMigrations, type DatabasePool } from '../src/index.ts';
import { closeClient } from '../src/shutdown.ts';

// This policy is trusted code, never derived from a submitted connection URL.
const policy: TestDatabasePolicy = {
  allowedHosts: ['localhost', '127.0.0.1', '[::1]', 'postgres'],
  forbiddenHosts: [],
  forbiddenIdentities: ['db_production', 'db_staging', 'db_demo', 'db_developer'],
};

function bootstrapConfiguration() {
  try {
    const validated = validateTestDatabaseConfig(process.env, policy);
    const url = new URL(validated.connectionString);
    if (!url.username || !url.password) throw new Error('DB_TEST_CONFIG_INVALID');
    return validated;
  }
  catch { throw new Error('DB_TEST_CONFIG_INVALID'); }
}

export function guardTestConnectionString(connectionString: string) {
  try {
    return validateTestDatabaseConfig({ NODE_ENV: 'test', TEST_DATABASE_URL: connectionString,
      TEST_DATABASE_IDENTITY: 'db_test_1' }, policy);
  } catch { throw new Error('DB_TEST_CONFIG_INVALID'); }
}
const guard = guardTestConnectionString;

async function withAdmin<T>(operation: (client: pg.Client) => Promise<T>, connectionString?: string): Promise<T> {
  const target = connectionString ?? bootstrapConfiguration().connectionString;
  guard(target);
  let client: pg.Client;
  try {
    client = new pg.Client(pgOptions(createDatabaseConfig({ connectionString: target, environment: 'test',
      tls: { mode: 'disable' }, connectionTimeoutMs: 2000, statementTimeoutMs: 4000,
      queryTimeoutMs: 5000, applicationName: 'shipit_test_bootstrap' })));
  } catch { throw new Error('DB_TEST_CONFIG_INVALID'); }
  // pg emits an error on an idle connection after an outage. The awaited operation
  // still rejects; raw driver errors must never become unhandled error telemetry.
  client.on('error', () => {});
  try {
    await client.connect();
    return await operation(client);
  } catch { throw new Error('DB_TEST_ADMIN_OPERATION_FAILED'); }
  finally { await closeClient(client); }
}

export async function preflightTestDatabase(): Promise<void> {
  const configuration = bootstrapConfiguration();
  try {
    await withAdmin(async (client) => {
      const result = await client.query<{ database: string; allowed: boolean }>(
        `SELECT current_database() AS database,
          (rolsuper OR (rolcreatedb AND rolcreaterole)) AS allowed
         FROM pg_roles WHERE rolname = current_user`);
      if (result.rows[0]?.database !== configuration.database || !result.rows[0].allowed) {
        throw new Error('DB_TEST_BOOTSTRAP_IDENTITY_INVALID');
      }
    }, configuration.connectionString);
  } catch { throw new Error('DB_TEST_CONNECTION_FAILED'); }
}

interface Resource {
  database: string;
  migrationRole: string;
  runtimeRole: string;
}

function checkResource(resource: Resource): void {
  const match = /^shipit_([a-f0-9]{16})_test_1$/.exec(resource.database);
  if (!match || resource.migrationRole !== `shipit_${match[1]}_migration_test_1` ||
      resource.runtimeRole !== `shipit_${match[1]}_runtime_test_1`) {
    throw new Error('DB_TEST_RESOURCE_INVALID');
  }
}

function resourceUrl(resource: Resource, username?: string, password?: string): string {
  checkResource(resource);
  const url = new URL(bootstrapConfiguration().connectionString);
  url.pathname = `/${resource.database}`;
  if (username !== undefined) url.username = username;
  if (password !== undefined) url.password = password;
  guard(url.href);
  return url.href;
}

// Identifiers are exclusively server-generated, correlated with the registered
// resource and checked above. Values and credentials always use bound parameters.
function identifier(value: string): string {
  if (!/^shipit_[a-f0-9]{16}_(?:(?:migration|runtime)_)?test_1$/.test(value)) {
    throw new Error('DB_TEST_RESOURCE_INVALID');
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function cleanupResource(resource: Resource): Promise<void> {
  checkResource(resource);
  guard(resourceUrl(resource));
  await withAdmin(async (client) => {
    guard(resourceUrl(resource));
    await client.query(`DROP DATABASE IF EXISTS ${identifier(resource.database)} WITH (FORCE)`);
    for (const role of [resource.runtimeRole, resource.migrationRole]) {
      guard(resourceUrl(resource));
      await client.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
    }
    const remaining = await client.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM pg_database WHERE datname = $1)
        + (SELECT count(*) FROM pg_roles WHERE rolname = ANY($2::text[])) AS count`,
      [resource.database, [resource.migrationRole, resource.runtimeRole]]);
    if (remaining.rows[0]?.count !== '0') throw new Error('DB_TEST_CLEANUP_INCOMPLETE');
  });
}

export async function cleanupRegisteredResources(registryPath: string): Promise<void> {
  bootstrapConfiguration();
  let records: string;
  try { records = await readFile(registryPath, 'utf8'); }
  catch { throw new Error('DB_TEST_REGISTRY_READ_FAILED'); }
  const failures: Error[] = [];
  for (const line of records.split('\n').filter(Boolean)) {
    try {
      const record: unknown = JSON.parse(line);
      if (!record || typeof record !== 'object' ||
          !('database' in record) || typeof record.database !== 'string' ||
          !('migrationRole' in record) || typeof record.migrationRole !== 'string' ||
          !('runtimeRole' in record) || typeof record.runtimeRole !== 'string') {
        throw new Error('DB_TEST_RESOURCE_INVALID');
      }
      await cleanupResource({ database: record.database, migrationRole: record.migrationRole,
        runtimeRole: record.runtimeRole });
    } catch { failures.push(new Error('DB_TEST_CLEANUP_FAILED')); }
  }
  if (failures.length) throw new AggregateError(failures, 'DB_TEST_CLEANUP_FAILED');
}

export interface DisposableDatabase {
  readonly database: string;
  readonly migrationRole: string;
  readonly runtimeRole: string;
  migrationConfig(): ReturnType<typeof createDatabaseConfig>;
  runtimePool(overrides?: { maxConnections?: number; connectionTimeoutMs?: number;
    statementTimeoutMs?: number; queryTimeoutMs?: number }): DatabasePool;
  ownerPool(): DatabasePool;
  migrate(options?: { dir?: string; count?: number }): Promise<{ applied: number }>;
  prepareTenancy(): Promise<void>;
  prepareFixtures(): Promise<void>;
  setAvailable(available: boolean): Promise<void>;
  terminateBackend(pid: number): Promise<void>;
  adminQuery<Row extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<pg.QueryResult<Row>>;
  close(): Promise<void>;
}

export async function provisionDatabase(t: TestContext): Promise<DisposableDatabase> {
  bootstrapConfiguration();
  const token = randomBytes(8).toString('hex');
  const resource: Resource = { database: `shipit_${token}_test_1`,
    migrationRole: `shipit_${token}_migration_test_1`, runtimeRole: `shipit_${token}_runtime_test_1` };
  checkResource(resource);
  const migrationPassword = randomBytes(24).toString('hex');
  const runtimePassword = randomBytes(24).toString('hex');
  const pools = new Set<DatabasePool>();
  let closed = false;
  const validate = () => { guard(resourceUrl(resource)); };
  const configuration = (role: string, password: string) => {
    validate();
    return createDatabaseConfig({ connectionString: resourceUrl(resource, role, password),
      environment: 'test', tls: { mode: 'disable' }, maxConnections: 3,
      connectionTimeoutMs: 1000, idleTimeoutMs: 1000, statementTimeoutMs: 3000,
      queryTimeoutMs: 4000, idleTransactionTimeoutMs: 5000, applicationName: 'shipit_integration' });
  };
  const trackedPool = (config: ReturnType<typeof createDatabaseConfig>): DatabasePool => {
    guard(config.connectionString);
    const underlying = createPool(config);
    const pool: DatabasePool = {
      query: (sql, params) => { guard(config.connectionString); return underlying.query(sql, params); },
      connect: () => { guard(config.connectionString); return underlying.connect(); },
      close: () => underlying.close(),
      stats: () => underlying.stats(),
    };
    pools.add(pool);
    return pool;
  };
  const handle: DisposableDatabase = {
    ...resource,
    migrationConfig() { return configuration(resource.migrationRole, migrationPassword); },
    runtimePool(overrides = {}) {
      validate();
      return trackedPool(createDatabaseConfig({ connectionString: resourceUrl(resource, resource.runtimeRole, runtimePassword),
        environment: 'test', tls: { mode: 'disable' }, maxConnections: 3,
        connectionTimeoutMs: 1000, idleTimeoutMs: 1000, statementTimeoutMs: 3000,
        queryTimeoutMs: 4000, idleTransactionTimeoutMs: 5000, applicationName: 'shipit_integration', ...overrides }));
    },
    ownerPool() {
      validate();
      return trackedPool(configuration(resource.migrationRole, migrationPassword));
    },
    async migrate(options) { validate(); return runMigrations(handle.migrationConfig(), options); },
    async prepareTenancy() {
      validate();
      await handle.migrate();
      const owner = handle.ownerPool();
      try {
        await owner.query(`GRANT USAGE ON SCHEMA shipit TO ${identifier(resource.runtimeRole)}`);
        await owner.query(`GRANT SELECT, INSERT ON shipit.organizations, shipit.franchises TO ${identifier(resource.runtimeRole)}`);
        await owner.query(`GRANT UPDATE (display_name, lifecycle, version, updated_at, lifecycle_changed_at)
          ON shipit.organizations, shipit.franchises TO ${identifier(resource.runtimeRole)}`);
      } finally { await owner.close(); pools.delete(owner); }
    },
    async prepareFixtures() {
      validate();
      await handle.migrate();
      const owner = handle.ownerPool();
      try {
        await owner.query('CREATE SCHEMA synthetic');
        await owner.query('REVOKE ALL ON SCHEMA synthetic FROM PUBLIC');
        await owner.query('CREATE TABLE synthetic.fixture (id uuid PRIMARY KEY, label text NOT NULL)');
        await owner.query(`GRANT USAGE ON SCHEMA synthetic TO ${identifier(resource.runtimeRole)}`);
        await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON synthetic.fixture TO ${identifier(resource.runtimeRole)}`);
      } finally { await owner.close(); pools.delete(owner); }
    },
    async setAvailable(available) {
      validate();
      await withAdmin(async (client) => {
        validate();
        await client.query(`ALTER DATABASE ${identifier(resource.database)} ALLOW_CONNECTIONS ${available ? 'true' : 'false'}`);
        if (!available) await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [resource.database]);
      });
    },
    async terminateBackend(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('DB_TEST_BACKEND_INVALID');
      validate();
      await withAdmin(async (client) => {
        const result = await client.query<{ terminated: boolean }>(
          'SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE datname = $1 AND pid = $2',
          [resource.database, pid]);
        if (result.rows[0]?.terminated !== true) throw new Error('DB_TEST_BACKEND_NOT_FOUND');
      });
    },
    async adminQuery<Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []) {
      validate();
      return withAdmin((client) => client.query<Row>(sql, [...values]), resourceUrl(resource));
    },
    async close() {
      if (closed) return;
      const failures: Error[] = [];
      for (const pool of pools) {
        try { await pool.close(); } catch { failures.push(new Error('DB_TEST_POOL_CLOSE_FAILED')); }
      }
      pools.clear();
      try { await cleanupResource(resource); } catch { failures.push(new Error('DB_TEST_CLEANUP_FAILED')); }
      if (failures.length) throw new AggregateError(failures, 'DB_TEST_CLEANUP_FAILED');
      closed = true;
    },
  };
  t.after(() => handle.close());
  if (!process.env.DB_TEST_RESOURCE_REGISTRY) throw new Error('DB_TEST_REGISTRY_REQUIRED');
  try {
    await appendFile(process.env.DB_TEST_RESOURCE_REGISTRY, `${JSON.stringify(resource)}\n`, { mode: 0o600 });
    validate();
    await withAdmin(async (client) => {
      for (const [role, password] of [[resource.migrationRole, migrationPassword], [resource.runtimeRole, runtimePassword]]) {
        validate();
        // PostgreSQL quotes the credential through %L after binding; no secret
        // enters a command argument, source fixture, registry or error output.
        const command = await client.query<{ command: string }>(
          `SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L',
            $1::text, $2::text) AS command`, [role, password]);
        await client.query(command.rows[0]!.command);
      }
      validate();
      await client.query(`CREATE DATABASE ${identifier(resource.database)} OWNER ${identifier(resource.migrationRole)}`);
      validate();
      await client.query(`REVOKE ALL ON DATABASE ${identifier(resource.database)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${identifier(resource.database)} TO ${identifier(resource.runtimeRole)}`);
    });
    await handle.adminQuery('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    return handle;
  } catch {
    await handle.close();
    throw new Error('DB_TEST_SETUP_FAILED');
  }
}
