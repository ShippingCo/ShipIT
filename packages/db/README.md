# @shippingco/db

Server-only PostgreSQL infrastructure using `pg` 8.23.0, raw SQL and
`node-pg-migrate` 9.0.0. This package owns configuration, pools, transactions,
forward migrations and internal readiness. Domain SQL belongs to its owning API
module. [ADR 0001](../../docs/adr/0001-raw-sql-and-postgresql-access.md) and the
[testing contract](../../docs/architecture/testing-contract.md) remain authoritative.

## Application API

Inject a resolved runtime credential and typed configuration. The library reads no
application environment variables or secret store; #11 owns server configuration
and lifecycle wiring. Create one shared pool per process/dependency container.

```ts
import { createDatabaseConfig, createPool, withTransaction,
  checkDatabaseReadiness } from '@shippingco/db';

const config = createDatabaseConfig({
  connectionString: resolvedRuntimeDatabaseSecret,
  environment: deploymentMode,
  tls: { mode: 'verify-full', ca: trustedCaPem },
});
const pool = createPool(config);
try {
  await pool.query<{ value: string }>('SELECT $1::text AS value', ['synthetic_example']);
  await withTransaction(pool, async (tx) => {
    // Pass tx to every participating SQL helper and await all its work.
    return tx.query<{ value: number }>('SELECT $1::integer AS value', [1]);
  });
  await checkDatabaseReadiness(pool);
} finally {
  // In an application, stop accepting work and drain requests before closing.
  await pool.close();
}
```

`query<Row>(sql, params)` returns the `pg.QueryResult<Row>` without hiding SQL.
Bind every value; dynamic identifiers require a closed server-owned allowlist.
Use schema-qualified relation names: connections explicitly set `search_path` to
`pg_catalog`. `connect()` leases a client that the caller must release in `finally`;
prefer `withTransaction` for transactional work. `stats()` returns total, idle and
waiting connection counts. Pool creation does not connect, migrate or reset data.

Transactions retain one client for BEGIN, callback work, COMMIT/ROLLBACK and release.
SQL and callback failures roll back; even a callback that catches a SQL error cannot
turn PostgreSQL's aborted-transaction ROLLBACK response into a successful commit.
The transaction query seam expires after completion. Failed commit acknowledgement
returns `DB_COMMIT_UNCERTAIN`; no automatic retry occurs. A failed rollback returns
`DB_ROLLBACK_FAILED`, and failed/uncertain connections are discarded. Future mutation
reconciliation follows the [idempotency contract](../../docs/architecture/idempotency-contract.md).
`withTransaction` provides a branded `TransactionExecutor`. Lock-dependent domain
primitives also call `assertActiveTransaction(tx)` to reject a pool, ordinary lease,
copied executor or completed transaction. This is a transaction-lifetime guarantee;
it does not establish tenant authorization or prevent arbitrary caller SQL.

## Configuration and limits

`createDatabaseConfig` returns immutable validated configuration. Require an explicit
PostgreSQL URL with host, database, username and nonempty password. URL query strings
and fragments are rejected. Connection options are constructed explicitly, including
authentication, TLS, timeouts, encoding, search path and replication mode; ambient
`PG*` variables cannot replace those settings. Never log a URL, config, parameter
array, driver object or secret value.

| Setting | Default | Accepted range |
| --- | --- | --- |
| `maxConnections` | 10 | 1–50 |
| `connectionTimeoutMs` | 2,000 | 1–30,000 |
| `idleTimeoutMs` | 30,000 | 1–300,000 |
| `statementTimeoutMs` | 5,000 | 1–300,000 |
| `queryTimeoutMs` | 6,000 | 1–310,000; greater than statement timeout |
| `idleTransactionTimeoutMs` | 10,000 | 1–300,000 |
| `applicationName` | `shipit` | Lowercase letter, then lowercase letters, digits, `_` or `-`; maximum 63 characters |

All numeric settings are positive safe integers. TLS is explicitly `disable` or
`verify-full`; staging and production require `verify-full`. Certificate and host
verification remain enabled, with an optional injected PEM CA or Node's default trust
roots. Closing is idempotent, invalidates outstanding leases and waits for sockets
and queued acquisitions. Queued callers settle with `DB_CLOSED` within the configured
connection timeout; the overall close deadline is that timeout plus two seconds.

## Migrations and identities

Run `pnpm db:migrate` only after securely injecting these operator variables:

| Variable | Meaning |
| --- | --- |
| `SHIPIT_ENVIRONMENT` | `developer`, `demo`, `staging` or `production` |
| `MIGRATION_DATABASE_URL` | Resolved credential for the separate migration role; no application URL fallback |
| `DATABASE_TLS_MODE` | Required `disable` or `verify-full`; staging/production require the latter |
| `DATABASE_CA_FILE` | Optional readable PEM CA file for verified TLS |

The CLI uses a dedicated connection, a 60-second statement timeout and a 65-second
query timeout. Tests use their guarded runner instead of this operator CLI.
`runMigrations(config, { dir?, count? })` supports an absolute fixture directory or a
positive migration count for integration testing; normal operation uses
[`migrations/`](migrations/). The result is `{ applied: number }`.

The released infrastructure migration creates the neutral `shipit` schema and
revokes PUBLIC access. Issue #12 adds only `shipit.organizations` and
`shipit.franchises`; domain SQL remains in the API tenancy module. The library ledger
is `shipit_migrations.pgmigrations`. Migration effects and ledger entries advance
together in one transaction. The library's PostgreSQL advisory lock
`7241865325823964` rejects a concurrent migrator immediately with
`DB_MIGRATION_LOCKED`; it is released on completion, failure or connection close.
After resolving contention, rerun explicitly; an unchanged migration set is a no-op.

Once a migration is applied or released, corrections are new forward migration files.
There is no down-migration command or automatic history rewrite. The repository's
[`check-migrations.mjs`](../../scripts/check-migrations.mjs) compares released files
with `origin/main` or an explicit fetched `MIGRATION_BASE_SHA`, rejecting changes,
deletions, renames and replacements while allowing additions. This is a Git review/CI
control, not a cryptographic registry of every deployed database.

Provision separate bootstrap, migration and runtime identities. In the harness,
bootstrap privileges are confined to disposable test provisioning; the migration role
owns the database and schema. The runtime role is a non-owner with required connection/schema/DML
grants and no superuser, role-creation, database-creation or RLS-bypass privileges.
The test harness verifies this separation against PostgreSQL. The library does not
provision production roles; #68 owns deployment. Role names are never embedded in
migration files.

## Tenancy roots and runtime access

Every franchise has one immutable `organization_id`. A standalone shop is one
organization and one franchise; an organization may own several franchises. Both
tables use application-generated UUID IDs, trimmed business `display_name` values
of 1–120 Unicode code points with no ASCII control characters, lifecycle
`active | disabled`, positive integer `version` defaulting to 1, and UTC
`created_at`, `updated_at`, `lifecycle_changed_at` instants. Timestamp defaults and
service updates use millisecond precision so safe ISO DTOs roundtrip pagination
boundaries exactly. Franchises additionally have an immutable canonical ASCII
`franchise_code` matching `[A-Z][A-Z0-9_]{0,31}`. Invalid codes are rejected without
automatic case or punctuation normalization.

The organization FK uses `ON DELETE RESTRICT`. The franchise candidate key
`UNIQUE (organization_id, id)` supports future private children with
`FOREIGN KEY (organization_id, franchise_id) REFERENCES shipit.franchises
(organization_id, id)`. `UNIQUE (organization_id, franchise_code)` permits the same
code in unrelated organizations. These unique indexes serve scoped identity/code
lookups; `(organization_id, created_at, id)` serves ascending deterministic lists
and its leading organization column also indexes FK ownership paths.

The guarded disposable provisioner exposes `prepareTenancy()` to apply migrations
and grant the generated runtime identity exactly:

- `USAGE` on schema `shipit`;
- `SELECT, INSERT` on both tenancy tables;
- column-level `UPDATE (display_name, lifecycle, version, updated_at,
  lifecycle_changed_at)` on both tables.

Deployment provisioning must apply these same explicit grants to its securely
resolved runtime role, without table-level UPDATE, DELETE, TRUNCATE, DDL, ownership
or role-management privileges. The runtime role cannot change IDs, original creation
time, organization ownership or franchise code. Immutable-identity triggers also
reject ordinary owner SQL updates to those columns; controlled adoption is deferred
to #79. Migration owners remain privileged administrators and are never application
credentials. Disabling preserves rows and historical authorized reads; the API
tenancy guard serializes operational writes with lifecycle administration. Durable
audit and tenant enforcement are described in the Issue #16 section below and ADR 0013.

## Local and CI testing

With Docker running and the repository's exact toolchain installed:

```sh
pnpm db:local test:db
pnpm db:local quality
pnpm test:web
```

`db:local` starts the digest-pinned official PostgreSQL 18.6 Bookworm image with
generated bootstrap credentials, a random loopback port and a bounded readiness
check. It runs the supplied pnpm command (`quality` by default), then removes its
exact owned container and volumes, including on failure. PostgreSQL statement
logging is disabled so negative provisioning tests cannot retain generated passwords.
CI uses the same helper in its required PostgreSQL integration job.

For an independently provisioned disposable service, `pnpm test:db` requires
`NODE_ENV=test`, `TEST_DATABASE_URL` and `TEST_DATABASE_IDENTITY=db_test` (or an allowed
worker suffix). It never falls back to `DATABASE_URL` or `DATABASE_SECRET_REF`.
The bootstrap target must have a guarded test database name and provisioner privileges.
Missing/unsafe configuration, unreachable PostgreSQL, an empty suite, test failure or
cleanup failure exits nonzero. Frontend tests remain independent; the full `quality`
command requires database tests.

The trusted test host policy permits only localhost, loopback and the explicitly
reviewed `postgres` service hostname, with production/staging and non-test identity
denials taking precedence. Each case registers an exact generated database and
distinct migration/runtime roles before creating them. Guards run before connection,
creation, migration, fixture setup and cleanup. Registry entries contain resource names
only; generated role credentials are never logged. Test teardown closes pools, drops only registered
databases/roles and verifies absence; the parent runner repeats exact cleanup after
child failure. Cleanup failure fails the command. No wildcard database deletion occurs.

## Readiness, failures and limitations

`checkDatabaseReadiness(pool)` runs bounded `SELECT 1` and returns only
`{ status: 'ready' }` or `{ status: 'not_ready', code }`. It proves connectivity, not
migration currency or domain readiness. #11 owns the future HTTP endpoint.

`DatabaseError` contains a controlled code and optional five-character SQLSTATE;
raw driver messages, causes, SQL, parameters and credentials are removed. Codes are
`DB_CONFIG_INVALID`, `DB_CONNECTION_FAILED`, `DB_QUERY_FAILED`, `DB_TIMEOUT`,
`DB_CLOSED`, `DB_TRANSACTION_FAILED`, `DB_COMMIT_UNCERTAIN`, `DB_ROLLBACK_FAILED`,
`DB_MIGRATION_FAILED`, `DB_MIGRATION_LOCKED` and `DB_SHUTDOWN_FAILED`.

Real integration tests cover fresh/upgrade/repeated tenancy migrations, ownership
and code constraints, a disposable child composite FK, runtime privileges,
immutable identity triggers, transaction lifetime, two competing migration processes, transaction
commit/rollback/release, restart persistence, parameter binding, runtime privileges,
pool exhaustion, statement timeouts, outage recovery and exact cleanup. Synthetic
fixture tables exist only in disposable databases. Tenancy service tests use the
same real PostgreSQL provisioner and the existing Alpha/Beta testkit fixture graph.
The original infrastructure/tenancy tests do not establish production TLS deployment,
workers or provider behavior. Later API suites cover authentication, membership RBAC,
tenant enforcement and the Issue #16 audit boundary described below.


## Issue #16 audit provisioning

Apply `1789146000000-append-only-audit.cjs` before deploying audit-enabled code. It leaves
all released migrations/history intact and builds a canonical compatibility view over
new tenancy/denial storage and the original membership/auth stores. No backfill or dual
write occurs. Invalid historical membership Franchise ownership fails migration safely.

In addition to the earlier explicit grants, provision the resolved runtime role with
SELECT on `shipit.audit_history` and EXECUTE on exactly:

- `shipit.append_tenancy_audit(uuid,uuid,text,text,text,text,uuid,text,uuid,timestamptz,text,text,integer)`
- `shipit.append_security_denial(text,text,text,text,text,uuid)`

Grant no privileges on `shipit.audit_records`; direct INSERT is denied as well as
UPDATE/DELETE/TRUNCATE. Keep the original INSERT-only legacy audit grants and no DDL,
role membership or ownership privileges. Do not use broad default/table grants. The
functions are fixed-SQL SECURITY DEFINER with `search_path=pg_catalog` and no PUBLIC
execute privilege. `prepareAudit()` in the guarded test provisioner exercises exactly
this model with actual distinct migration/runtime credentials. Application SQL scopes
the view using TenantAccess; this is not RLS protection from compromised runtime SQL.
See [audit contract](../../docs/architecture/audit-contract.md) and
[verification](../../docs/architecture/issue-16-verification.md) for rollout and evidence.

## Initial workspace replay evidence (Issue #17)

Forward migration `1789232400000-independent-onboarding.cjs` adds immutable
`shipit.onboarding_commands`. Grant runtime SELECT/INSERT only on this table. Its user
primary key forbids duplicate initial workspaces, composite FKs bind root/membership
ownership, and committed replay evidence retains at least 24 hours. Never delete it as
ordinary expired request data: it also preserves the initial-workspace uniqueness invariant.
See [onboarding rollout and verification](../../docs/architecture/independent-onboarding.md).
