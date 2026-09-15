# Issue #28 verification

## Baseline and context

Started from fetched origin/main `54bb8eb6b6956f06afad8c024e3f983e09d12f1e`, PR #110,
on `codex/issue-28-route-events`. The initial checkout was clean on the merged #24 branch.
The new branch was created directly from fetched main without a merge or main rewrite.
No commit, push or merge is authorized for this delivery.

Reviewed accessible “Start solving issue 24” history as the workflow reference (the user
corrected “43” to “24 and 23”), live issue #28, the closed issue inventory through #27,
PR #110's implementation/verification record, and the repository architecture, role,
lifecycle, idempotency, event, database and testing contracts. Changes after #24 are
bounded bulk commands (#25), persistent Lots (#26), and frozen dispatch manifests (#27).
The #27 PR records successful final-head checks; no new remote CI result is claimed here.

## Research and implementation

[ADR 0018](../adr/0018-atomic-route-events.md) records the reviewed tradeoffs and primary
AWS/Stripe/PostgreSQL sources. The selected solution keeps Fastify, pg and raw SQL, uses
one bounded transaction and frozen distinct manifest membership, delegates T04 to the
Parcel owner, and stores absolute ETA revisions plus immutable per-Parcel outcomes.
No external provider, dependency, production UI or operational message was added.

## Acceptance mapping

| Requirement | Executable evidence |
| --- | --- |
| Duplicate delay cannot accumulate | route-events.test.ts: original replay, new-key stale rejection and newer identical absolute delay |
| Lot/direct overlap once | Real manifest with overlapping Lot/direct source produces exactly two physical Parcel effects |
| Terminal exclusions | Delivered and RTO synthetic states retain status/version/update time; both delay outcomes are skipped/null ETA |
| Typed semantics | Strict validation rejects title/status fields and unknown kind; arrival preserves in_transit |
| Stale/out-of-order rejection | Expected version, older effective instant and decreasing delay conflict without new rows |
| Atomic multi-Parcel failure | Synthetic trigger fails after first effect; all receipts/transitions/effects/audit/events roll back; retry succeeds |
| Original result after restart | New pool/service replays identical result with unchanged row counts |
| Lost commit response | Simulated error after COMMIT recovers the stored result through a fresh pool without duplicate effects |
| Database completeness | Omitting an effect, audit, event or committed receipt rejects the entire transaction |
| Authorization | W18 operator/admin cannot perform T04; read_only/accountant denied; sibling/unrelated selection denied |
| Retry authorization | Downgraded dispatcher cannot replay a departure that performed T04 |
| Missing ETA | Explicit null baseline stays unavailable after delay |
| Privacy | Event-detail response contains only references/outcomes; tests reject fixture PII/receipt fields |
| Capacity | Real PostgreSQL 1,000-Parcel departure plus delay with all #28 guards enabled |
| Forward upgrade | Populated #27 Route receipts, manifests and event envelopes survive failed migration rollback, successful upgrade and repeat no-op |

API validation tests are in `apps/api/test/integration/route-events.test.ts`; real API/DB
tests are in `apps/api/test/database/route-events.test.ts`. Synthetic terminal/capacity
setup suspends only prior-domain fixture guards and restores them before #28 commands.
It does not provide a production bypass. Browser tests remain regression checks because
the production screen cutover belongs to #34.

## Verification status

Full clean-snapshot quality passes on the final implementation:

| Check | Result |
| --- | --- |
| Tooling | 22 passed |
| Testkit / DB unit | 22 / 12 passed |
| API / browser | 306 / 95 passed |
| Real PostgreSQL | 50 DB + 173 API passed; zero failed, skipped, cancelled or todo |
| Static checks | Toolchain, planning, tenant-query lint, ESLint and all workspace typechecks passed |
| Production builds | API and web passed |
| Released migrations | All 16 released migrations unchanged; one forward migration added |

The verifier passed frozen installation, clean quality and all deliberate failure/final
gate drills (stages 1–23). Its redundant restored-quality repeat was stopped when the user
requested faster parallel final checks. Therefore the complete 24-stage `verify:gates`
command is **not claimed as passed**. The final parallel agents verified API 306/306,
DB unit 12/12, all 16 released migrations unchanged, and browser 95/95. The concurrent
browser run initially hit one onboarding wait timeout; its unchanged rerun passed all
95 tests. No test or timeout was changed for that retry.

Aggregate runner budgets were calibrated from measured Windows/Docker runs; see
[quality checks](../QUALITY_CHECKS.md). Individual test deadlines and strict suite
completeness checks remain intact. The 1,000-Parcel focused test passed in about 46 seconds,
including setup; this is correctness evidence, not a production throughput guarantee (#74).
Browser tests retain pre-existing React `act` warnings.

An initial trigger syntax error and the synthetic forward-repair fixture's migration
timestamp ordering were corrected before the successful full-quality run.
Docker initially failed on stale runtime sockets; socket directories were backed up and
the engine recovered. No images, volumes or existing database data were removed.

## Reproduction and rollout

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and the pinned PostgreSQL 18.6 fixture.
Run `pnpm check:migrations`, `pnpm db:local quality`, and `pnpm db:local verify:gates`.
The latter verifies the same clean quality snapshot and intentional gate failures used
for issues #23/#24/#27. Test reports distinguish failures from skipped/unexecuted work.

See [Route events](route-events.md) and [DB grants](../../packages/db/README.md) for deployment,
controlled errors, replay semantics and forward-only rollback. Remote CI and PR creation
remain pending user approval to commit/push.
