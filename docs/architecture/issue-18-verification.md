# Issue #18 verification

Starting main: `8f33ed1c51153473c538c788b80c4f609ef99d35`, freshly fetched/pulled on
2026-09-12 with a clean tree. Main run 34682640242 passed. Prerequisites #7/#11/#13/#15/#17
are CLOSED with merged PRs #90/#94/#96/#98/#100 present in main. Foundation PRs #85–#100,
current source and governing contracts were inspected. No existing #18 branch/PR existed.
Only #18 execution labels were advanced; downstream issues were not changed.
Branch: `issue-18-production-data-access-seam`.

[Owning architecture and limitations](production-data-access.md).

## Acceptance matrix

| # | Criterion | Implementation and concrete evidence | Command / result |
| --- | --- | --- | --- |
| 1 | No store fallback on API outage | Explicit composition; operator outage/startup tests; actual Rollup graph and marker gate | `pnpm test:web`, `pnpm build`; final results below |
| 2 | Demo reset cannot invoke production | Fictional-only reset, isolated keys; UI reset with fetch capture = zero calls | `pnpm test:web` |
| 3 | Logout/switch purge visible/cache data | Scope runtime generation, abort, cleanup and cache drop; immediate UI purge and B→A revisit tests | `pnpm test:web` |
| 4 | Discard previous-tenant responses | Existing #17 race plus cache query race, ignored cancellation and late error tests | `pnpm test:web` |
| 5 | 401 reauth without loops/duplicates | Mutation exactly one command, no context retry; cache purge and sign-in focus | `pnpm test:web` |
| 6 | Connection failure cannot fabricate success | Network/protocol/read/uncertain mutation matrix; same key/body after uncertainty/remount | `pnpm test:web` |
| 7 | No server credential/OTP verifier in browser | Public config allowlist, no backend imports; production module/marker checks and manual inspection | `pnpm build`, source/artifact inspection |
| 8 | Demo launcher works fictionally | Original demo regression suite retained; explicit banner/namespace; separate demo build | `pnpm test:web`, explicit demo build |
| 9 | Authorized result survives reload/restart | #17 browser context reload, API/pool reconstruction, synthetic PostgreSQL fixture | `pnpm db:local quality`, documented browser walkthrough |
| 10 | Sibling/unrelated tenant isolation | Existing #15/#17 real PG role/scope/nested-reference suites retained; client A/B/cache tests | `pnpm db:local quality` |
| 11 | Malformed/stale/dependency failures safe | Safe API error projections/status matrix, malformed success, version consistency; existing PG rollback tests | `pnpm test:web`, `pnpm db:local quality` |
| 12 | Inspect prohibited credentials/PII | Public DTO/error projection, safe correlation/field allowlists, no request logging, no generic private storage | source/artifact inspection; retained backend audit/privacy assertions |

## Reproduction

Use Node 22.23.2, pnpm 10.34.5 and Python 3.12.14. On this host:

```sh
export PATH=/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH
export PYTHON=/tmp/shipit-issue8-tools/python/bin/python3.12
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm check:planning
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:web
pnpm db:local quality
pnpm db:local verify:gates
VITE_DATA_MODE=demo pnpm --filter @shippingco/web build --outDir /tmp/shipit-18-demo-dist
git diff --check
```

For real persistence/keyboard verification, in separate terminals:

```sh
pnpm db:local demo:onboarding
SHIPIT_API_PROXY=http://127.0.0.1:3017 pnpm dev
```

Open `http://localhost:3017/_fixture/session`. The existing guarded synthetic fixture
provides a HttpOnly session without sending an email or disclosing a session credential.
Complete business/location/code, reload and confirm the same server workspace; use
`http://localhost:3017/_fixture/disable` for account invalidation. Stop both processes;
the fixture removes its exact disposable PostgreSQL container/volumes.
For fictional demo, build as above and serve its output on a separate local origin.
Open reset confirmation with keyboard, confirm, inspect zero API/auth/provider traffic.

## Execution record

All twelve acceptance rows above PASS. The final complete `pnpm db:local quality` run
passed after the final cache-failure purge correction. No relevant tests were skipped.

| Exact command / layer | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; lockfile unchanged, no dependency added |
| `pnpm check:migrations` | PASS; seven released migrations unchanged |
| `pnpm check:toolchain` | PASS; Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14 |
| `pnpm test:quality` | PASS; 16 tooling/guard tests |
| `pnpm check:planning` | PASS; reviewed source inventory and all 17 migration negative controls |
| `pnpm lint` | PASS; tenant-query gate unchanged, ESLint zero warnings/errors |
| `pnpm typecheck` | PASS; all five packages |
| `pnpm test` | PASS; 22 testkit + 12 DB unit + 126 API + 86 web |
| `pnpm test:web` | PASS; 40 data-access + 21 operator + 24 demo + 1 lint regression |
| `pnpm test:db` through disposable PostgreSQL | PASS; 31 DB + 56 API, zero failed/skipped/cancelled/todo |
| `pnpm build` | PASS; API typecheck and inspected production Vite bundle |
| `pnpm db:local quality` | PASS on final implementation |
| `pnpm db:local verify:gates` | PASS; 24 stages, including clean/restored quality and real demo-import rejection |
| explicit demo build command above | PASS; fictional database/persona present, production bootstrap/context routes absent |
| `git diff --check` | PASS |

The full failure drill verified the unchanged final build guard; the later cache-failure
purge refinement passed the final full quality run. No failure drill is represented as
independent human approval. Earlier lint found a test mock alias and typecheck found unknown
error-result types; these were corrected. Review caught Strict Mode abort reuse and ensured
current query failures purge even without a shell callback. Existing #17 tests were retained,
including invitation completion after navigation. The historical inventory was updated only
for reviewed composition/namespace changes, removed global demo setup and added tests; its
validator, dispositions of unsafe prototype rules, SQL allowlists and CI requirements were
not weakened.

### Actual browser walkthrough

Using the guarded existing synthetic PostgreSQL fixture and normal production dev composition:
empty submission focused the labelled Business name field. At 375×812, typed business name,
Tab → location, Tab → code, Tab → Enter committed the real workspace. Focus moved to the
workspace heading. Reload restored the same organization/location from PostgreSQL; DOM width
365 was within viewport 375. A second real tab loaded the same workspace; signing out in the
first tab moved both tabs to sign-in and removed previous workspace content. Issuing another
fixture session restored the persisted workspace; fixture account disable then returned
sign-in on protected navigation. The explicit demo build on a separate loopback origin showed
the fictional notice, both launcher entries and a successful local reset. The automated UI
reset test separately captured fetch and asserted exactly zero API/auth/provider requests.
Temporary tabs/viewport override, both app servers and the demo static server were cleaned up;
the disposable PostgreSQL fixture confirmed container removal.

### Security/privacy inspection and boundaries

Reviewed changed source, the public DTO projection, every request/storage/logging call in
config/data-access/operator, server error/logging/audit seams, automated public-body assertions,
synthetic browser output and both built HTML artifacts. Production has one fetch callsite,
no raw exception/body logging, no demo persistence/persona markers and no server credential
or OTP-verifier implementation. Generic intents/cache and CSRF are memory-only. #17's narrowly
approved per-identity onboarding recovery is the sole retained storage exception. Backend
projections, role matrix, real tenant constraints and audit tests remain unchanged and pass.
No new business endpoint, schema migration, dependency or framework was introduced.

Existing fictional prototype React act warnings remain visible and unsuppressed. No new
dependency advisory audit was run; prior development-tool advisory findings were not
reassessed. No real provider sends, public registration, deployment network isolation or
future booking/customer/messaging migration is claimed. BroadcastChannel is advisory;
unsupported/blocked browsers revalidate on protected navigation, focus and visible resume.
Server-initiated revocation is discovered on those checks, without a push notification service.

## Review and delivery

The author reviews the final diff and resolves actual findings. This is not an independent
human approval. Current main protection requires up-to-date `Planning and prototype checks`
(which depends on all five quality jobs and PostgreSQL), resolved conversations, and zero
approving reviews; administrators are enforced. The user's #18 instruction explicitly
requests normal merge if those requirements permit it. No protection changes or override
are allowed. Merge, issue closure and main cleanup are reported only after GitHub confirms them.
