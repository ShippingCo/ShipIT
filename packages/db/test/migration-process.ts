import { createDatabaseConfig, DatabaseError, runMigrations } from '../src/index.ts';
import { guardTestConnectionString } from './support.ts';

try {
  if (process.env.NODE_ENV !== 'test' || process.env.TEST_DATABASE_IDENTITY !== 'db_test_1' ||
      !process.env.TEST_DATABASE_URL || !process.env.DB_TEST_MIGRATION_DIRECTORY) {
    throw new Error('DB_TEST_CONFIG_INVALID');
  }
  const target = guardTestConnectionString(process.env.TEST_DATABASE_URL);
  const match = /^shipit_([a-f0-9]{16})_test_1$/.exec(target.database);
  if (!match || new URL(target.connectionString).username !== `shipit_${match[1]}_migration_test_1`) {
    throw new Error('DB_TEST_CONFIG_INVALID');
  }
  const config = createDatabaseConfig({ connectionString: target.connectionString, environment: 'test',
    tls: { mode: 'disable' }, connectionTimeoutMs: 1000, statementTimeoutMs: 6000, queryTimeoutMs: 7000,
    applicationName: 'shipit_migration_process' });
  const result = await runMigrations(config, { dir: process.env.DB_TEST_MIGRATION_DIRECTORY });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const code = error instanceof DatabaseError ? error.code : 'DB_TEST_MIGRATION_PROCESS_FAILED';
  process.stdout.write(`${JSON.stringify({ code })}\n`);
  process.exitCode = 1;
}
