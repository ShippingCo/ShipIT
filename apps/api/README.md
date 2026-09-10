# @shippingco/api

Fastify **5.12.3**, official CORS **11.3.0** and rate-limit **11.2.0** implement the
Issue #11 HTTP infrastructure boundary. PostgreSQL remains the existing
[`@shippingco/db`](../../packages/db/README.md) implementation. Issues #13 and #14 add
operator authentication and membership/invitation authorization without an ORM or an
external identity/authorization provider.

## Construction and ownership

- `src/index.ts`: read environment, compose startup, install SIGINT/SIGTERM handlers.
- `src/env.ts`: pure `parseEnvironment(env)` returns immutable typed configuration or
  `ConfigurationError` with safe `field`/`code` details, never rejected values.
- `src/server.ts`: synchronous `buildServer({ config, database, logSink? })` constructs
  Fastify and registers infrastructure/health, without listening or connecting to DB.
- `src/runtime.ts`: `startRuntime({ config, secretResolver, logSink?, signal? })`
  resolves the credential, builds one bounded DB pool, attaches lifecycle and listens.
- `src/secrets.ts`: vendor-neutral injectable `SecretResolver`; development-only local
  resolver. `src/lifecycle.ts` owns bounded, idempotent server/pool cleanup.
- `src/plugins/`: errors, strict JSON and safe structured request logging.
- `src/modules/health/routes.ts`: liveness/readiness. Future domain modules retain
  routes, services and parameterized queries beside their owning domain.

Construction transfers no ownership of injected resources: callers using `buildServer`
close their own DB pool, or call `attachLifecycle(app, pool)` before `ready()` to make
server close own the pool. `startRuntime` always attaches this lifecycle. App modules
receive typed dependencies; only the startup/configuration boundary reads environment.
Test-only probes are registered by test plugins; normal composition has no debug route.

## Runtime configuration and local launch

See the exact [configuration contract](../../docs/architecture/configuration-contract.md#api-runtime-configuration--issue-11)
and root `.env.example`. Supply required `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`,
`ALLOWED_ORIGINS`, `TRUSTED_PROXY_HOPS`, `DATABASE_SECRET_REF`, `DATABASE_TLS_MODE`.
`NODE_ENV=development` means developer; demo/staging/production use their literal names.
`NODE_ENV=test` belongs exclusively to disposable test tooling, never application startup.
Nonzero proxy hops also require exact `TRUSTED_PROXY_ADDRESSES`. No automatic dotenv load.

For local startup, provision a loopback synthetic database named `shipit_developer`,
with a least-privilege runtime login `db_developer`, separately from the migration owner.
Supply its URL in ignored local environment as `LOCAL_DATABASE_URL`, with
`DATABASE_SECRET_REF=local:database`, `NODE_ENV=development`, explicit loopback `HOST`,
port, log level, localhost origin, zero trusted hops and explicit TLS mode. Never put
resolved credentials in shell arguments or committed examples. Then run:

```sh
pnpm --filter @shippingco/api start
```

This CLI intentionally supports only developer local composition. Hosted deployment
#68 must compose `startRuntime` with a managed resolver using workload identity and a
version-pinned reference. Demo/staging/production cannot use the local resolver or
`LOCAL_DATABASE_URL`; no cloud vendor is selected here. Secret resolution is bounded to
10 seconds and accepts an abort signal. Staging/production require verified DB TLS;
optional trusted `DATABASE_CA_PEM` is injected, never loaded inside the DB package.
DB configuration retains #10 defaults: 10 connections, 2 s acquisition, 5 s SQL timeout,
6 s query timeout, and at most 4 s pool cleanup with those runtime defaults.

## HTTP and security policy

Every request receives a cryptographically generated UUID in `x-request-id`; supplied
IDs never become identity. Error `correlation_id` matches it. Errors use the exact
[public envelope](../../docs/architecture/api-contract.md); no raw dependency errors.
Malformed URL/HTTP-header transport failures also use controlled correlated envelopes;
408 REQUEST_TIMEOUT and 431 HEADERS_TOO_LARGE preserve HTTP semantics.
Only 422 validation adds safe field/code details, with `$` for the root/unknown field.
Schema paths come from server schemas, never attacker-controlled object keys.
JSON schema validation rejects unknown properties, coercion and silent default insertion.

Only `application/json` (optionally `charset=utf-8`, case-insensitive) is accepted for
bodies. Native JSON grammar validation plus an iterative structural scan reject duplicate
**decoded** keys at any level, `__proto__`/`constructor` keys, nonfinite numbers and more
than 64 containers of nesting. UTF-8 decoding is fatal on invalid bytes. JSON body limit
is exactly **262,144 bytes (256 KiB)** inclusive, then 413 `PAYLOAD_TOO_LARGE`; rejected
bodies never reach handlers. Attachments need their own future upload boundary.

CORS uses an exact canonical origin allowlist, fixed methods and allowed headers;
credentials are enabled only with #13 authentication and its CSRF policy. Hostile origins receive
no browser access grant. CORS is browser policy and grants no server authorization.
Request IDs, IPs, forwarding headers and arbitrary user/franchise/role headers likewise
establish no tenant authority. Proxy trust defaults operationally to explicit zero hops;
nonzero hops require both the bound (1–5) and an exact IP allowlist (max 16). Immediate
unapproved peers cannot establish forwarded host/protocol/IP. #68 must prevent bypass
and ensure trusted proxies overwrite untrusted forwarding metadata.

The official rate limiter permits **120 requests/minute/effective client/process**, with
a bounded 10,000-entry cache and 429 `RATE_LIMITED` plus Retry-After. It is abuse mitigation,
not identity or authorization. Health endpoints are exempt. There is no shared Redis
store; multiple replicas multiply capacity and LRU eviction is possible. #68 provides
edge controls and #74/M7 tunes limits using measurements. HTTP request and connection
timeouts are 30 s, keep-alive 5 s, max 1,000 requests/socket; these do not cancel domain
work. Long-running domain work must observe its own future cancellation/transaction rules.

Pino-compatible JSON logging uses safe request ID, registered route template, method,
status and duration fields. It never logs raw paths/query strings, headers, bodies,
responses, arbitrary error messages/causes, SQL or resolved config. Explicit serializers
empty request/response objects and replace Error payloads; redaction removes known
sensitive fields. All log messages must be controlled literals: serializers cannot sanitize
arbitrary future application text. No caller may log secret-bearing free text or objects.

## Health and shutdown

`GET /health/live` returns 200 `{ "status": "alive" }` without touching DB.
`GET /health/ready` reuses `checkDatabaseReadiness`: 200 `{ "status": "ready" }`, or safe
503 `TEMPORARILY_UNAVAILABLE`. Outage does not prevent construction/listening or liveness.
No DB hostname, login, URL, driver error or SQLSTATE is public.

Shutdown marks stopping, rejects new work, calls official Fastify `close()` to drain HTTP,
then closes the pool once. Graceful drain has a **10 s** budget; total shutdown has a
**15 s** deadline. Drain expiry force-closes HTTP via Node `closeAllConnections`, initiates
and awaits DB cleanup within the total deadline, and reports `SHUTDOWN_FAILED`. It never
reports graceful success after timeout. A stuck pool or failed hook also yields controlled
failure; the process exits nonzero at failure. No upgraded protocols are implemented.
Caller-owned composition must handle rejected shutdown; the CLI does so explicitly.

## Verification and downstream limits

```sh
pnpm test:api
pnpm db:local test:db
pnpm db:local quality
pnpm db:local verify:gates
```

Vitest injection tests live under `test/integration/`; only listener/lifecycle cases bind
`127.0.0.1:0` (signal subprocesses use a just-reserved ephemeral loopback port).
`test/database/runtime.test.ts` runs with #10's guarded Node PostgreSQL runner and tests
real outage/recovery, pool cleanup and synthetic SQL persistence across API/pool restart.
It adds no production fixture endpoint. Frontend tests stay independent of DB/API config.

See [dependency review](../../docs/architecture/issue-11-dependency-review.md) and
[acceptance evidence](../../docs/architecture/issue-11-verification.md). Other business
persistence and product-wide scoped queries remain with later owners.
Canonical `@shippingco/testkit` fixtures remain development-only.

## Issue #14 membership authorization

`src/modules/memberships/` owns the fixed role policy, strict inputs, parameterized SQL,
transactional service and seven authenticated HTTP endpoints. See the
[membership API](../../docs/architecture/membership-authorization.md),
[ADR 0012](../../docs/adr/0012-membership-invitations-and-rbac.md), and
[verification](../../docs/architecture/issue-14-verification.md). Authentication and
membership state are checked from PostgreSQL on every request. Invitation tokens are
returned once and stored only as digests; audit rows contain controlled IDs/actions only.

## Issue #12 tenancy service boundary

`src/modules/tenancy/` owns organization/franchise commands, parameterized repository
SQL, explicit domain-to-DTO mapping and the trusted authorization/audit ports. The
[tenancy ADR](../../docs/adr/0010-organization-franchise-tenancy.md) and
[verification](../../docs/architecture/issue-12-verification.md) define scope and evidence.
No private tenancy routes are registered in `buildServer`; requests to `/api/v1/organizations`
or `/api/v1/franchises`, including mutations, return the normal safe 404. Test-only routes
under `test/tenancy-support.ts` exercise the real service via Fastify injection without
opening a port. They are never imported into runtime composition.

`createTenancyService({ database, authorizer, audit })` receives a trusted server adapter
whose `authorize(action)` supplies the actor, exact action, organization and explicit
permitted franchise IDs. It receives no request headers, bodies or tenant selectors.
The service snapshots approvals; both detail and SQL list queries enforce organization
ownership. #13/#14 must implement current identity/membership, projections and revocation.
`denyTenancyAuthorization` is an available fail-closed adapter; there is no temporary login.
W29 grants franchise profile correction only; W41 grants explicit franchise lifecycle
disable/reactivate. Organization bootstrap/profile/lifecycle and franchise creation
require internal service authority, which is not a staff role.

Bootstrap atomically creates one Organization and its first Franchise. IDs use Node's
`crypto.randomUUID()`. The only profile command field is `display_name` plus
`expected_version`; strict commands reject ownership, code, IDs, timestamps, roles,
unknown properties and generic lifecycle patches. Codes must already match
`[A-Z][A-Z0-9_]{0,31}`; no case/Unicode/punctuation normalization occurs. Duplicate
codes within an organization return `FRANCHISE_CODE_CONFLICT`; unrelated organizations
may share codes. Lifecycles are `active`/`disabled`, with reasons
`administrative_disable`/`administrative_reactivate`. Versions reject concurrent stale
updates. Safe DTOs explicitly allowlist identity/profile/lifecycle/version/UTC fields.

The internal list takes `{limit?, after?: {created_at, id}}`, default 50/max 100.
Ordering is `(created_at, id)` ascending; SQL constrains organization and permitted IDs
before fetching limit+1. `page.next_boundary` is an internal keyset value, not the
future public opaque `next_cursor`. Boundaries must match a currently permitted row.
No global tenant list, global count, deletion or reparent operation exists.

Future operational services must call
`lockActiveFranchiseForOperationalWrite(tx, {organizationId, franchiseId})` with trusted
scope, then write using **that same transaction**. `tx` must be the live capability from
`withTransaction`; runtime checking rejects ordinary pools and expired transactions.
`tenancyTransaction` additionally preserves known tenancy errors after confirmed rollback.
The guard locks Organization then Franchise `FOR SHARE`; lifecycle administration takes
the corresponding exclusive row lock. Locks survive until commit/rollback. Disable
linearizes at commit, after earlier guarded writers finish; newly serialized guards
then fail. Authorized historical reads still work. Organization disable also gates every
child without rewriting child lifecycles; recovery does not reinstate memberships.

The audit port receives only safe IDs, action, lifecycle before/after, expected/committed
versions, controlled reason and UTC time. It runs after confirmed commit, so failures,
stale versions and rollbacks cannot emit false successful facts. **This is not durable
audit**: a crash can lose notification, and an audit adapter failure returns a controlled
503 after the mutation has committed. Do not automatically retry or claim replay
persistence. #16 must integrate durable transactional audit before private production
routes activate; #17 owns authenticated onboarding and its replay guarantee.
