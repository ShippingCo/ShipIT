# Issue #19 verification

Starting main: `ee8baee84ac169ab0d38ef8b422b29f0289d5992`, freshly fetched/pulled with a clean
working tree on 2026-09-12. Main CI run 34685432355 succeeded on that SHA. Prerequisites
#3/#10/#15/#16 are CLOSED with merged PRs #86/#93/#98/#99 present on main. Foundation
contracts, implementation, verification evidence and relevant PRs were inspected.
Branch: `issue-19-tenant-private-customers`. Only #19 execution labels advanced; downstream
issues are unchanged. User explicitly requires delivery as an open PR, without merge or
issue closure. [Owning Customer v1 contract](customers.md).

## Implementation and acceptance evidence

One forward migration: `1789318800000-tenant-private-customers.cjs`. Customers, private
command receipts and separate append-only customer audit source are additive. No applied
migration changed. Scoped nonunique phone/name indexes, ordering index, composite ownership
FKs, immutable identity trigger, command identity uniqueness and customer audit version
uniqueness support the server boundary. Runtime grants are documented in the DB guide.

R05/W03 are implemented as customer.read/list/create/update, with only franchise_admin and
operator explicit local memberships. org_admin V remains unimplemented/fail-closed;
dispatcher, delivery_agent, accountant and read_only have no directory permission. This
reconciles the stale issue's read_only-view sentence with merged authorization authority.
No delete/merge, booking persistence, production customer UI or demo import is included.

| Issue acceptance criterion | Concrete tests / evidence |
| --- | --- |
| Same phone in A/B returns only permitted matches | Real A1/A2/B1 same-phone fixture; two distinct A1 customers, all four IDs preserved; each actor sees only own candidates |
| Ambiguity requires explicit selection | Same-phone IDs stay distinct in DB/DTO and across pages; no automatic selection or merge; #33 consumes IDs |
| Invalid phone/overlength address field validation | Unit and real HTTP 422 field/code assertions; explicit international structure, safe retained display, Unicode/control/length limits |
| Contact edit cannot rewrite booked snapshot | Pure frozen scalar snapshot tested across real Customer PATCH; #22 owns actual Booking persistence |
| read_only denied edits; foreign/unknown same 404 | Seven-role HTTP matrix, A2/B1/unknown Customer ID detail and stale-edit probes; only generic code/message/correlation |
| Search enumeration is bounded | Minimum name/phone prefixes, literal wildcard handling, 1–100 limits, encrypted cursor binding; 30/min additional network budget with safe 429/Retry-After |
| Persistence after reload/restart | API/pool reconstruction returns same DTO, receipt and next cursor; no browser persistence involved |
| Sibling/unrelated/nested/count isolation | Composite parents rejected, immutable owners, scoped detail/search/update/keyset/has_more, foreign rows cannot affect last page |
| Malformed/stale/dependency failures safe | Strict inputs/headers, concurrent stale edits, per-step fault injection, lost COMMIT acknowledgement/replay, outage recovery |
| Logs/audit/API inspected for PII/secrets | Explicit DTOs, reference-only audit and target-free denials, log assertions for synthetic phone/address/name/session; no new browser/private storage |

New focused suites: `apps/api/test/integration/customers.test.ts`,
`apps/api/test/database/customers.test.ts`, `packages/db/test/integration/customers.test.ts`.
The real DB suite checks actual runtime identity/flags, column grants, denied ownership
edits/DDL/deletion/truncation, audit/receipt immutability and forward upgrade with old facts
preserved. Lifecycle races observe actual pg_blocking_pids before releasing COMMIT, in
both write-first and disable-first orders for Organization and Franchise. No provider I/O.

## Execution record

The final full quality execution on 2026-09-12 used Node 22.23.2, pnpm 10.34.5,
Python 3.12.14 and the pinned disposable PostgreSQL 18.6 container. Actual results:

| Exact command / layer | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS, unchanged lockfile/dependencies |
| `pnpm check:migrations` | PASS, all seven released migrations unchanged; one forward addition |
| `pnpm check:toolchain` | PASS, exact three pinned versions |
| `pnpm test:quality` | PASS, 17/17 including customer unscoped SQL rejection |
| `pnpm check:planning` | PASS, document links and canonical domain/security/roadmap contracts |
| `pnpm lint` | PASS, tenant-query AST gate and zero ESLint warnings/errors |
| `pnpm typecheck` | PASS, all five workspace packages |
| `pnpm test` | PASS, 22 testkit + 12 DB harness + 155 API + 86 web tests |
| `pnpm test:api` (also invoked by test) | PASS, 155 tests / 10 files |
| `pnpm test:web` (invoked by test) | PASS, 86 tests / 4 files |
| `pnpm test:db` (inside disposable quality) | PASS, 35 DB + 71 real PostgreSQL API; zero failed/skipped/cancelled/todo |
| `pnpm build` | PASS, API and production web; 61 web modules, demo-isolation build gate active |
| `pnpm db:local quality` | PASS, all constituent gates above, container removed |
| `pnpm db:local verify:gates` | PASS, all 24 stages including clean/restored full quality, expected failures and cleanup |
| `VITE_DATA_MODE=demo pnpm --filter @shippingco/web build --outDir /tmp/shipit-19-demo-dist` | PASS, 1,927 modules; explicit fictional demo remains separate |
| `git diff --check` | PASS |

The new customer suites contribute 29 API unit cases, 15 real PostgreSQL API cases,
four DB cases and one query-security gate case. Counts above are from this execution,
not inherited from earlier issues. The expected DB-runner negative-fixture diagnostics
inside its passing harness tests are intentional. Existing prototype React act warnings
remain visible, as already documented by #18; apps/web source is unchanged. Vite also
warns that the separate /tmp demo output is outside the project root; it is not emptied.

The controlled drills verify empty-store install, clean/restored quality, unscoped SQL,
production/demo import rejection, lockfile drift, lint/promises/async handlers, type errors,
web/testkit/API failures, missing/unavailable DB, empty/zero-execution/skipped DB suites,
the final CI gate's success/failure/cancelled/skipped/missing cases, and missing build input.
Both copied-checkout full quality runs repeated the same 35 DB + 71 API PostgreSQL and
22 + 12 + 155 + 86 unit/web counts with no failures. Their temporary checkout and
disposable container were removed; no deliberate failure modified the working checkout.

Intermediate runs
caught a test fixture missing Content-Type, Fastify query object prototype compatibility,
old migration-count assertions and fixture TypeScript inference. The query planner correctly
chose the scoped ordering index for a broad prefix with LIMIT 3; the selective-prefix test
also checks the dedicated prefix indexes without disabling sequential scans or forcing a
plan. A global-limit regression initially used the deliberately exempt health route;
it now proves 30 searches plus 90 authorized detail reads consume the unchanged global
120-request budget, with request 121 denied. All development failures were corrected.

The representative EXPLAIN test creates 9,000 fictional rows, 3,000 in each of A1/A2/B1,
and runs ANALYZE without planner overrides. Selective phone/name prefixes use
customers_phone_prefix_idx/customers_name_prefix_idx with both owner predicates;
the ordered scoped scan uses customers_order_idx. A broad matching prefix counts
exactly 100 A1 rows despite the same prefix in both foreign scopes. Timing is
environment-dependent and is not an SLA or a foreign-row lookup signal.

Self-review inspected every changed source, migration, test and document, including
the full diff and searches for logging, request bodies, phone/address, ownership,
raw executors, DELETE/UNIQUE, localStorage and secrets. Request bodies occur only at
the HTTP-to-validation boundary; contact values occur only in authorized storage/DTOs
and fictional fixtures. No raw customer SQL exemption, wildcard role, production
browser caller, demo import or released-migration change was introduced.

## Reproduction and synthetic workflow

Use Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14 and Docker. On this host:

```sh
export PATH=/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH
export PYTHON=/tmp/shipit-issue8-tools/python/bin/python3.12
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
VITE_DATA_MODE=demo pnpm --filter @shippingco/web build --outDir /tmp/shipit-19-demo-dist
git diff --check
```

The guarded disposable suite provisions the canonical Alpha/A1/A2 and Beta/B1 roots,
fictional verified identities and live accepted memberships. The synthetic customer fixture
creates two A1 contacts and one each in A2/B1 with the same +1 202-555-0100 contact value.
Run `pnpm db:local test:db` to reproduce the HTTP lookup, detail, replay, update and denial
sequence. API base is `/api/v1/organizations/:organization_id/franchises/:franchise_id/customers`.
GET uses `search_by=phone&q=%2B12025550100`; create is POST `{name,phone,address}` with
Idempotency-Key; PATCH `/:customer_id` replaces contact fields plus expected_version.
Test code obtains synthetic sessions without sending external messages. No real records or
production credentials. All generated containers, databases and roles are cleaned up.

## Rollout, rollback and limitations

Apply the additive migration and explicit minimal runtime grants first, then compatible
server, then verify synthetic calls. All routes use the existing auth activation and
session/CSRF/Origin/logging/error/rate boundaries. No customer UI changes; #33 owns the
later adapter/screens. #22 owns the booking transaction, dockets, persisted party snapshots
and booking events. These downstream issues remain open/blocked pending their prerequisites.

Rollback disables/reverts compatible application code while retaining applied schema and
history. Any schema repair uses a new forward migration. Never import localStorage or use
demo as outage recovery. Existing non-RLS limitations apply: compromised raw DB credentials
are outside the capability/AST model. Search limits are per API process/network, with bounded
cache; distributed abuse/load qualification remains #68/#71/#74. Customer receipt cleanup
and broader privacy lifecycle remain #72; receipt evidence currently has no deletion path.
Phone validation is structural, not proof of allocation, geography, reachability or identity.
Name prefix is case-sensitive; contacts do not validate a shipment's destination address.
No independent human approval, merge, issue closure or post-merge main SHA is claimed.
