# Testing contract — Issues 9–11

[Architecture](README.md) · [Issue 9 history](issue-9-verification.md) · [Testkit](../../packages/testkit/README.md) · [Quality](../QUALITY_CHECKS.md)

Issue #9 established the shared test infrastructure; #10 activates real PostgreSQL
pool, transaction and migration tests. #11 activates Fastify injection and API/DB
compatibility. Auth, business endpoints/domain tables,
provider adapters and workers remain with their implementation issues. The original
M0 acceptance evidence remains historical; current PostgreSQL coverage is described below.

## Choose layers by changed behavior

Not every PR needs every testing layer. The author selects applicable layers and explains
meaningful omissions, especially deferred dependency coverage. Missing verification for an
implemented security/transaction boundary cannot be dismissed as an optional layer.

| Layer | Responsibility | Placement and runner |
| --- | --- | --- |
| Unit | Pure calculations, state guards, authorization helpers, validation, mapping and deterministic business rules; no DB/providers | Testkit and DB use Node `src/*.test.ts`; future owning API/shared application tests reuse Vitest |
| Database integration | Real SQL semantics, constraints, indexes/query plans, transactions, locks, migrations, concurrency, tenant persistence | Active Node tests in `packages/db/test/integration/`; API runtime restart/outage case in `apps/api/test/database/`; future domain SQL cases share that path. Real PostgreSQL only |
| API/service integration | HTTP validation, safe errors, then auth/authorization, tenant isolation, state transitions, idempotency and transaction outcomes as implemented | Active `apps/api/test/integration/`; Fastify injection with pinned Vitest via `pnpm test:api` |
| Contract | Provider ports, raw-byte webhook signatures, schemas/compatibility, callback parsing, retries | Planned owning `apps/api/src/modules/<domain>/test/contract/`; synthetic provider ports, Vitest; no production accounts |
| Worker | Retries, leases, duplicates, stale/gap/poison events, crashes, recovery and uncertain provider acceptance | Planned `apps/api/test/worker/`; Vitest with controlled clock/provider; real DB when durable/concurrent behavior is under test |
| Browser | User-visible flows, accessibility, keyboard/focus and important UI/backend boundaries | Existing `apps/web/src/test/` uses Vitest/Testing Library in jsdom; real browser journeys belong in future `apps/web/test/browser/` when required. jsdom is not a real browser |

The table's **planned** paths are conventions, not empty suites passing CI. Frontend
changes keep the #7 [regression inventory](prototype-migration-inventory.md). Backend
changes do not automatically require browser tests. Unit tests cannot certify DB isolation.
Use the existing runners: Node for tooling, DB infrastructure and testkit; Vitest for
application TypeScript/React. PostgreSQL dependencies are recorded in the
[Issue #10 dependency review](issue-10-dependency-review.md).

## Commands and ownership

| Command | Current behavior |
| --- | --- |
| `pnpm test:unit` | Executes testkit and DB unit tests; no external services |
| `pnpm test:api` | API configuration/security/lifecycle tests using Vitest injection and synthetic dependencies |
| `pnpm test:web` or `pnpm --filter @shippingco/web test` | Existing standalone frontend tests; no PostgreSQL needed |
| `pnpm test` | Testkit/DB unit tests, API injection, then frontend; any failure fails the command |
| `pnpm test:db` | Runs 17 DB plus 1 API real PostgreSQL integration cases; guarded bootstrap configuration required |
| `pnpm db:local test:db` | Creates the pinned disposable PostgreSQL service, supplies generated bootstrap configuration, runs integration tests and cleans up |
| `pnpm test:quality` | 10 tooling tests, including final CI gate, migration immutability, container lifecycle and import boundaries |
| `pnpm quality` | Exact toolchain, tooling tests, planning checks, lint, all workspace typechecks, `pnpm test`, required `pnpm test:db`, build |
| `pnpm db:local quality` or `pnpm db:local` | Runs full quality against a freshly provisioned disposable PostgreSQL service |
| `pnpm db:local verify:gates` | Runs the disposable-checkout failure drills with a valid bootstrap for clean/restored quality |
| `pnpm check:migrations` | Separately compares released migration files with `MIGRATION_BASE_SHA` or fetched `origin/main`; required in CI |

CI `Quality (tests)` runs `pnpm test`; **PostgreSQL integration** runs
`pnpm db:local test:db`. The branch-required **Planning and prototype checks** job
uses `always()` and accepts exactly two successful results: the whole matrix and the
PostgreSQL job. Failed, cancelled, skipped, missing or malformed results fail closed.
Absent/unsafe DB configuration, unreachable service, empty/incomplete required tests,
migration failure and setup/cleanup failure cannot yield a green database suite.

The planning matrix job also requires `pnpm check:migrations` against the PR base SHA
or previous main SHA. Released migration changes/deletions/renames fail; new forward
files are allowed. Missing base history fails closed. This history check is separate
from `pnpm quality`, whose disposable verification snapshot has no Git history.

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
startup/listening/signals; `server.ts` exports `buildServer(dependencies)` and
starts no port. Tests close server/pools in teardown. Inject clock/providers/config and
DB dependencies. No TCP port unless testing actual network behavior. #11 implements these infrastructure types; #13/#14 add real auth/memberships.
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
pass an uncommitted mutation or a fire-and-forget promise. The #9 helper tests use a
synthetic evidence array to prove ordering. #10 separately tests real SQL commit/rollback
and uncertain commit outcomes using synthetic tables. Feature tests must later inspect
committed business + audit + result + outbox together and prove rollback/error behavior.

## Fail-closed database configuration

`validateTestDatabaseConfig(env, policy?)` is a pure validator with no connection attempt.
Require `NODE_ENV=test`, `TEST_DATABASE_URL`, `TEST_DATABASE_IDENTITY=db_test` (or
`db_test_<worker>`), and a database named `*_test` or `*_test_<worker>`, max 63 characters.
There is **no ordinary DATABASE_URL or DATABASE_SECRET_REF fallback**. Identity is separate
from the DB login role; the runner creates limited test roles and binds the asserted identity to
runner-managed resources. This extends #6 for test processes without redefining app modes.

Default allowed hosts are localhost/127.0.0.1/::1 only. The runner's trusted static policy
also permits the reviewed `postgres` service name; the Docker helper uses 127.0.0.1.
No allowlist is accepted from environment variables, and no host is inferred from
the URL. Known production/staging host markers and declared deny entries win over allowlists;
non-test identities (including #6's db_production/db_staging/db_demo/db_developer) are refused.
Use deployment inventory to populate denials for neutral production aliases. Arbitrary remote
hosts fail by default.

Only postgres/postgresql URLs with a literal test-name path are accepted. Query/fragment
options are rejected because connection parameters can override host/database. Any future
test URL connection-option extension requires review preserving this guard.
Errors expose only `UNSAFE_TEST_DATABASE_CONFIGURATION`, never a URL, password or input.
The returned connection configuration is sensitive: pass it to the driver, never log it.

Pure validation cannot verify DNS destinations, role privileges or a dishonest allowlist.
The helper provisions an exact owned disposable service on loopback; the test runner
checks bootstrap privileges and revalidates resource targets before database operations.
Deployment/network policy remains #68's responsibility. Never accept a production host
just because its database was named `_test`. Test fixtures/logs contain synthetic references only.

## Active PostgreSQL coverage, isolation and cleanup

Issue #10 uses reviewed `pg` and `node-pg-migrate` with real PostgreSQL 18.6. The suite
has **17 integration cases** across three files:

| File | Cases | Required behavior |
| --- | --- | --- |
| `migrations.test.ts` | 5 | Fresh migration/ledger and repeat no-op; prior snapshot upgrade preserving state; failed migration rollback and recovery; concurrent processes contending for the real advisory lock; lock recovery after owner disconnect |
| `transactions.test.ts` | 5 | One-client commit and restart persistence; SQL-error rollback; callback-error rollback; caught SQL failure cannot report aborted-transaction success; connection loss at commit yields uncertainty and recovery |
| `pool-security.test.ts` | 7 | Hostile bound values remain data; runtime DML privileges and denied DDL/cross-database access; pool exhaustion deadline/recovery; shutdown settles queued acquisitions; statement timeout; safe readiness during outage/recovery; isolated resources and registered cleanup |

`scripts/with-test-postgres.mjs` creates a uniquely named container from the pinned
PostgreSQL 18.6 Bookworm manifest, with a random loopback port and bootstrap database
`shipit_control_test`. Its generated bootstrap password is passed through child
environment, never a command argument. PostgreSQL uses `log_statement=none` and
`log_min_error_statement=panic`. TCP readiness has a deadline. The helper supplies
`NODE_ENV=test`, `TEST_DATABASE_IDENTITY=db_test` and `TEST_DATABASE_URL`, propagates
the command status and removes only its owned container and anonymous volumes in cleanup.

`scripts/test-database.mjs` requires a usable guarded bootstrap and actual required
test execution. `packages/db/test/support.ts` creates a fresh `shipit_<random>_test_1`
database and correlated migration/runtime roles for each provisioned resource. Generated
resource names and role relationships are checked before operations; migration and
runtime credentials remain separate. The runtime role receives DML only on synthetic
fixture tables. The implementation migration creates infrastructure only, not tenant or
business tables. Canonical tenant fixtures remain available for future domain SQL tests.

Tests close tracked pools before cleanup; the parent also cleans its exact registered
databases and roles after failures or interruption. A failed teardown fails the suite.
The resource registry contains names only, and cleanup never expands an unrestricted
database-name pattern. Tests needing committed or concurrent behavior use isolated
databases, real connections and real migration locks; transaction rollback alone is
insufficient for those boundaries. Released migrations remain immutable; corrections
use new forward files and the separate Git-history check enforces that rule.

The **10 tooling tests** exercise CI and cleanup behavior as well as lint/import
boundaries. The full failure-verification command has **21 stages**, checking
clean/restored quality, missing/unreachable PostgreSQL, zero discovered files,
discovered files without tests, all-skipped required execution, and the exact
final CI gate's rejected database results. Missing dependencies or skipped required
tests must remain failures; no `continue-on-error`, pass-if-empty or retry-until-green.

#11 then wires `buildServer`, configuration and injection tests; #12/#14/#15 and business
owners add actual tenant schema/auth/query tests. #35/#36/#39/#40 add durable worker/provider
failure and replay evidence. No M0 harness test certifies these future implementations.
Cursor integrity/lifetime and API compatibility support windows remain #23/feature rollout
decisions: #9 defines tamper, expiry, scope-change and old-reader test responsibilities,
without inventing a cursor implementation or retirement interval before those features exist.


## Issue #11 API activation

`pnpm test:api` runs Vitest 3.2.6 in Node with `apps/api/test/integration/**/*.test.ts`.
Normal `pnpm test` now requires unit → API → frontend suites; CI's tests matrix inherits
that command. Only real listener/shutdown/signal cases bind loopback ephemeral ports.
Test-only probes are manually registered in test composition, excluded by production
import rules. Configuration, fake DB and log sink are injected; no global env mutation.
Subprocess startup tests pass a synthetic child environment.

`pnpm test:db` additionally discovers `apps/api/test/database/*.test.ts` and runs it through
the existing guarded Node DB reporter after the DB infrastructure suite. Both groups
must execute nonempty, passing, non-skipped tests. The same registry and exact cleanup
cover both. The API case proves real readiness/outage/recovery and synthetic persistence
after closing/rebuilding server and runtime pool. The required PostgreSQL CI job/final
gate remain intact. No business endpoint, auth or tenant authorization is claimed.

The [Issue #11 verification](issue-11-verification.md) maps each acceptance criterion.
Alpha-1/Alpha-2/Beta-1 fixtures stay available to #12/#13/#14 and later domain tests.
