import { readFile } from 'node:fs/promises';
import { createDatabaseConfig } from './config.ts';
import { runMigrations } from './migrations.ts';
import { DatabaseError } from './errors.ts';

// The operator supplies the resolved migration credential, never an application URL fallback.
try {
  const mode = process.env.SHIPIT_ENVIRONMENT;
  if (!['developer', 'demo', 'staging', 'production'].includes(mode ?? '') || !process.env.MIGRATION_DATABASE_URL) {
    throw new DatabaseError('DB_CONFIG_INVALID');
  }
  const tlsMode = process.env.DATABASE_TLS_MODE;
  if (tlsMode !== 'disable' && tlsMode !== 'verify-full') throw new DatabaseError('DB_CONFIG_INVALID');
  const ca = process.env.DATABASE_CA_FILE ? await readFile(process.env.DATABASE_CA_FILE, 'utf8') : undefined;
  const config = createDatabaseConfig({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    environment: mode as 'developer' | 'demo' | 'staging' | 'production',
    tls: tlsMode === 'verify-full' ? { mode: 'verify-full', ca } : { mode: 'disable' },
    applicationName: 'shipit_migrations', maxConnections: 1,
    statementTimeoutMs: 60_000, queryTimeoutMs: 65_000,
  });
  const result = await runMigrations(config);
  console.log(`Migrations applied: ${result.applied}`);
} catch (error) {
  console.error(error instanceof DatabaseError ? error.code : 'DB_CONFIG_INVALID');
  process.exitCode = 1;
}
