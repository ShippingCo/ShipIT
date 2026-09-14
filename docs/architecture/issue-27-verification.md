# Issue #27 verification

This delivery implements [dispatch routes](routes.md) and [ADR 0017](../adr/0017-dispatch-route-manifests.md).
Only synthetic fixtures/disposable PostgreSQL were used. No merge or manual issue closure
is authorized. The PR remains for maintainer review.

## Starting audit

Repository ShippingCo/ShipIT; fetched main `623babb353a8a14e89dd664ad8493e8f420b9649`
(PR #109). The initial working tree on issue-26-persistent-lots was clean; fetched/pruned,
checked out main and fast-forward pulled before branching. Existing work was preserved.
Main CI run 34859578336 succeeded on that exact SHA. #15/#16/#24/#26 were CLOSED;
#27 OPEN with no comments, no competing open PR and no newer merged contract.
ADR numbering through 0016 was inspected. Branch: `issue-27-dispatch-routes-manifests`.
Only status labels changed blocked → ready → in-progress; unrelated labels retained.
Review status and the final remote delivery record are verified after pushing.

## Implementation and migration evidence

`1790010000000-dispatch-route-manifests.cjs` is the sole new migration; the 15 released
files are unchanged. Nine tables cover Route state/receipts, two typed source histories,
immutable manifest/Parcel/provenance rows, Route audit and new T03 bindings. Composite
RESTRICT FKs, source/finalized uniqueness, column grants, history guards, reference-only
event/audit validation and deferred complete-command checks protect authoritative state.
No JSON ID-array storage, destructive backfill or legacy evidence rewrite.

The [12-endpoint contract](routes.md#http-and-dtos) uses single-franchise live TenantAccess,
explicit DTOs, UTC schedules, expected versions and canonical hashed original-result replay.
Planning → finalized is manifest authority only; archive preserves history. The 100-source /
1000-Parcel union is physical-Parcel deduplication with exact retained Lot provenance.
Lot grouping/archive guard applies to all roles while attached to planning Routes. New T03
requires finalized membership in the existing Parcel transaction; bulk delegates unchanged.
Legacy opaque exact receipts replay without inventing Routes. Runtime grants and rollout /
rollback are recorded in [DB README](../../packages/db/README.md#issue-27-dispatch-routes).

## Acceptance → exact executable evidence

Unless a different path is given, names below are tests in
`apps/api/test/database/routes.test.ts` (real PostgreSQL, normal authenticated HTTP).

| Criteria | Test / concrete assertion |
| --- | --- |
| A persistence, Q UTC/Kolkata, R carrier | `route persistence, UTC/Kolkata instant, inert carrier metadata, update/archive and original replay`: fresh pool reads exact DTO, explicit fixed schedule round-trip, timestamptz introspection, fetch spy sees zero calls |
| B/C union/provenance, G history, H lock, N guard | `lot/direct union has one Parcel with deterministic provenance; finalization freezes history and releases Lot guard`: P1/P2 Lot plus P2/P3 direct yields exactly three rows, P2 two sources; historical/current frozen response unchanged after Lot remove/add; no dispatched status |
| D/E foreign nested IDs, L foreign manifest | `real sibling B and unrelated C nested resources and manifests are indistinguishable from unknown`: real nonempty B/C Lots, Parcels, Routes and finalized manifests; identical 404 envelopes, zero effects; owner-insert composite FK rejection |
| F ineligible states | `ineligible delivered/rto/dispatched direct and Lot members reject atomically; detach provides recovery` (three cases): explicit controlled failure and unchanged lifecycle/effects |
| I concurrency, J replay | `optimistic attach/detach winner, exact source replay and permanent finalized dispatch uniqueness`: same-key pair one effect, changed intent conflict, one optimistic winner, finalized uniqueness, detach original replay |
| K uncertain commit, T privacy, U immutability, V failures | `every transaction boundary rolls back; omitted facts cannot commit; uncertain COMMIT replays across restart`: exact pre/post counts, fresh-pool original receipt, safe stored receipts/log/audit/event inspection, owner UPDATE/DELETE/ownership/late-insert denial |
| L authoritative T03, M bulk | `T03 finalized membership and bounded bulk dispatch preserve existing lifecycle/audit and deny fabricated references`: unknown/planning/not-containing rejection, valid version-3 dispatch and one binding, exact replay, one valid/one invalid bulk item; old producer rejected by new DB trigger |
| O all seven roles, P disabled/revoked roots | `all seven roles enforce R09 W05 W06, live revocation and disabled-root historical reads`: explicit role matrix and live changes; roots deny writes while approved reads work |
| S strict HTTP, pagination and bounded locks | `bounded deterministic pagination, source detach replay, cursor binding, strict HTTP and lock timeout`: invalid bodies/query/duplicate JSON/CSRF, no overlapping pages, actor/current-snapshot binding, historical cursor continuation, 150ms lock timeout then retry |
| Safety bounds and archive recovery | `capacity bounds accept 1000 deduplicated Parcels and 100 sources; excess work rejects atomically`: real 20×50 Parcel bookings, synthetic relational Lot membership fixture; accepted maxima, controlled overflow, unchanged receipts/state, archive releases Lot |
| N owning guard, J Lot source replay | `Lot detach original replay releases grouping guard, including independent SQL rejection`: exact attach/detach receipts, direct owner grouping UPDATE blocked, removal succeeds after detach |
| S canonical normalization, capabilities | `apps/api/test/integration/routes.test.ts`: six API tests for required/unknown/type/enum/time/version/UUID inputs, intent fingerprint, purpose/actor/expiry cursor, forged/other-domain/evidence capability rejection before SQL, closed DTO |
| U minimum privileges and upgrade/retry | `packages/db/test/integration/routes.test.ts`: all 15 released migrations then failed new migration rollback/retry/no-op, existing audit view unchanged, exact runtime DDL/DELETE/TRUNCATE/history/ownership denials, every tested FK RESTRICT |
| Legacy evidence | `apps/api/test/database/lots.test.ts` / `upgrade preserves existing booking and dispatch events/audit byte-for-byte and old producers still work`: real old T03 sequence under pre-Lot schema, both forward upgrades, exact events/audit retained, fresh-service opaque receipt replay and zero invented bindings |
| Fresh migration and compatibility | `packages/db/test/integration/migrations.test.ts` and existing domain migration suites: intentional count advance to 16, no changed released migration; #24/#25/#26 successful dispatch fixtures now use real finalized manifests with original assertions retained |
| Static tenant security | `scripts/tenant-queries.test.mjs` / `Route/manifest tables require both owners; exact HTTP query-data exception never permits SQL or authority minting`: all nine tables, unscoped/org-only/raw query and unauthorized issuer negatives |

Failure injection covers reservation, source insertion, manifest header/Parcel/provenance,
Route update, audit insertion, domain event insertion and receipt completion. Omission tests
exercise missing provenance/audit/event/completion; deferred constraints abort commit.
COMMIT response loss preserves committed work and returns the exact result on fresh retry.

Privacy inspection checks API DTOs/errors, captured application logs, persisted receipts,
Route audit/domain events for raw key/session/CSRF/customer contact/address fixtures. Event
payloads contain only manifest_id; audits contain references/versions. Carrier code is only
validated metadata: reviewed imports/SQL contain no provider/installation/credential access,
and a failing network spy observes zero fetch calls during a successful workflow.

## Commands and results

Development: focused Route/Lot real-PG run passed 27/27 with zero failed, cancelled,
skipped or todo. API suite passed 295/295 across 17 files. These focused results do not
substitute for the final gates below. Early failures were corrected (SQL CASE syntax,
pre-upgrade fixture using new T03 validation, test-only TypeScript inference, and
capacity validation join planning on fresh tables). The capacity eligibility check now
uses exact composite-key scalar lookups; diagnostic timings improved from seconds to
about 3ms at 1000 Parcels, without increasing any timeout. Temporary diagnostics were removed.

An overlapping full quality/gate-drill run reported seven file/line failures. The
92-case detailed real-PG reproduction across those six suites passed with zero failures,
skips, cancellations or todo after stopping the overlap. The final full gates run
sequentially. No required assertion, test concurrency scenario, timeout or runner was relaxed.

Final standalone `pnpm db:local quality` passed on 2026-09-14 with Node 22.23.2,
pnpm 10.34.5, Python 3.12.14 and disposable PostgreSQL 18.6:

| Exact command | Actual result |
| --- | --- |
| pnpm check:migrations | PASS; all 15 released files unchanged |
| pnpm db:local quality | PASS, exit 0 |
| pnpm check:toolchain | PASS; exact pinned versions |
| pnpm test:quality | 22 passed, zero failed/skipped/cancelled/todo |
| pnpm check:planning | PASS; domain/API/event/security/prototype/planning contracts and links |
| pnpm lint | PASS; tenant-query AST and ESLint, zero warnings |
| pnpm typecheck | PASS; all five packages |
| pnpm test:unit | 22 testkit + 12 DB unit tests passed; zero failed/skipped/cancelled/todo |
| pnpm test:api | 295 passed in 17 files |
| pnpm test:web | 95 passed in 5 files; existing React act warnings remain visible |
| pnpm test:db (inside quality) | 49 DB + 166 API/PostgreSQL passed; zero failed/skipped/cancelled/todo |
| pnpm build | PASS; API and production web bundle, 61 modules / 520.49 kB HTML |
| pnpm db:local verify:gates | PASS, all 24 stages; clean/restored quality and every expected rejection |
| git diff --check / git diff --cached --check | PASS |

The complete tracked/new-file and staged diff was inspected for tenant predicates,
composite ownership, immutable history, T03 truth, original-result replay, privacy,
minimal privileges, old-test preservation and downstream scope. No released migration,
dependency, CI, test runner or production web file changed. The final grant review removed
unused runtime SELECT on internal dispatch bindings and added an explicit denial assertion;
both clean/restored full quality runs passed with those final privileges. All 24 gate stages
passed, with no timeout, runner or assertion relaxation.

CI result on the final PR head: the **Final-head delivery record** in
[PR #110](https://github.com/ShippingCo/ShipIT/pull/110) records the exact reviewed SHA,
immutable workflow-run link, every job/result, scope, reviews/threads, mergeability and
issue review status. [PR checks](https://github.com/ShippingCo/ShipIT/pull/110/checks)
provide the independently fetched GitHub evidence. The record is updated only after those
checks complete on the final head; it never substitutes an earlier green run. Keeping the
final SHA/result there avoids a self-referential documentation commit invalidating its own
CI evidence. Maintainer approval remains separate; this PR must stay open and unmerged.

## Rollout, rollback and scope

Migration → exact grants → compatible API → synthetic create/Lot+direct/check-in/finalize /
T03/replay. Migration transaction failure rolls back; tracking makes reapplication a no-op.
Rollback stops new Route/dispatch writes, preserves additive schema and all evidence, and
repairs forward. An old opaque T03 producer is intentionally not write-compatible after
migration. No down migration, evidence rewrite or constraint-disable rollback.

Intentionally absent: route departure/delay/arrival API, ETA/status propagation, messaging,
carrier requests/credentials/polling, proof/OTP, payments, reports, new workers/frameworks,
AI logic, production RoutesPage/LotsPage/Dashboard or visual changes. #28/#34/#35 and other
downstream ownership remain meaningful. Subsequent route legs and replacement of finalized
initial allocation need a later reviewed lifecycle, not mutation of frozen evidence.
