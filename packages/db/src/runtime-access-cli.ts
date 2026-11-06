import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPool } from './pool.ts';
import type { DatabaseClient, DatabasePool } from './pool.ts';
import { checkRuntimeAccess, repairRuntimeAccess, runtimeAccessProfiles } from './runtime-access.ts';
import { localAccessConfiguration, localFeatureStates } from './local-access.ts';

async function closePools(pools: readonly (DatabasePool | undefined)[]) {
  const closed = await Promise.allSettled(pools.map(pool => pool?.close()));
  if (closed.some(result => result.status === 'rejected')) throw new Error('ACCESS_CLOSE_FAILED');
}

async function migrationState(owner: DatabasePool | undefined) {
  if (!owner) return { status: 'not_checked', reason: 'MIGRATION_DATABASE_URL_REQUIRED' };
  let client: DatabaseClient | undefined;
  try {
    client = await owner.connect();
    await client.query('BEGIN READ ONLY');
    const expected = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter(name => /\.(?:cjs|mjs|js|sql)$/.test(name)).map(name => name.replace(/\.[^.]+$/, ''));
    const actual = (await client.query<{ name: string }>('SELECT name FROM shipit_migrations.pgmigrations')).rows.map(row => row.name);
    await client.query('ROLLBACK');
    const pending = expected.filter(name => !actual.includes(name));
    const unknown = actual.filter(name => !expected.includes(name));
    return { status: pending.length || unknown.length ? 'mismatch' : 'current', pending, unknown };
  } catch {
    return { status: 'unavailable', reason: 'MIGRATION_HISTORY_UNAVAILABLE' };
  } finally { client?.release(true); }
}

export async function runAccessCommand(args: readonly string[], env: Readonly<Record<string, string | undefined>>) {
  const [mode, ...rest] = args;
  if (!['doctor', 'repair'].includes(mode ?? '')) throw new Error('ACCESS_COMMAND_INVALID');
  const apply = rest[0] === '--apply';
  const profiles = apply ? rest.slice(1) : rest;
  if ((mode === 'doctor' && apply) || (mode === 'repair' && !profiles.length) ||
      profiles.some(name => !Object.hasOwn(runtimeAccessProfiles, name)) || new Set(profiles).size !== profiles.length) throw new Error('ACCESS_PROFILE_INVALID');
  const config = localAccessConfiguration(env, mode === 'repair' && apply);
  const runtime = createPool(config.runtime);
  const owner = config.owner ? createPool(config.owner) : undefined;
  const selected = profiles.length ? profiles : Object.keys(runtimeAccessProfiles);
  try {
    // Check the actual runtime identity before allowing any owner-side change.
    const before = await checkRuntimeAccess(runtime, selected);
    if (!before.role_safe) return { ok: false, code: 'ACCESS_RUNTIME_ROLE_UNSAFE', access: before };
    const migrations = await migrationState(owner);
    if (mode === 'repair' && apply && migrations.status !== 'current') {
      return { ok: false, code: 'ACCESS_MIGRATIONS_NOT_CURRENT', access: before, migrations };
    }
    const access = mode === 'repair' && apply ? await repairRuntimeAccess(owner!,
      { role: 'db_developer', database: 'shipit_developer' }, selected) : before;
    const features = localFeatureStates(env);
    const accessOk = access.schema_usage && Object.values(access.profiles).every(profile => profile.status === 'granted');
    const flagsOk = !Object.values(features.flags).includes('invalid') && !Object.values(features.whatsapp).includes('invalid');
    const next = !flagsOk ? 'Correct invalid feature-flag values; flags were not changed by this command.' :
      migrations.status !== 'current' ? 'Check the matching migration credential and pending migration files, then repeat db:doctor. This command applies no migrations.' :
      mode === 'repair' && !apply ? 'Review these profiles, then use db:access --apply with the same profile names.' :
      accessOk ? 'Use the owning workflow tests before enabling features.' : 'Review missing access and run db:access for the specific profiles. No flags were changed.';
    return { ok: accessOk && migrations.status === 'current' && flagsOk, mode: apply ? 'repaired' : mode === 'repair' ? 'preview' : 'read_only',
      access, migrations, features,
      ...(mode === 'repair' && apply ? { previous_access: before } : {}),
      not_checked: ['business_setup', 'application_authorization', 'worker_liveness', 'provider_delivery', 'writes_not_declared_in_profile'],
      next };
  } finally {
    await closePools([runtime, owner]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runAccessCommand(process.argv.slice(2), process.env);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    // Driver errors may contain credentials, parameters or raw server details.
    const allowed = new Set(['ACCESS_COMMAND_INVALID', 'ACCESS_PROFILE_INVALID', 'ACCESS_LOCAL_TARGET_INVALID',
      'ACCESS_LOCAL_TARGET_MISMATCH', 'ACCESS_TARGET_MISMATCH', 'ACCESS_RUNTIME_ROLE_UNSAFE',
      'DB_CONFIG_INVALID', 'DB_CONNECTION_FAILED', 'DB_QUERY_FAILED']);
    const candidate = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
    console.error(JSON.stringify({ ok: false, code: allowed.has(candidate) ? candidate : 'ACCESS_CHECK_FAILED',
      next: 'Check the local target, database availability, schema and migration credential. No raw error details are printed.' }));
    process.exitCode = 1;
  }
}
