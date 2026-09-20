# Issue #32 verification

Verification date: 2026-09-20. Delivery ends with an open, unmerged PR for independent
review. No deployment, government verification or compliance certification is claimed.

## Baseline and dependency audit

Starting main: `fef48be89041fe7d491782c47770799e85786709`, fetched/pruned and fast-forward
checked before work on `issue-32-external-eway-records`. Interrupted work on that branch
was preserved; no unrelated work was discarded or committed on main. Repeated fetches
confirmed the same baseline. [Main run 35431454070](https://github.com/ShippingCo/ShipIT/actions/runs/35431454070)
succeeded in all seven jobs, including PostgreSQL and the required final gate.

Live issue state and merged PR metadata were independently queried. All Issues #2–#31
are CLOSED; each merge below passed `git merge-base --is-ancestor <sha> origin/main`.
This independently checks #31's earlier ancestry audit. PR #88 lacks a closing link in
its body, so its merged commit and quality implementation were inspected directly.

| Issues / established contracts | Merged PRs / merge SHA prefixes |
| --- | --- |
| #2 architecture; #3 ownership/RBAC; #4 API/events/replay | #85 256512a; #86 d039a48; #87 308f247 |
| #5 quality; #6 environment/security; #7 migration | #88 b46c59b; #89 36ce6d3; #90 d4f036b |
| #8 money/tax/proof/privacy/e-way; #9 test harness | #91 a9cb195; #92 53d2983 |
| #10 PostgreSQL; #11 Fastify; #12 tenancy | #93 ca73548; #94 f3130f9; #95 4c411c7 |
| #13 sessions; #14 membership; #15 tenant capabilities | #96 ceba31a; #97 a9daf42; #98 4d606da |
| #16 audit; #17 onboarding; #18 demo isolation | #99 3cefe53; #100 8f33ed1; #101 ee8baee |
| #19 customers; #20 pricing; #21 tax; #22 Booking | #102 f06f72e; #103 2b5c511; #104 b15f5cf; #105 b0d4791 |
| #23 queries; #24 lifecycle; #25 bulk; #26 lots | #106 e33ce9f; #107 336486c; #108 0c126e3; #109 623babb |
| #27 routes; #28 route events; #29 payments | #110 54bb8eb; #111 9d6b273; #112 32beb6b |
| #30 receipts/browser regression repair; #31 attachments | #113 aa403ec; #114 35d91c2; #115 fef48be |

Direct prerequisites #8/#15/#16/#22 have full merge SHAs:
`a9cb1958af656b9bf26ede640fc41e7b72e50576`,
`4d606da563348b042a2d76d9c0a186904a3b187c`,
`3cefe534b6ca23fc8ffdd5a77f2bb57f5517a361`,
`b0d4791ae936eb6d66561a547e841c739d07d44a`.
GitHub events show blocked→ready at 06:28:05 UTC and ready→in-progress at 06:28:06 UTC
on September 20 during the interrupted work. The resumed task did not repeat those
changes. Only execution status advances to review; type/area/priority, M2 milestone,
assignees and issue body remain intact. Issue closure awaits human merge.

## Decisions, schema and API

[ADR 0022](../adr/0022-external-eway-records.md) and [owning contract](eway.md) record the
application decisions before implementation. R15/W23, ADRs 0006/0007/0009/0013, the #8
policy, live membership/scoped-query boundary and #16 audit remain authoritative.

The declared-value gap is resolved by an optional Booking-wide physical-goods declaration:
integer INR paise plus source reference. Missing historical value stays null/unknown;
explicit zero is distinct. No financial field, commercial snapshot or demo data is reused.

Migration `1790442000000-external-eway-records.cjs` adds current records, immutable revisions,
command receipts and scoped maintenance policies. Composite owner FKs, positive versions,
bounded fields/JSON, finite instants, owner/keyset indexes, estimate guards and deferred
command/revision completeness enforce consistency. Trigger-captured revisions supply safe
canonical audit facts atomically. Twenty released migrations remain unchanged. The
[DB guide](../../packages/db/README.md#issue-32-external-e-way-records) lists exact narrow grants.

No legal preset is seeded. Primary NIC FAQ retrieval returned 403; current amendments and
exemptions were not established, so applicability stays unknown. Approved maintenance check
policies select latest effective_from <= server clock. Versions/effective instants increase;
database-stamped recorded_at forbids backdating. Changes affect subsequent evaluations of
existing Bookings without rewriting evidence. A later unapproved version disables checks.
No staff policy-administration endpoint or new role exists.

External validity is source-supported operator observation, with unverified_external and
null verification time. Explicit recalculation stores a separate estimate policy/version,
inputs, calculation time and ShippingCo estimate label. Distance/vehicle edits preserve
both saved official validity and estimates. Expiry is now >= until; warning boundary is
inclusive. UTC output is canonical; #34 owns Asia/Kolkata date display.

| Method/path | Action / result |
| --- | --- |
| POST /api/v1/bookings/:booking_id/eway | W23 eway.write; create 201 |
| PATCH /api/v1/bookings/:booking_id/eway | W23 eway.write; expected-version correction 200 |
| POST /api/v1/bookings/:booking_id/eway/estimate | W23 eway.write; explicit expected-version calculation 200 |
| GET /api/v1/bookings/:booking_id/eway | R15 eway.read; current record/states |
| GET /api/v1/bookings/:booking_id/eway/history | R15 eway.read; paginated immutable versions |
| GET /api/v1/eway/reminders | R15 eway.read; paginated Booking check states |

All endpoints narrow live membership with organization_id/franchise_id selectors. Writes
require CSRF/Origin and one Idempotency-Key. Canonical normalized intent binds Booking,
body/preconditions and operation to authenticated principal and trusted owner. Replay returns
the original identity/version after current authorization. Stale versions, unresolved locks
and uncertain commits use the established controlled outcomes and exact-key/body recovery.

| Role | R15 | W23 |
| --- | --- | --- |
| org_admin | Explicit own-organization franchise | Denied |
| franchise_admin | Own franchise | Own franchise |
| operator | Own franchise | Own franchise |
| dispatcher | Own franchise | Denied |
| accountant | Own-franchise references/value/validity; no vehicle/distance/actor/reason | Denied |
| delivery_agent | Denied | Denied |
| read_only | Denied | Denied |

## Acceptance evidence

Paths: **U** = apps/api/test/integration/eway.test.ts (unit/service boundary), **A** =
apps/api/test/database/eway.test.ts (real runtime-role PostgreSQL/Fastify), **D** =
packages/db/test/integration/eway.test.ts (real migrations/constraints), **G** =
scripts/tenant-queries.test.mjs. No mocked SQL or skipped tests substitute for A/D.

| Criterion | Implementation → executable evidence |
| --- | --- |
| External reference and exact source validity | validation/types/repository → A record reload persists exact until, issuer/source and unverified state |
| Estimate labelled and cannot become official | explicit calculation/DB guard → U provenance/no-official-field; A calculation/recalculation preserves external object; D direct rewrite denied |
| Distance preserves saved validity | correction preserves omitted fields → A official object/estimate equality before/after distance/vehicle edit; history retains 53 and 71 km |
| Missing/unknown/estimated/expired distinct | rules.evaluate → U vocabulary; A missing old Booking and unknown official validity even with estimate, exact before/equal/after expiry |
| Prospective threshold change | policy selection → A synthetic 200000→100000 paise threshold at 00:01:00, existing 123456 declaration changes reminder; history and official until unchanged |
| Actor/reason/previous metadata | revision trigger → A versions 1/2/3, actor and reason, prior values; D immutable evidence; canonical audit pagination |
| Reload/restart persistence | durable rows/receipts → A fresh service AND runtime pool returns original result/current/history after races and uncertain commit |
| Idempotency/concurrency | fingerprint/receipt/locks → A concurrent normalized equivalent creates return same 201; changed intent conflicts; two corrections from version 1 give one 200/one VERSION_CONFLICT, exactly two versions/audits |
| All seven roles | withEwayScope/DTO mapper → A independent create/read/history/reminder/correct/estimate cases, successful admin/operator creation and reduced accountant output |
| A2/B1/unknown indistinguishable | scope before parent/replay → A real Customer→pricing→tax→Booking→e-way chains; foreign commands/read/history yield identical normalized 404 and zero mutation; org-admin cannot cross organizations |
| Nested/count/audit privacy | no Parcel selector; composite FK; scope before LIMIT → A foreign Parcel input rejected, foreign audit selector denied, local last page one/has_more=false despite foreign records; D composite foreign parent fails |
| Pagination authority | encrypted bound cursor → A current/history pages and cross-Booking/accountant/policy rejection; U tamper/expiry/forged capability |
| Malformed/stale/dependency controlled | strict JSON/closed fields/transactions → U Unicode/surrogate/bounds/reason/version; A 400 duplicate JSON, 422 bad input/key, stale 409, injected pre-receipt rollback with unchanged rows |
| Uncertain commit/revocation | existing transaction semantics/live scope → A lost acknowledgment retains one correction, exact retry adds nothing; revoked member/disabled roots deny replay |
| API/log/audit/receipt privacy | explicit DTO and reference-only audit → A synthetic credential/OTP/session/CSRF/key/address markers absent from output/log/audit/receipts; audit/logs omit external and vehicle values |
| Migration/privileges | forward schema/narrow grants → D populated twenty→twenty-one upgrade, rollback/no-op, unknown values, synthetic NEW forward repair; denied policy/history/owner mutation, DELETE/TRUNCATE/DDL |
| Tenant AST gate | closed capabilities/scopedQuery → G raw executor, missing/single owner, issuer and direct query negative controls; no widened exception |
| Fictional frontend preserved | no web source edits → 115 existing web tests, including demo 530 km→three days; no new screen requiring browser accessibility tests |

## Reproduction and execution ledger

Pinned tools: Node 22.23.2, pnpm 10.34.5, Python 3.12.14, disposable PostgreSQL 18.6.
Host defaults were not accepted. Official Node/Python were installed under /tmp and selected
on PATH/PYTHON without changing repository pins. Initial Python mismatch correctly failed;
after installing 3.12.14 the exact toolchain check passed. No new dependencies or lockfile edits.

```sh
pnpm check:toolchain
pnpm check:migrations
pnpm check:planning
pnpm test:quality
pnpm check:tenant-queries
pnpm --filter @shippingco/api test
pnpm --filter @shippingco/db test:unit
pnpm lint
pnpm typecheck
pnpm test
pnpm db:local test:db
pnpm build
pnpm db:local quality
pnpm db:local verify:gates
git diff --check
```

The aggregate invokes the same required lint/type/test/build commands. The guarded helper
provisions generated credentials and cleans its exact container/registered databases. A/D
build real sessions/memberships and fictional commercial chains; expiry uses an injected
2099 clock with no time waits. No real customers, provider messages or production database.

Commands used `PATH=/tmp/node-v22.23.2-darwin-arm64/bin:$PATH` and
`PYTHON=/tmp/python312/bin/python3.12`. These are local bootstrap locations, not changed
repository requirements. Observed results:

| Check | Result |
| --- | --- |
| check:toolchain | Exact Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14 passed |
| check:migrations | Twenty released migrations unchanged; one new forward migration |
| check:planning | Planning, links and domain contracts passed |
| test:quality | 26 passed |
| check:tenant-queries / lint | Tenant AST checks and ESLint passed |
| typecheck | All five workspace packages passed |
| Focused API / DB unit | 419 API tests in 22 files; 12 DB unit tests passed |
| Focused real e-way PostgreSQL | 15 passed: 13 API and 2 migration/constraint tests |
| Full test layers | 22 testkit + 12 DB unit + 419 API + 115 web + 3 actual S3 contracts passed |
| db:local test:db | 58 DB + 233 API passed; zero failed/skipped/cancelled/todo; disposable container removed |
| build | API TypeScript and production web build passed; 61 web modules |
| db:local quality | Passed; final verify:gates clean and restored quality runs both passed with the expanded 419-test API suite |
| db:local verify:gates | All 24 stages passed: empty-store install, clean quality, 20 intentional rejection cases, final-gate success and restored quality |
| git diff --check | Passed |

The feature coverage comprises 51 e-way unit/service cases, 13 real API/database cases
and 2 migration/constraint cases. During development,
`pnpm db:local exec node --experimental-strip-types /tmp/shipit32-focused.mjs` ran just
the two e-way PostgreSQL test files through a temporary driver using preflightTestDatabase,
a generated resource registry and cleanupRegisteredResources. The retained, reproducible
verification command is `pnpm db:local test:db`, which includes all fifteen cases.
The focused run initially exposed a test expecting 422
for duplicate JSON keys; the established strict JSON contract correctly returns 400.
The assertion was corrected, and focused/full runs passed. Earlier full quality had 417
API tests; two added boundary cases bring the final suite to 419. Intentional negative
gate stages are expected failures, not product regressions. Gate logs live under
`node_modules/.cache/quality-verification/` and contain redacted infrastructure evidence.

Current PR-head GitHub Actions are checked after push. The PR checks and delivery report
record that exact head and run URL, never a previous main/local result. Hosted success is
not inferred from this pre-push local verification document.

## Review, warnings and handoffs

Self-review covers the complete diff, ownership/replay order, atomicity, integer precision,
canonical instants, minimum DTOs, estimates, immutable provenance, policy boundary and
foreign counts. The canonical audit cursor also gains the missing attachment namespace
alongside eway so the existing mixed-source view remains pageable. No raw-query exception,
new runtime role, legal constant or production browser fallback is introduced.

Existing React act warnings and fixed S3 non-retryable-stream warnings from intentional
rejected writes remain visible. This task does not claim a fresh dependency security audit
or remediation of the development-tool advisories already recorded by #31.

Apply schema/grants before API. Roll back compatible code/configuration, preserve evidence,
and repair schema forward. No destructive down, fabricated backfill or browser import.
The inherited non-RLS model guards application queries, not stolen SQL credentials. Legal
presets remain disabled pending current-source approval. Retention/pruning stays with #72.
#33/#34 consume the declaration API; #34 owns the production E-way Bills screen and #67
broader compliance/report reconciliation. No government filing/automation, WhatsApp reminder
sending, carrier integration, financial mutation or public event was added. Independent
human review remains required; merge, auto-merge, manual closure and branch deletion are
expressly outside this delivery.
