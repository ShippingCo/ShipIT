# Testing contract — Issue 9

[Architecture](README.md) · [Verification](issue-9-verification.md) · [Testkit](../../packages/testkit/README.md) · [Quality](../QUALITY_CHECKS.md)

This M0 contract establishes executable test infrastructure. Fastify, PostgreSQL, auth,
business endpoints, tables, provider adapters and workers remain unimplemented.
Real PostgreSQL integration testing is intentionally not active until Issue #10.
No Fastify injection or real SQL test is claimed to have run.

## Choose layers by changed behavior

Not every PR needs every testing layer. The author selects applicable layers and explains
meaningful omissions, especially deferred dependency coverage. Missing verification for an
implemented security/transaction boundary cannot be dismissed as an optional layer.

| Layer | Responsibility | Placement and runner |
| --- | --- | --- |
| Unit | Pure calculations, state guards, authorization helpers, validation, mapping and deterministic business rules; no DB/providers | Future colocated `*.test.ts` in owning API modules/shared; reuse Vitest. Testkit tooling uses Node `src/*.test.ts` now |
| Database integration | Real SQL semantics, constraints, indexes/query plans, transactions, locks, migrations, concurrency, tenant persistence | Planned `packages/db/test/integration/`; domain SQL cases in `apps/api/test/database/`. Real PostgreSQL only; #10 activates runner |
| API/service integration | HTTP validation, safe errors, then auth/authorization, tenant isolation, state transitions, idempotency and transaction outcomes as implemented | Planned `apps/api/test/integration/`; Fastify injection with Vitest; #11 and feature owners activate |
| Contract | Provider ports, raw-byte webhook signatures, schemas/compatibility, callback parsing, retries | Planned owning `apps/api/src/modules/<domain>/test/contract/`; synthetic provider ports, Vitest; no production accounts |
| Worker | Retries, leases, duplicates, stale/gap/poison events, crashes, recovery and uncertain provider acceptance | Planned `apps/api/test/worker/`; Vitest with controlled clock/provider; real DB when durable/concurrent behavior is under test |
| Browser | User-visible flows, accessibility, keyboard/focus and important UI/backend boundaries | Existing `apps/web/src/test/` uses Vitest/Testing Library in jsdom; real browser journeys belong in future `apps/web/test/browser/` when required. jsdom is not a real browser |

The table's **planned** paths are conventions, not empty suites passing CI. Frontend
changes keep the #7 [regression inventory](prototype-migration-inventory.md). Backend
changes do not automatically require browser tests. Unit tests cannot certify DB isolation.
Use the minimum existing runners: Node for dependency-free tooling, Vitest for application
TypeScript/React. No competing test framework or new third-party version is introduced here.

## Commands and ownership

| Command | Current behavior |
| --- | --- |
| `pnpm test:unit` | Executes testkit's Node tests; no external services |
| `pnpm test:web` or `pnpm --filter @shippingco/web test` | Existing standalone frontend tests; no PostgreSQL needed |
| `pnpm test` | Testkit then frontend; either failure fails the command |
| `pnpm test:db` | Explicit nonzero `DB_TEST_RUNTIME_NOT_ACTIVE` diagnostic until #10 |
| `pnpm test:quality` | Existing tooling/gate checks plus test harness inclusion and import-boundary checks |
| `pnpm quality` | Exact toolchain, tooling tests, planning checks, lint, all workspace typechecks, `pnpm test`, build |

The existing CI `Quality (tests)` runs `pnpm test`; the final required check still requires
every matrix job to succeed. M0 does not include the intentionally inactive DB command in
quality. This explicit boundary is different from silently skipping a required dependency.
After #10 activation, the DB CI job must fail on absent configuration, unreachable service,
unapplied migrations, unavailable extensions or setup/cleanup failure; no skip/pass-if-empty,
`continue-on-error`, connection-error catch returning success, or conditional green suite.

## Shared test-only fixture API

`packages/testkit` is justified by API, DB, worker and provider tests needing identical
identities and failure semantics. It has no application dependencies. Add it only to a
consumer's `devDependencies`; never import it from production modules or shared public DTOs.
ESLint restricts production imports; tooling tests check manifest dependency boundaries.
Frontend tests may opt in from test files; production browser bundles must contain none of
these fixtures. Do not move fixtures into `packages/shared` to make them easier to import.

Builders accept focused overrides and derive ownership from parent objects. Actor builders
reject organization/franchise contradictions and role/scope mismatches. Organization and
franchise IDs are deterministic fictional UUIDs from `fixtureId(serial)`; no random UUID
or wall-clock defaults. Repeated serialization is stable and each call returns fresh data.
Explicit IDs identify distinct objects: constructing defaults twice represents the **same**
logical object. These fields do not specify production table layout or identifier allocation.

`createTenantIsolationFixture()` provides:

- Organization Alpha with Franchise Alpha-1 and Franchise Alpha-2; Organization Beta with Franchise Beta-1.
- `alphaOrgAdmin`, `alpha1FranchiseAdmin`, `alpha1Operator`, `alpha1Dispatcher`,
  `alpha1DeliveryAgent`, `alpha1Accountant`, `alpha1ReadOnly`, `alpha2Operator`, `beta1Operator` under `actors`.
- Customer → Booking → Parcel chains under `shipments.alpha1`, `shipments.alpha2`, `shipments.beta1`.
- `scenarios.own`, `.sibling`, `.foreign`, containing actor, existing resource and expected scope rule.

Exactly seven roles mirror [the accepted matrix](authorization-contract.md). org_admin
has explicit own-org reads/audit/verification, no implicit operational superuser powers.
Delivery-agent fixtures carry membership, not an automatic assignment or custody grant.
Future tests supply explicit current assignment/grant evidence for A/G cases.

Use `createOrganizationFixture`, `createFranchiseFixture`, `createActorFixture`,
`createCustomerFixture`, `createBookingFixture`, `createParcelFixture` and
`createRouteLotReferences` for composition. Add another Parcel ID to the same Booking for
multi-piece cases. Route/lot references do not confer custody or parent-record access.
All contact data is an opaque `contact_synthetic_*` reference; no real phone, address,
email, GSTIN, OTP/verifier, token, credential or production provider payload is copied.
Use `.example` if future fixtures need domains and non-dialable labels for phone fields.
Only the provider synthetic signing fixture contains a public test-only key.

## Tenant isolation and API seam

Own-franchise permission is determined by exact action/role/state/projection rules.
Same organization is never sufficient for sibling authorization. The default sibling
case denies unless the exact approved O/V/C/A/G scope explicitly permits that operation;
custody never grants sibling customer-directory or parent-booking traversal. Foreign
organization is denied. Server queries authorize every nested ID, count, search, export,
attachment and replay; frontend filters are never authorization.

A future integration test seeds **all three** shipment chains, authenticates the Alpha-1
actor through the implemented test auth seam, and supplies the existing foreign UUID:

```ts
const f = createTenantIsolationFixture();
const app = await buildServer(testDependencies);
try {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/parcels/${f.shipments.beta1.parcel.id}`,
  });
  // With authenticated Alpha-1 context: uniform 404 RESOURCE_NOT_FOUND,
  // no foreign payload and no mutation/audit/outbox effect except safe denial audit.
} finally {
  await app.close();
}
```

This is a **future example**, not an executable API test. `apps/api/src/index.ts` owns
startup/listening/signals; future `server.ts` exports `buildServer(dependencies)` and
starts no port. Tests close server/pools in teardown. Inject clock/providers/config and
later DB dependencies. No TCP port unless testing actual network behavior. #11 selects
concrete dependency types while implementing Fastify; #13/#14 add real auth/memberships.
Assert persisted facts and forbidden effects as well as status codes. Compare known
foreign and nonexistent IDs so IDOR denial does not disclose existence.

## Time, events, providers and failure points

`createFakeClock()` returns `now()`, `set(UTC instant or Date)`, `advance(milliseconds)`.
`now()` returns a defensive Date. Inject the `Clock` interface at future time-sensitive
boundaries. Advance immediately for challenge expiry, resend cooldown, hold deadlines,
idempotency retention, event timestamps and retries; never sleep. Calendar policy remains
#66; the helper imposes no business-day assumption and implements no OTP behavior.

`createEventFixture(parcel, overrides)` builds the exact accepted `parcel.booked` envelope:
`event_id`, `event_type`, `schema_version`, owning organization/franchise, aggregate type/ID/
version, `occurred_at`, actor, correlation/causation/command IDs and safe `booking_id` payload.
`replayFixture(event)` preserves identity and bytes with an independent copy. Add distinct
catalog builders under the [event contract](event-contract.md); no invented event types.
Overrides support stale versions, old fact times and unknown schema 99 for negative tests.
Do not change content under the same event ID except in an intentional integrity test.

`createIdempotencyScenarios()` supplies original, same-key/same-fingerprint replay and
same-scoped-key/different-fingerprint inputs. Its fingerprint is an opaque **test label**,
not a hash implementation. The [idempotency contract](idempotency-contract.md) still owns
canonical typed intent, scope tuple and 24-hour minimum retention; #4's existing planning
validator checks canonicalization examples. Future implementations must prove replay
reauthorization, original-result return and concurrent dedupe against real persistence.

`createFakeProvider(outcomes, clock)` implements a small fake send port. Explicit script
outcomes: `accepted`, `rejected`, `timeout-before-acceptance`, `accept-then-timeout`.
Both timeouts look uncertain to the caller; test-side `accepted()` exposes whether the
fake accepted before timing out. Script exhaustion fails instead of silently succeeding.
No network path exists. Provider acceptance is not recipient delivery or Parcel delivery.

`createProviderCallbackFixture(overrides)` creates synthetic signed raw bytes with provider,
installation, tenant, stable event/message identity, timestamp, version and normalized status.
The **public fictional HMAC key** is not a provider credential. `verifySyntheticCallback`
models byte-integrity only; it does not verify a real provider protocol, freshness or tenant
authority. #36/#53 own real signatures/install binding/parsing/compatibility.

- `scheduleCallback('duplicate', callback)` delivers independent copies with the same bytes/signature/identity.
- `scheduleCallback('delayed', callback, delayMs)` and `drainCallbacks()` release at the fake deadline.
- `scheduleCallback('invalid-signature', callback)` models invalid authentication.
- Build old `occurred_at` or `schema_version: 99`, then schedule normally for stale/unknown-version consumer tests. A valid signature alone never makes them acceptable.

Worker tests supply retries, leases, stale/gap/poison sequences and restart boundaries,
asserting committed effect identity and reconciliation. Reset callbacks, acceptance history,
clock and script by constructing a fresh provider per test. Do not assume SQL rollback
resets external acceptance or asynchronous work. Unknown acceptance must not blindly resend.

`atCommitBoundary(point, commit)` defines reusable business failure semantics:

| Failure point | Evidence and future assertion |
| --- | --- |
| `failure-before-commit` | Does not invoke commit; no business/audit/result/outbox successful persistence |
| `commit-then-timeout` | Awaits successful commit, then throws `InjectedFailure`; retained facts/result/outbox survive lost client response; replay same key/body |
| `none` | Returns original result; genuine commit rejection propagates without claiming timeout-after-commit |
| `createStaleVersionFixture(N)` | Expected N, actual N+1; safe integer bounds; future stale new writes reject without mutation |
| `replayFixture(event)` / duplicate callback | Same logical identity twice; future consumer persists one deduplicated effect |

The callback supplied to `atCommitBoundary` must resolve **after** durable COMMIT. Do not
pass an uncommitted mutation or a fire-and-forget promise. M0 tests use a synthetic evidence
array to prove ordering, not SQL atomicity. #10/feature tests must inspect real committed
business + audit + result + outbox together and prove rollback/error behavior separately.

## Fail-closed database configuration

`validateTestDatabaseConfig(env, policy?)` is a pure validator with no connection attempt.
Require `NODE_ENV=test`, `TEST_DATABASE_URL`, `TEST_DATABASE_IDENTITY=db_test` (or
`db_test_<worker>`), and a database named `*_test` or `*_test_<worker>`, max 63 characters.
There is **no ordinary DATABASE_URL or DATABASE_SECRET_REF fallback**. Identity is separate
from the DB login role; #10 creates limited test roles and binds the asserted identity to
runner-managed resources. This extends #6 for test processes without redefining app modes.

Default allowed hosts are localhost/127.0.0.1/::1 only. CI runner policy explicitly supplies
reviewed `allowedHosts`, `forbiddenHosts` and `forbiddenIdentities`. No host is inferred from
the URL. Known production/staging host markers and declared deny entries win over allowlists;
non-test identities (including #6's db_production/db_staging/db_demo/db_developer) are refused.
Use deployment inventory to populate denials for neutral production aliases. Arbitrary remote
hosts fail by default, while a disposable CI service named `postgres` can be explicitly approved.

Only postgres/postgresql URLs with a literal test-name path are accepted. Query/fragment
options are rejected because connection parameters can override host/database. #10 must
review any TLS/connection-option extension as typed configuration preserving this guard.
Errors expose only `UNSAFE_TEST_DATABASE_CONFIGURATION`, never a URL, password or input.
The returned connection configuration is sensitive: pass it to the driver, never log it.

Pure validation cannot verify DNS destinations, role privileges or a dishonest allowlist.
#10/#68 must isolate test networks, prohibit production credentials/access, provision exact
allowlisted disposable resources, bind deployment identities, and revalidate the final
resolved target before migrations/reset. Never accept a production host just because its
database was named `_test`. Test fixtures/logs contain synthetic references only.

## Database isolation, cleanup and Issue #10 activation checklist

Issue #10 is the activation point for real PostgreSQL integration tests. It must:

1. Review/install `pg` and `node-pg-migrate`; implement pool, one-connection transactions,
   forward-only migration runner and migration locking. No ORM or fake SQL engine.
2. Replace `scripts/test-database.mjs` with the real runner; retain explicit failure for
   missing config/service/migrations or zero discovered required tests. Update the inactive
   command assertion to exercise missing/unreachable DB against the activated runner.
3. Provision a dedicated disposable database per run/worker, e.g. `shipit_run7_test_2`,
   scoped least-privilege test roles and a trusted policy; apply the guard **before** connect,
   create, migrate, reset or drop. Never share developer app, demo, staging or production DBs.
4. Apply forward migrations and seed canonical fixtures for each isolated worker. Single-
   connection tests may roll back their transaction. Worker/concurrency/migration tests use
   committed, multiple-connection state: stop workers, drain/cancel queued work, close all
   connections, then drop/recreate the guarded disposable worker DB and rerun migrations.
   A failed teardown fails the suite; interrupted-run cleanup is bounded to the runner's
   registered test resources, never an unrestricted database-name glob.
5. Test fresh installation, upgrade from a prior migration snapshot, and repeat application
   as no-op; test failed migrations, locks and concurrent runners. Never edit applied files.
6. Add the actual PostgreSQL service/job to CI with readiness/connection deadlines and a
   reviewed supported version. Make the final required check depend on it and update
   `scripts/quality.test.mjs` so failure/cancellation/skip/missing results cannot pass.
   Update `pnpm quality`/full M1 checks to require DB testing. Frontend-only command stays independent.
7. Prove missing/unreachable PostgreSQL makes the required job red; prove per-worker isolation,
   runtime-role privileges and cleanup after failure. Record current-head CI evidence.

#11 then wires `buildServer`, configuration and injection tests; #12/#14/#15 and business
owners add actual tenant schema/auth/query tests. #35/#36/#39/#40 add durable worker/provider
failure and replay evidence. No M0 harness test certifies these future implementations.
Cursor integrity/lifetime and API compatibility support windows remain #23/feature rollout
decisions: #9 defines tamper, expiry, scope-change and old-reader test responsibilities,
without inventing a cursor implementation or retirement interval before those features exist.
