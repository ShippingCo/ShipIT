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

## Issue #19 Customer provisioning

Apply `1789318800000-tenant-private-customers.cjs` after the seven released migrations.
Resolve the deployment runtime identity separately; never embed its role in a migration.
Grant SELECT/INSERT on shipit.customers and shipit.customer_commands; grant only
UPDATE(name,phone_normalized,phone_display,address,version,updated_at) on shipit.customers.
Grant EXECUTE on shipit.append_customer_audit(uuid,uuid,uuid,uuid,text,integer,uuid).
Retain the existing audit_history SELECT and security-denial function grants. Grant no
access to customer_audit_events, no table-wide UPDATE, DELETE/TRUNCATE, DDL or migration-role
access. Test provisioning uses prepareCustomers with exactly these grants.

Customers have a composite parent FK and immutable ownership trigger, scoped nonunique
phone/name prefix indexes and deterministic ordering index. Command receipts and customer
audit facts have composite Customer FKs and unique command/version constraints. No browser
backfill. Apply schema/grants before code; revert compatible code while retaining applied
schema/data, and repair using a new forward migration. [Customer contract](../../docs/architecture/customers.md).

## Issue #32 external e-way records

`1790442000000-external-eway-records.cjs` adds Booking-owned `eway_records`, immutable
`eway_record_revisions` and `eway_commands`, and append-only maintenance `eway_policies`.
Composite owner FKs, deferred command/revision completeness checks and fixed-search-path
triggers enforce identity, version, history and separate estimate provenance. The scoped
Booking keyset index supports reminder pages; owner/expiry and revision indexes support
lookups. No commercial Booking column changes or historical-value backfill occur.

After the prior domain grants, resolve the deployment runtime role and grant exactly:

```sql
GRANT SELECT ON shipit.eway_records, shipit.eway_record_revisions,
  shipit.eway_commands, shipit.eway_policies TO runtime_role;
GRANT INSERT ON shipit.eway_records, shipit.eway_commands TO runtime_role;
GRANT UPDATE(version,declared_goods_value_paise,declaration_source_ref,issuer,
  external_reference,source_ref,source_issued_at,official_valid_until,validity_evidence_ref,
  vehicle_number,distance_km,estimate,estimate_policy_id,actor_id,captured_at,reason_code,
  reason_ref,command_id,correlation_id) ON shipit.eway_records TO runtime_role;
```

Retain the existing authorized `audit_history` SELECT. No direct history/audit insertion,
policy mutation, ownership update, DELETE, TRUNCATE, DDL or function EXECUTE is granted.
PUBLIC has no new privileges. `prepareEway()` reproduces these exact runtime grants.
Maintenance policy insertion uses the separately controlled migration identity and recorded
approval, never API runtime credentials. Policies reject backdated effective instants and
nonincreasing versions. No production preset is installed. See [e-way rollout and maintenance](../../docs/architecture/eway.md#policy-maintenance-and-rollout).

The upgrade test preserves populated twenty-migration Booking/Parcel/attachment-era facts,
checks failure rollback and repeat/no-op, and demonstrates a synthetic NEW forward repair.
Rollback disables compatible application code, retains evidence, and repairs schema forward.

## Issue #20 pricing migration and runtime grants

`1789405200000-versioned-pricing.cjs` adds pricing_cards, pricing_versions, pricing_rules,
pricing_quotes, pricing_commands and pricing_audit_events. Composite ownership/FKs, safe
paise/gram bounds, immutable publication triggers, serialized conflict checks, unique
version/key/audit identities and finite time constraints are mandatory. No extension,
backfill, Booking/tax tables or changes to released migrations. Apply before compatible API.

After resolving the separate deployment runtime role, grant exactly (substitute the
reviewed identifier for `runtime_role`, never a request value):

```sql
GRANT SELECT, INSERT ON shipit.pricing_cards, shipit.pricing_versions,
  shipit.pricing_rules, shipit.pricing_quotes, shipit.pricing_commands TO runtime_role;
GRANT UPDATE (revision,state,effective_from,effective_to,quote_validity_seconds,
  override_tolerance_paise,approval_ref,source_ref,published_at,published_by)
  ON shipit.pricing_versions TO runtime_role;
GRANT DELETE ON shipit.pricing_rules TO runtime_role;
GRANT EXECUTE ON FUNCTION shipit.append_pricing_audit(uuid,uuid,uuid,uuid,uuid,text,text,integer,uuid)
  TO runtime_role;
```

Existing auth/membership/tenancy/audit grants are prerequisites; audit_history retains its
view identity and SELECT grant. No quote/receipt UPDATE/DELETE/TRUNCATE or audit base-table
access. Rules can be deleted only while their parent is a draft, under its row lock.
The publication trigger owns the private card revision write and checks overlaps after
serialization. Owner/migration credentials remain unavailable to the application.

Rollback disables/reverts compatible code and preserves commercial evidence. Repair schema
forward. No production-to-demo fallback or browser import. The guarded fixture's
preparePricing method applies these exact privileges, with real-runtime negative tests.
See [pricing architecture](../../docs/architecture/pricing.md) and
[verification](../../docs/architecture/issue-20-verification.md).

## Issue #22 atomic Booking migration and runtime grants

Apply forward migration `1789578000000-atomic-bookings.cjs` after the ten existing
migrations. It adds bookings, parcels, booking_obligations, booking_commands, domain_events,
booking_audit_events and one global non-cycling docket sequence. Ownership FKs, immutable
snapshots, payment reconciliation, logical event/command uniqueness and a deferred complete
command check enforce the atomic boundary. The existing audit view retains identity/grants.
No backfill, extension, lot table or production rate seed. No historical migration changes.

After resolving the deployment's separate runtime role, grant exactly:

```sql
GRANT SELECT, INSERT ON shipit.bookings, shipit.parcels, shipit.booking_obligations,
  shipit.booking_commands, shipit.domain_events TO runtime_role;
GRANT UPDATE (state,http_status,result,committed_at,retain_until)
  ON shipit.booking_commands TO runtime_role;
GRANT EXECUTE ON FUNCTION shipit.append_booking_audit(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz)
  TO runtime_role;
```

Retain existing Customer/pricing/tax/auth/membership/tenancy and audit_history grants.
`prepareBookings` provisions the exact test runtime privileges. The allocator and integrity
functions run only as triggers (execution checked at trigger creation); PUBLIC execution is
revoked and no direct runtime grant is needed. Runtime receives no sequence access/setval,
no booking_audit_events privileges and no DDL, TRUNCATE, DELETE or snapshot updates.
Command UPDATE is guarded to allow only reserved→committed, with immutable identity.

Roll out schema, grants, compatible API, then synthetic verification. Disable/revert the
compatible API for rollback while preserving schema, receipts, sequence watermark and
history. There is no down migration. Repair applied schema only by a subsequent forward
migration; a failed unapplied migration rolls back schema/ledger and can be retried by a
fresh migrator. Never reset the sequence, erase command evidence, import browser state or
fall back to localStorage. [Contract](../../docs/architecture/bookings.md) and
[acceptance/repair tests](../../docs/architecture/issue-22-verification.md).

## Issue #24 guarded Parcel lifecycle grants

Apply `1789750800000-guarded-parcel-lifecycle.cjs` after the Issue #23 retrieval migration.
It extends Parcel state/version/custody evidence and adds `parcel_commands`,
`parcel_transitions`, `parcel_failed_attempts` and `parcel_rto_approvals`. It also expands
the existing domain-event/audit compatibility projections. Existing booked rows require no
backfill beyond additive defaults.

After resolving the separate deployment runtime identity, grant exactly:

```sql
GRANT SELECT, INSERT ON shipit.parcel_commands, shipit.parcel_transitions,
  shipit.parcel_failed_attempts, shipit.parcel_rto_approvals TO runtime_role;
GRANT UPDATE (status,custody,version,attempts_started,failed_attempt_count,
  active_attempt_id,assigned_agent_id,last_command_id,updated_at)
  ON shipit.parcels TO runtime_role;
GRANT UPDATE (state,http_status,result,committed_at,retain_until)
  ON shipit.parcel_commands TO runtime_role;
```

Retain the Issue #22 domain_events SELECT/INSERT and Issue #23 audit_history SELECT grants.
Grant no table-wide UPDATE, history UPDATE/DELETE/TRUNCATE, DDL, ownership or migration-role
membership. Fixed triggers need no runtime EXECUTE grant. `prepareBookings()` applies this
exact model in disposable integration tests.

Deploy schema/grants before compatible API. Rollback disables/reverts API code and preserves
the additive schema, receipts and evidence. Never down-migrate or erase history; repair an
applied schema with a new forward migration. See [ADR 0014](../../docs/adr/0014-guarded-parcel-lifecycle-commands.md)
and [verification](../../docs/architecture/issue-24-verification.md).

## Issue #25 bulk intent guard

Apply `1789837200000-bounded-parcel-bulk.cjs` after Issue #24. The additive
`parcel_bulk_requests` table binds actor and composite Organization/Franchise ownership
to a unique outer key digest and canonical fingerprint. It stores no raw command body,
keys or duplicate business results. Intent is immutable, retained indefinitely, and
recovered using existing Parcel command receipts. No backfill or released-file change.

```sql
GRANT SELECT, INSERT ON shipit.parcel_bulk_requests TO runtime_role;
```

Resolve the separate runtime role as in the earlier grants. Grant no UPDATE, DELETE,
TRUNCATE, DDL or migration-role membership; existing history trigger needs no runtime
EXECUTE privilege. `prepareBookings()` applies these exact test privileges. Apply schema
and grants before API. Rollback preserves additive schema/committed history; repair forward.
See [bulk contract](../../docs/architecture/parcel-bulk.md) for retention/recovery obligations.

## Issue #26 persistent lots

Apply `1789923600000-persistent-lots.cjs` after all fourteen released migrations through
#25. It adds lots, lot_memberships, lot_commands, lot_code_counters and lot_audit_events.
Composite ownership FKs are RESTRICT; active code and membership use partial unique indexes.
Triggers enforce server allocation, immutable history, exact versions and complete committed
state/result/audit/event. Existing domain_events gains nullable lot_id/lot_command_id and
a nullable booking_id exclusively for lot producers; old booking/parcel predicates are
retained. audit_history includes the new immutable source. No old history rewrite/backfill.

Resolve the separate deployment runtime identity and grant only:

```sql
GRANT SELECT, INSERT ON shipit.lots, shipit.lot_memberships, shipit.lot_commands TO runtime_role;
GRANT UPDATE (name,state,version,updated_at,archived_at,last_command_id)
  ON shipit.lots TO runtime_role;
GRANT UPDATE (ended_at,end_command_id,end_reason) ON shipit.lot_memberships TO runtime_role;
GRANT UPDATE (state,http_status,result,committed_at,retain_until)
  ON shipit.lot_commands TO runtime_role;
GRANT EXECUTE ON FUNCTION shipit.append_lot_audit(uuid,uuid,uuid,uuid,uuid) TO runtime_role;
```

Retain existing scoped pricing/booking/parcel reads, domain_events SELECT/INSERT and
audit_history SELECT. No runtime access to the counter or direct lot audit table. No
DELETE/TRUNCATE/DDL/ownership, trigger disabling, broad UPDATE, new RLS or migration-role
membership. `prepareLots()` installs exactly these privileges in disposable tests.

Rollout: schema → minimum grants → verify old booking/parcel writers and retained facts →
API → synthetic A/B/C workflow; #34 screen cutover stays deferred. Rollback compatible API
only; retain additive schema and operational history, repair forward. No down migration or
browser import. [Verification](../../docs/architecture/issue-26-verification.md) documents
fresh migration, previous-main upgrade, failure rollback/retry and repeat no-op.

## Issue #27 dispatch routes

Apply `1790010000000-dispatch-route-manifests.cjs` after the 15 released migrations.
It adds routes, route_commands, route_lots, route_parcels, route_manifests,
route_manifest_parcels, route_manifest_sources, route_audit_events and
parcel_dispatch_manifests. Composite RESTRICT ownership/provenance FKs, partial source
uniqueness, one finalized initial-dispatch manifest per Parcel, immutable history and
deferred exact command/snapshot/event/audit checks enforce the contract independently.
Existing domain_events and audit_history are extended without rewriting old facts.

Retain the #24/#25/#26 privileges and apply these exact additions to the separately resolved
runtime identity (not the owner or PUBLIC):

```sql
GRANT SELECT, INSERT ON shipit.routes, shipit.route_commands,
  shipit.route_lots, shipit.route_parcels, shipit.route_manifests,
  shipit.route_manifest_parcels, shipit.route_manifest_sources TO runtime_role;
GRANT UPDATE (origin,destination,mode,carrier_code,scheduled_departure_at,state,
  version,current_manifest_id,last_command_id,updated_at) ON shipit.routes TO runtime_role;
GRANT UPDATE (ended_at,end_command_id) ON shipit.route_lots,shipit.route_parcels TO runtime_role;
GRANT UPDATE (state,http_status,result,committed_at,retain_until)
  ON shipit.route_commands TO runtime_role;
GRANT EXECUTE ON FUNCTION shipit.append_route_audit(uuid,uuid,uuid,uuid,uuid) TO runtime_role;
```

Audit reads use the existing audit_history view grant. Runtime has no direct Route-audit
read/insert, binding read/insert, snapshot update, ownership update, DELETE/TRUNCATE/DDL or
trigger-disabling privilege. Fixed-search-path SECURITY DEFINER functions validate their
command context; function execution is revoked from PUBLIC. `prepareRoutes()` exercises
these grants. Legacy test setup grants scoped Route reads needed by owning Lot guards/T03
only when the new schema exists; it introduces no production bypass.

Rollout is schema → grants → API → synthetic Route/finalize/T03 smoke and exact replay.
The new dispatch-command trigger rejects old producers supplying opaque references.
Already committed opaque receipts/events remain unchanged; no binding backfill. Rollback
stops new Route/dispatch writes and preserves all schema/history for forward repair; do
not deploy an old opaque writer expecting compatibility or disable constraints. Failed
migration transactions roll back completely, then retry; tracked repeat is a no-op.
[Contract](../../docs/architecture/routes.md) · [Verification](../../docs/architecture/issue-27-verification.md).

## Issue #28 Route events

After migration `1790096400000-atomic-route-events.cjs` and the existing #24/#27 grants, grant the deployment runtime role SELECT/INSERT on `shipit.route_parcel_effects` and UPDATE only `(execution_state,last_effective_at,base_eta_at,total_delay_minutes)` on `shipit.routes`. No UPDATE/DELETE/TRUNCATE grant on effects, no function EXECUTE grant and no DDL privilege is added. Existing Route receipt/audit/event and Parcel T04 grants remain necessary.

The migration adds four execution columns and one immutable affected-set table, extends the closed operation/event/denial catalogs, and retains released planning guards with a separately checked operational branch. Composite ownership FKs and deferred completion checks require one outcome per frozen manifest Parcel. Existing records and envelopes are retained unchanged; no data backfill, table replacement or down migration. Rollback stops event writes, preserves history and repairs forward. [Contract](../../docs/architecture/route-events.md).

## Issue #29 payment ledger

Apply `1790182800000-payment-ledger.cjs` before enabling Payments. It preserves the #22
opening obligation and adds payment_commands, payment_entries, payment_audit_events,
canonical audit projection and payment ownership/event constraints. No backfill or mutable
balance cache. PostgreSQL guards lock the scoped obligation and enforce net/target capacity,
sequence, receipt completion and audit/settlement consistency. Failed migration rolls back;
repeat is a no-op; repair applied schema only through a new forward migration.

Resolve the separate runtime role and apply these additional grants:

```sql
GRANT SELECT, INSERT ON shipit.payment_commands, shipit.payment_entries TO runtime_role;
GRANT UPDATE(state,entry_id,http_status,result,committed_at,retain_until)
  ON shipit.payment_commands TO runtime_role;
GRANT UPDATE(id) ON shipit.booking_obligations TO runtime_role;
GRANT EXECUTE ON FUNCTION shipit.append_payment_audit(uuid,uuid,uuid,uuid,uuid) TO runtime_role;
```

UPDATE(id) exists only because PostgreSQL FOR UPDATE requires a column UPDATE privilege.
The unchanged #22 immutable trigger rejects every actual update, including id=id; test
both runtime and owner rejection. Never disable the guard or grant table-wide UPDATE.
Retain existing domain_events INSERT and audit_history SELECT privileges. No ledger UPDATE,
DELETE/TRUNCATE, base-audit access, PUBLIC function execution, schema ownership or DDL.
`preparePayments()` supplies exactly these grants in the guarded test fixture.

Receipt retention is infinite for the pilot without pruning or key rebinding. #72 owns
future coordinated retention policy. Rollback disables/reverts Payments code, retains all
financial history and compatible Booking writers, and repairs schema forward. The scoped
projection and downstream receipt/report boundary are in [Payments](../../docs/architecture/payments.md).

## Issue #30 issued receipts

Apply `1790269200000-immutable-issued-receipts.cjs`, retaining prerequisite grants, then
add only the following for the resolved runtime role:

```sql
GRANT SELECT ON shipit.issued_receipts TO runtime_role;
GRANT INSERT (id,organization_id,franchise_id,booking_id,obligation_id,kind,
  payment_entry_id,booking_receipt_id,correction_of,actor_id,correlation_id)
  ON shipit.issued_receipts TO runtime_role;
```

The fixed-search-path SECURITY DEFINER insert trigger derives number, schema/version,
issued time and bounded snapshot exclusively from same-owner authoritative sources.
Its AFTER trigger appends reference-only audit in the same transaction. Runtime cannot
supply those generated columns, access the number sequence, mutate/delete/truncate
issued evidence, write base audit, execute the trigger functions directly, or disable
triggers. Existing audit_history SELECT exposes the authorized reference projection.
`prepareReceipts()` exercises these exact grants; no PUBLIC grants or new runtime
function execution grant. Ordinary owner UPDATE/DELETE is also rejected by triggers.

The global noncycling bigint number sequence permits rollback gaps, never reuse.
Composite ownership FKs and logical uniqueness cover Booking originals, payment entries
and correction links. No backfill: old Bookings receive an actual first-issuance time.
Fresh/populated/failed/repeated migration tests preserve all prerequisite evidence.
Rollback compatible code while retaining tables, history, sequence and grants; repair
schema forward. [Receipt contract](../../docs/architecture/receipts.md).

## Private attachment migration (#31)

`1790355600000-private-attachments.cjs` adds scoped metadata, immutable command receipts, append-only audit and narrow cleanup discovery, with no backfill or released-migration edits. Composite Booking/Parcel foreign keys, immutable identity, clean-ready constraints and locked quotas enforce persistence invariants. Runtime needs SELECT/INSERT on attachments/commands, UPDATE only mutable lifecycle columns (see `prepareAttachments` in test/support.ts), UPDATE(id) on Booking for row locking, canonical audit-view read and EXECUTE on attachment_cleanup_scope. No direct audit-table read/write, DELETE, TRUNCATE or DDL is granted. #68 provisions the existing runtime role with these least privileges before rollout. Ready rows are immutable; #72 must introduce reviewed retention/hold authority before deletion.

## Durable outbox migration (#35)

Apply `1790528400000-durable-outbox.cjs` before worker/API rollout. Retain existing
membership, domain_events read and audit_history read grants. The additional grants,
using the actual resolved runtime role instead of the placeholder below, are:

```sql
GRANT SELECT ON shipit.outbox_jobs,shipit.outbox_receipts,shipit.outbox_attempts,
  shipit.outbox_redrives,shipit.outbox_streams TO runtime_role;
GRANT INSERT ON shipit.outbox_streams TO runtime_role;
GRANT UPDATE(high_water) ON shipit.outbox_streams TO runtime_role;
GRANT UPDATE(id) ON shipit.outbox_jobs TO runtime_role;
GRANT EXECUTE ON FUNCTION
  shipit.outbox_next_scope(text,text[],text,timestamptz),shipit.outbox_job_scope(uuid),
  shipit.outbox_relay(uuid,uuid,text,text[]),shipit.outbox_claim(uuid,uuid,text,timestamptz),
  shipit.outbox_receipt(uuid,uuid,uuid,uuid,text,timestamptz),
  shipit.outbox_finish(uuid,uuid,uuid,uuid,text,integer,timestamptz),
  shipit.outbox_redrive(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) TO runtime_role;
```

UPDATE(id) permits row locks; the immutable identity trigger denies changing the ID.
Do not grant job-state UPDATE, direct history INSERT/UPDATE, DELETE, TRUNCATE, sequence
access, DDL or PUBLIC function execution. Definer functions use a fixed pg_catalog
search path and explicit owners; API/service capability checks remain mandatory.
`prepareOutbox()` tests these grants. No automatic role provisioning or data backfill.
Roll back compatible code, preserve evidence and repair schema forward. See the
[outbox guide](../../docs/architecture/outbox.md) for lock considerations and rollout.

## WhatsApp registry migration #36

Migration 23 adds scoped installations, immutable template revisions and command/audit receipts. See [runtime grants and rollout](../../docs/architecture/whatsapp.md#database-rollout-and-recovery). Apply schema before enabling WHATSAPP_CONFIG_REF. Existing data and released migrations are preserved.

Migration 24 adds the [signed WhatsApp inbox](../../docs/architecture/whatsapp-webhooks.md), immutable attempt/quarantine evidence and monotone delivery observations. Its fixed ingress/scheduler/processor functions require explicit EXECUTE grants; runtime gets no direct inbox or projection DML.

Migration 25 adds scoped WhatsApp consent evidence and customer contact identities. Apply the [consent runtime grants](../../docs/architecture/messaging-consent.md) before enabling its consumer; prior migrations are unchanged.

Issue #39 migration 26 adds the outbound intent, attempt and redrive ledger. Apply the restricted [outbound grants and rollout](../../docs/architecture/whatsapp-outbound.md) before enabling dispatch. Released migrations remain unchanged; no producer backfill occurs.

## Notification automation migration (#40)

Apply `1790960400000-notification-automation.cjs` after migration 26 and retain the #35,
#36–#39 and Booking/Parcel/Route/Customer read grants. Resolve the deployment's separate
runtime role and grant exactly:

```sql
GRANT SELECT ON shipit.notification_policy_activations,
  shipit.notification_automation_decisions TO runtime_role;
GRANT INSERT ON shipit.notification_automation_decisions TO runtime_role;
GRANT EXECUTE ON FUNCTION
  shipit.notification_policy_activate(uuid,uuid,jsonb) TO runtime_role;
```

Each activation stores a per-policy `binding_hash`. The definer function inserts missing
policy versions and locks/compares existing rows; an identical restart preserves the first
cutover timestamp, while a different identity fails atomically before worker polling. The
hash contains only safe code/configuration identity, not rendered content, recipients,
credentials or tokens. PUBLIC remains denied.

The existing table-level `whatsapp_outbound` SELECT/INSERT grant covers its new
`affected_entity_id`; no new UPDATE authority is required. Do not grant activation-table
INSERT, decision UPDATE/DELETE, trigger execution, TRUNCATE, ownership, DDL or PUBLIC
access. The fixed-search-path activation function validates existing tenant owners and the
closed consumer identity, while insert-once keys preserve the original cutover.
`prepareNotificationAutomation()` is the executable least-privilege reference.

Deploy schema and these grants before code. Then supply exact server-only automation
bindings and start the outbox worker; activation commits before consumer polling. Rollback
stops/reverts compatible code while retaining evidence and repairs schema forward. See
[notification automation](../../docs/architecture/notification-automation.md).

## Route-delay fanout migration (#41)

Apply `1791046800000-route-delay-fanout.cjs` after migration 27. It creates immutable
reminder command/event evidence and Route-delay fanout roots/items, trigger-checked progress,
composite tenant ownership, the fixed `route_delay_fanout_scope` scheduler and a narrow #39
outbound-source guard extension for immutable reminders. No released migration is edited and
no existing event is backfilled.

After resolving the deployment runtime identity, retain all #28/#35/#38–#40 grants and add:

```sql
GRANT SELECT, INSERT ON
  shipit.route_delay_reminder_commands,
  shipit.route_delay_reminder_events,
  shipit.route_delay_fanouts,
  shipit.route_delay_fanout_items TO runtime_role;
GRANT UPDATE(state, result, committed_at)
  ON shipit.route_delay_reminder_commands TO runtime_role;
GRANT UPDATE(state, cursor_parcel_id, completed_count, skipped_count,
  failed_count, attempt_count, reason_code, started_at, completed_at)
  ON shipit.route_delay_fanouts TO runtime_role;
GRANT EXECUTE ON FUNCTION
  shipit.route_delay_fanout_scope(timestamptz) TO runtime_role;
```

Do not grant item/reminder-event UPDATE, any DELETE/TRUNCATE, broad root/command UPDATE,
trigger-function execution, DDL, ownership, migration-role membership or PUBLIC access.
`prepareNotificationAutomation()` is the executable grant reference. The scheduler returns
only one persisted owner/root reference with `SKIP LOCKED`; application scope is then issued
as `outbox.work` and each item commits independently.

The populated migration-27 upgrade, injected migration failure rollback, clean retry and
repeat no-op are covered by `route-delay-fanout.test.ts`. Rollback stops the compatible
worker/reminder code, retains evidence and repairs forward. See
[operations](../../docs/architecture/route-delay-notifications.md) and
[ADR 0029](../../docs/adr/0029-route-delay-notification-fanout.md).

## Secure delivery proof migration (#42)

Apply `1791133200000-secure-delivery-proof.cjs` after migration 28. It creates scoped
delivery command, attempt, challenge, send, exception, approval, proof and audit tables;
extends only the T05/T08/T06 Parcel edges and delivery event catalog; and narrowly permits
delivery-owned `delivery_otp` sources in the existing WhatsApp outbound ledger. Released
migrations are unchanged. A populated migration-28 database, injected failure rollback,
unchanged retry and repeat no-op are covered by `delivery-proof.test.ts`.

After resolving the deployment runtime identity, retain the existing Parcel, attachment and
WhatsApp outbound grants and add:

```sql
GRANT SELECT, INSERT ON
  shipit.delivery_commands, shipit.delivery_recipients, shipit.delivery_attempts,
  shipit.delivery_challenges, shipit.delivery_challenge_sends,
  shipit.delivery_exception_requests, shipit.delivery_exception_approvals,
  shipit.delivery_proofs, shipit.delivery_audit_events TO runtime_role;
GRANT UPDATE(state,http_status,result,committed_at,retain_until)
  ON shipit.delivery_commands TO runtime_role;
GRANT UPDATE(state,failed_verifications,resend_count,locked_at,closed_at,version,
  close_delivery_command_id,close_parcel_command_id)
  ON shipit.delivery_attempts TO runtime_role;
GRANT UPDATE(verifier,encrypted_secret,superseded_at,superseded_by,consumed_at,closed_at)
  ON shipit.delivery_challenges TO runtime_role;
GRANT UPDATE(state,decided_at,decision_command_id)
  ON shipit.delivery_exception_requests TO runtime_role;
GRANT EXECUTE ON FUNCTION shipit.delivery_challenge_cleanup_scope(timestamptz)
  TO runtime_role;
```

Do not grant broad UPDATE, challenge-secret SELECT outside the delivery runtime,
DELETE/TRUNCATE, DDL, ownership or trigger-function execution. `prepareDeliveries()` is the
executable reference. Rollback disables compatible routes/workers, retains evidence and
repairs forward. See [secure deliveries](../../docs/architecture/deliveries.md).
