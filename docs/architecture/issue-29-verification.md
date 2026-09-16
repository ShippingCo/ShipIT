# Issue #29 verification

## Baseline and live audit

Started from fetched/pulled main **9d6b27381a42c7c0edc4491d0cf2508e7b54d98b**
(PR #111, Issue #28), on **issue-29-payment-ledger**. The initial checkout on
issue-27-dispatch-routes-manifests was clean. No unrelated changes were stashed or rewritten.
Live Issue #29 body, labels, milestone, dependencies and comments were inspected, alongside
all closed issues #2–#28 and recent merged PRs #105–#111. There were no #29 comments.
All four prerequisites were closed with merged implementation:

| Issue | PR | Merge commit |
| --- | --- | --- |
| #8 | #91 | a9cb1958af656b9bf26ede640fc41e7b72e50576 |
| #15 | #98 | 4d606da563348b042a2d76d9c0a186904a3b187c |
| #16 | #99 | 3cefe534b6ca23fc8ffdd5a77f2bb57f5517a361 |
| #22 | #105 | b0d4791ae936eb6d66561a547e841c739d07d44a |

Only status: blocked was replaced with status: in-progress; other issue fields were preserved.
Live main protection required strict **Planning and prototype checks**, administrator
enforcement and resolved conversations, with zero required approving reviews and no force
push/deletion allowance. Independent maintainer review is still required by this task.

Reviewed repository README, docs/AGENTS, contribution/workflow/quality/roadmap/index,
prototype-to-production and architecture/migration inventory, domain, authorization,
idempotency, events, testing, money/privacy, open decisions, bookings, lifecycle and runtime
sequences, API/DB guides, ADRs 0001–0004/0006/0007/0009/0013 and recent 0014–0018 conventions.
The implementation preserves raw SQL/pg, Fastify, tenant capabilities and existing audit,
durable events and command receipts. No dependency or released migration was changed.

## Decisions and changed areas

[ADR 0019](../adr/0019-payment-ledger.md) and [Payments](payments.md) own the design.
The #22 obligation remains immutable opening evidence. One Booking-level positive-entry
ledger supports partial collection and linked partial/full reversals. Negative credits and
external refunds are disabled. Methods cash/upi and contexts paid_counter/to_pay are separate.
W20/W21 remain **franchise_admin only**. The stale accountant/manager sentence is not a
permission grant: accountant reads financial facts, org_admin has declared reads, no manager
role or cashier/agent expansion is introduced.

Changes include the Payments service/repository/routes/strict DTOs, forward migration
1790182800000, membership capabilities, safe errors, existing audit/event integrations,
exact JSON integer parsing, tenant static gate, runtime grants and executable regressions.
Ledger revisions distinguish genuine settlement after an explicit financial correction.
#30/#61/#63 reconcile opening plus ledger through safe queries; their outputs remain pending.

## Acceptance to executable evidence

| Acceptance | Evidence |
| --- | --- |
| Exact paise, partial/full/zero balance, no installment rounding | API payments financial-rule tests and real odd-paise collection/recollection test |
| Opening immutable; multiple Parcels share one gross | Real two-Parcel Booking through current Pricing/Tax/Booking services; before/after full-row equality |
| Collections/reversals append; no negative credit or excess reversal | Rule tests; runtime/owner update/delete rejection; direct SQL remaining-capacity tests |
| Same key/body, reference alias, changed intent | Real command/reference replay, actor change, key rebinding conflict and parallel duplicate tests |
| Full and partial collection races A–E | Real PostgreSQL parallel requests; external runtime obligation lock with observed lock wait; exact row counts |
| Restart and uncertain COMMIT | New pool/service replays original result; fault after actual COMMIT yields controlled 503 then reconciles |
| Atomic receipt/ledger/audit/event | Faults after reservation/entry, before audit/event/commit; omitted components trigger rollback; exact four-table counts |
| Partial/full/reversal/re-settlement events | Event count, payload, actor/correlation, ledger revisions and replay checks; no reversal settlement |
| W20/W21 role matrix | All seven canonical roles; franchise_admin allowed, every other mutation role denied |
| Tenant A/B/C and nested IDs | Real foreign Bookings/collections under their own scopes; identical raw key/reference independent across tenants; foreign read/write/reversal/aggregate/replay denied |
| No browser authority or lost numeric precision | Strict HTTP bodies including settled/paid/paymentMode/totals/ownership; raw fractional/exponent lexemes checked before JavaScript precision loss |
| Delivery/payment independence | Controlled delivered/held synthetic fixture; outstanding/no event until collection; payment/reversal preserve full Parcel rows; delivery reversal preserves money |
| Financial audit privacy and scope | Safe canonical history, accountant-only financial predicates before pagination, cursor and disabled-root tests |
| DB defense in depth | Ownership FKs, command/reference unique constraints, abandoned receipt rejection, immutable guards, private function/runtime grants, direct intent/sequence/reversal checks |
| Fresh/populated migration | Full DB migration suite plus failed upgrade rollback, original IDs/totals/receipts/envelopes unchanged, zero invented collections and repeat no-op |
| Production/demo boundary | Existing browser suite and production build isolation gate |

Tests reside in apps/api/test/integration/payments.test.ts,
apps/api/test/database/payments.test.ts, packages/db/test/integration/payments.test.ts and
the tenant-query checker tests. Each real fixture runs through a runtime role; owner access
is restricted to synthetic setup, inspection and independent immutable-trigger assertions.
Delivery/T13 commands remain #42; their synthetic lifecycle fixture suspends only the prior
Parcel guard and restores it before Payments commands. No production bypass is provided.

## Verification results

Pinned Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and digest-pinned PostgreSQL 18.6.
The downloaded official Node archive's SHA256 was verified. Host defaults were not used.

| Command / suite | Result at this revision |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | Passed; no lockfile changes |
| pnpm check:toolchain | Passed |
| pnpm check:migrations | Passed; 17 released migrations unchanged |
| Focused PostgreSQL payments and populated migration | Final focused run: 25 passed (17 Payments API/DB, 1 populated Payments upgrade, 7 existing migration/Route regressions); zero failed/skipped/cancelled/todo |
| pnpm typecheck / pnpm lint | Passed in full final quality; all five workspaces, tenant-query gate and ESLint |
| pnpm db:local quality | Passed: tooling 23; testkit 22 + DB unit 12; API 343 (37 new Payments rule/validation/policy cases); browser 95; PostgreSQL 51 DB + 190 API; production API/web builds passed |
| pnpm db:local verify:gates | Passed all 24 stages: empty-store install, clean quality, all deliberate failure/final-gate controls, restored quality; both snapshots repeated the same passing test counts and builds |
| Current PR-head CI | Pending PR creation; local quality and gate verification complete |

Exact focused command: `DB_TEST_RESOURCE_REGISTRY=<temporary registry> pnpm db:local exec node --experimental-strip-types --test apps/api/test/database/payments.test.ts packages/db/test/integration/payments.test.ts packages/db/test/integration/migrations.test.ts packages/db/test/integration/route-events.test.ts`.
Full commands above use PATH selecting pinned Node and PYTHON selecting pinned Python. The complete PostgreSQL run has zero failed/skipped/cancelled/todo tests. The focused run includes 8 migration/upgrade regressions. Fresh/repeat migration applies all 18 migrations and is included in the 51 DB tests; the new populated upgrade covers failure rollback and unchanged opening evidence. Existing browser React act warnings remain visible.
No timeout, assertion, dependency or gate was weakened. Final self-review inspected every changed file and full diff, checked whitespace, money/role invariants and new debug/TODO/secret markers; no unrelated dependency/lockfile/frontend changes or released-migration edits remain.

Initial diagnostics: a direct focused run lacked the harness-required resource registry and
was rejected; rerun used the registry. One omission-injection test exposed an internal missing
ledger insert mapping to 404; row-count validation now yields 503 and its rerun passed.
The first full quality run stopped on the not-yet-written verification document link; this
file resolves it. Self-review found Payments needed the existing exact-integer lexical parser
already used by Pricing; raw precision-loss regressions now cover both financial commands.
Early lint/type gates also caught test-only quoting and UUID parameter inference errors, which were fixed. Full PostgreSQL regression exposed stale table/migration inventories and a Route snapshot that included the new nullable columns; expectations now cover the additions while preserving every historical field and explicitly asserting old payment links remain null. A remaining Lot upgrade count was also updated from three to four. These failures are retained as evidence, not reported as passing full runs.

## Privacy, rollout and limits

Only synthetic fixture data is used. Response DTOs are explicit reference/money/enum mappings;
new events contain only Booking/settlement references and the established envelope. Audit
contains reference/action/reason/actor/correlation/version/time, no body or customer narrative.
Logs are checked against fixture PII, auth/cookie/key/body markers. No PAN/CVV, bank credentials,
provider credentials or Customer contact fields are accepted by the financial contract.

Apply the forward migration and documented runtime grants before code rollout. Disable/revert
payment routes for rollback, preserving financial history and repairing schema forward.
Original immutable opening guards remain enabled; UPDATE(id) is granted solely to obtain a
PostgreSQL row lock and every actual update still fails. No backfill fabricates collections.

Production payment UI, receipts, reports, proof-backed delivery, WhatsApp, gateway/refund
execution and retention policy work remain with their downstream owners. No throughput or
provider verification claim is made. Zero gross has an empty settled projection and no event.
The PR must remain open, with no auto-merge or manual Issue #29 closure.
