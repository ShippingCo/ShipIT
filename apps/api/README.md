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

`createTenancyService({ database, authorizer })` receives a trusted server adapter
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

Issue #16 makes audit insertion mandatory inside each sensitive tenancy transaction.
The optional `audit.record` observer now runs before commit, after the durable insert;
it cannot replace persistence and must not perform external side effects. Its failure
rolls back both state and audit. See [the canonical audit contract](../../docs/architecture/audit-contract.md)
for compatibility, exact runtime grants, R28 GET retrieval, opaque cursor rules and safe
denial telemetry. Production tenancy route activation remains with its owning coordinator.

## Independent operator entry (Issue #17)

`POST /api/v1/onboarding` atomically creates the initial roots/admin/audit/replay outcome
for a signed-in, previously verified identity with no membership history.
`GET /api/v1/operator-context` and its `/franchises/:franchiseId` variant return only live,
usable granted profiles. Existing CSRF/cookie, invitation, audit and scope contracts apply.
See [request/retry/role/rollout rules](../../docs/architecture/independent-onboarding.md)
and [verification](../../docs/architecture/issue-17-verification.md). Public unverified
account registration is not added; use the trusted #13 verified identity provisioning seam.

## Booking creation — Issue #22

With authenticated API composition enabled, `POST /api/v1/bookings` takes validated
organization_id/franchise_id query selectors, one Idempotency-Key and strict commercial
input. Only a current operator of that active Franchise is admitted. One transaction
confirms the existing private Customer, quote and tax proposal, creates 1–50 Parcels with
global dockets, and commits the initial obligation, original response, audit and events.
See [full request/response and failure contract](../../docs/architecture/bookings.md) and
[synthetic tests and rollout](../../docs/architecture/issue-22-verification.md).
Apply migration and explicit runtime grants first. No frontend production booking flow,
search API, worker, lot, payment collection or issued customer receipt is enabled here.

## Parcel retrieval — Issue #23

Authenticated staff retrieval uses the ratified resource routes:

```text
GET /api/v1/parcels?organization_id=<uuid>&franchise_id=<uuid>&docket=<docket>&status=<status>&customer_id=<uuid>&from=<UTC>&to=<UTC>&sort=<allowlisted>&limit=<1..100>&cursor=<opaque>
GET /api/v1/parcels/<parcel_uuid>?organization_id=<uuid>&franchise_id=<uuid>
GET /api/v1/parcels/<parcel_uuid>/timeline?organization_id=<uuid>&franchise_id=<uuid>
```

Only `organization_id` is required; each other list filter is optional. The first endpoint
has an additional 30 requests/minute/process search budget. Responses use explicit safe
Parcel/timeline projections and `Cache-Control: no-store` through the authenticated boundary.
Lists return `{items,page:{next_cursor,has_more}}`, never a tenant-wide total. Cursors are
short-lived authenticated ciphertext bound to identity, current authorization and the exact
normalized query; they are not transferable and do not replace authorization. See the
[retrieval contract](../../docs/architecture/bookings.md#tenant-isolated-retrieval--issue-23)
and [verification](../../docs/architecture/issue-23-verification.md).

## Guarded Parcel lifecycle — Issue #24

`src/modules/parcels/` adds strict check-in, dispatch, transit, failed-attempt and RTO POST
commands. Live membership, tenant scope, aggregate lock/version, durable idempotency receipt,
state mutation, audit transition and domain event execute in one transaction. Failure commands
must match the stored active attempt and assigned agent. Direct delivery/out-for-delivery and
generic status mutation routes do not exist. See the [lifecycle contract](../../docs/architecture/parcel-lifecycle.md#issue-24-implementation-boundary),
[ADR](../../docs/adr/0014-guarded-parcel-lifecycle-commands.md) and
[verification](../../docs/architecture/issue-24-verification.md).

## Issue #25 bounded Parcel bulk API

POST `/api/v1/parcels/bulk` supports check-in/dispatch only, 1–50 submitted entries,
strict whole-envelope validation, live per-item authorization and independently atomic
commands. See [exact wire/retry/rollout contract](../../docs/architecture/parcel-bulk.md)
and [verification](../../docs/architecture/issue-25-verification.md).

## Persistent lots (#26)

The authenticated lots module exposes the [ten endpoints and closed DTOs](../../docs/architecture/lots.md).
It uses the existing transaction/capability/RBAC boundary, shared error envelope and API
client contract. No browser screen cutover is activated. Local franchise_admin/operator/
dispatcher W04 manages pre-dispatch grouping; explicit dispatcher authority gates later
changes. R08 reads, canonical pricing destinations, stable replay, bounded cursors and safe
errors are specified in that contract. No Parcel lifecycle status setter is added.

Apply [lot schema and grants](../../packages/db/README.md#issue-26-persistent-lots) first.
Run `pnpm db:local test:db` for synthetic API/PostgreSQL workflows including A/B/C, dispatch/
archive, races and lost response. Run `pnpm test:api` for validation/cursor/role tests.
[Acceptance evidence](../../docs/architecture/issue-26-verification.md) covers the full gates.
Rollback compatible code while retaining all grouping and audit/event history; never use demo
state as recovery. Existing #24 manifest evidence stays opaque until #27.

## Issue #27 Routes and manifests

Normal authenticated buildServer composition registers the [12 Route endpoints](../../docs/architecture/routes.md#http-and-dtos), including planning metadata, typed source commands, archive/finalize and bounded immutable manifest reads. Deploy the additive Route migration and exact runtime grants first. New T03 dispatch requires a same-scope finalized manifest containing the Parcel; legacy exact receipt replay remains valid. Carrier metadata performs no external work. No route-event endpoint or production screen is introduced. [Verification](../../docs/architecture/issue-27-verification.md).

## Issue #28 Route events

[Operational Route contract](../../docs/architecture/route-events.md) adds typed departure/delay/arrival POST and bounded latest/event-detail GET endpoints. It uses W18 plus exact Parcel W09, immutable manifest effects, explicit nullable route-leg ETA and original-response replay. Screens and notifications remain with their downstream owners.

## Issue #29 Payments

The authenticated [Payments module](../../docs/architecture/payments.md) registers collection,
linked reversal, current balance and safe entry reads under Booking payments. W20/W21 remain
franchise_admin only; accountant has financial reads. Deploy the additive migration/grants
first. Both Paid counter and To-Pay use one row-locked, append-only ledger; no payment UI,
provider execution, automatic delivery settlement or receipt issuance is introduced.

## Issue #30 immutable issued receipt retrieval

Authenticated R13 routes (each requires organization_id/franchise_id query selectors):

- `GET /api/v1/bookings/:booking_id/receipt`
- `GET /api/v1/bookings/:booking_id/payments/:payment_id/receipt`
- `GET /api/v1/receipts/:receipt_id`

The first two materialize one canonical immutable artifact on first authorized retrieval;
subsequent retrievals return its original ID, number, issued time and snapshot. This
explicit GET persistence exception is recorded in ADR 0020. No HEAD issuance, request
body, Idempotency-Key, public URL or PDF service. Direct ID only reads existing artifacts.
Use no-store JSON for explicit local printing; never fall back to browser store data.

R13 allows org_admin in an explicitly selected own-org franchise, and franchise_admin,
operator and accountant in their own granted franchise. Dispatcher, delivery_agent and
read_only are denied. Foreign/unknown nested IDs share 404; malformed query/UUID is 422,
missing session 401, denied role 403, dependency/invariant/uncertain commit 503. Historical
reads remain available on disabled roots, subject to live membership/session checks.

Booking documents say Booked total; collection/reversal documents copy one actual ledger
entry and do not claim current settlement. Delivery has no effect on them. No payment,
event or messaging side effect. Apply migration and minimum DB grants before rollout;
missing schema fails closed. Roll back compatible receipt code, retain issued evidence.
[Contract](../../docs/architecture/receipts.md), [ADR 0020](../../docs/adr/0020-immutable-issued-receipts.md),
[verification](../../docs/architecture/issue-30-verification.md). #33 retains full production
screen/client-adapter migration; the existing demo calls its explicitly fictional adapter.
