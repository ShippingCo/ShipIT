import { Client } from 'pg';
import { runner, PG_MIGRATE_LOCK_ID } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { closeClient } from './shutdown.ts';
import { pgOptions } from './config.ts';
import type { DatabaseConfigInput } from './config.ts';
import { DatabaseError } from './errors.ts';
export const migrationLockId = PG_MIGRATE_LOCK_ID;
export const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
export async function runMigrations(config: DatabaseConfigInput, options: { dir?: string; count?: number } = {}) {
  const dir = options.dir ?? migrationDirectory;
  if (!isAbsolute(dir) || (options.count !== undefined && (!Number.isSafeInteger(options.count) || options.count < 1))) {
    throw new DatabaseError('DB_CONFIG_INVALID');
  }
  let client: Client | undefined;
  try {
    client = new Client(pgOptions(config));
    client.on('error', () => { /* The query/runner rejection is sanitized below. */ });
    await client.connect();
    const applied = await runner({
      dbClient: client, dir, direction: 'up', count: options.count,
      migrationsTable: 'pgmigrations', migrationsSchema: 'shipit_migrations', createMigrationsSchema: true,
      schema: 'public', singleTransaction: true, checkOrder: true, noLock: false,
      advisoryLockMode: 'fail', verbose: false,
      logger: { info() {}, warn() {}, error() {} },
    });
    return { applied: applied.length };
  } catch (error) {
    if (error instanceof DatabaseError && error.code === 'DB_CONFIG_INVALID') throw error;
    const locked = error instanceof Error && error.message === "Another migration is already running. Advisory lock mode is set to 'fail'.";
    throw new DatabaseError(locked ? 'DB_MIGRATION_LOCKED' : 'DB_MIGRATION_FAILED');
  } finally {
    if (client) await closeClient(client);
  }
}
