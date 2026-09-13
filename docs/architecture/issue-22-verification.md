# Issue #22 verification

Starting main: `b15f5cf5cb5f1e2fbf90062e06fdea7c8ac417e6`, fetched and fast-forwarded
from a clean main before branch `issue-22-atomic-booking-creation`. Remote main CI run
34715707712 passed at that SHA. No existing Issue #22 branch/open PR was present.
Prerequisites #4/#15/#16/#19/#20/#21 are CLOSED; PRs #87/#98/#99/#102/#103/#104 are
merged ancestors. Issues #2–#21 are closed. Issue metadata moved blocked→ready→in-progress,
preserving unrelated labels, milestone, assignees and text. Delivery stops before merge.

## Acceptance evidence

Implementation abbreviations: B = `apps/api/src/modules/bookings/`; C = customer
repository snapshot port; M = membership service `withBookingTenantScope`; P = parcel
repository; S = `packages/db/migrations/1789578000000-atomic-bookings.cjs`.
Test suites below use real PostgreSQL and runtime roles unless explicitly marked unit.

| Issue criterion / required boundary | Implementation | Executed tests / observed behavior |
| --- | --- | --- |
| Timeout after commit returns same Booking/docket | B/service, repository.reserve/complete; S booking_commands | API DB `lost COMMIT acknowledgement reconciles from durable receipt through fresh service and pool`: original stored DTO recovered, one Booking |
| Concurrent allocations unique | P/repository; S sequence/allocator/parcels_docket_key | API DB `twenty distinct-key creates across independent pools allocate globally unique dockets`: 20 unique dockets, 20 Bookings, 40 events across four independent pools |
| Same-key race and changed intent | B/idempotency, reserve; M Organization lock | API DB `twenty concurrent same-key HTTP creates return original 201 DTO with one logical mutation`: 20 original 201 DTOs, one Booking; changed precondition conflicts without additional event |
| Foreign customer/lot cannot attach | C, M, B/validation; S owner FKs | API DB `only operator is activated; sibling and unrelated customer IDs are indistinguishable from unknown; guessed selectors cannot widen scope`; `strict mass-assignment including foreign lot_id produces no booking effects or audit mutation` |
| Server owns tax/status/ownership/payment | B/validation/service/types | Same mass-assignment test plus 15 parameterized unit cases: 422, unchanged business and audit counts; separate nested-field unit test |
| Manual docket validation/conflict | B/validation.docket; S global constraint and watermark | Unit `normalizes ASCII docket edges/case and preserves internal punctuation`; API DB `manual collision rolls back the complete multi-parcel command and sequence gaps cannot be manually reused`: safe DOCKET_CONFLICT, complete rollback |
| No orphan Booking/Parcel/money/event on failure | B/service, S deferred completeness | Nine API DB `atomic rollback and same-key recovery after injected ...` cases: customer, quote, tax, Booking, Parcel, obligation, audit, event and receipt failures each leave all six counts unchanged; retry succeeds |
| Exactly one booking.created and one parcel.booked per child | B/events, S unique/completeness constraints | API DB `operator creates canonical booking and one child with frozen authoritative money and exact reference-only event/audit counts`: 1/1/1/1/1/2 counts; multi-child case: 1/2/1/1/1/3 |
| No premature WhatsApp/provider/receipt/paid claim | B/types/events, bounded server composition | Same canonical booking privacy assertions; full source/diff inspection; no provider/client/UI/worker implementation added |
| Authorized result survives restart/reload | B durable command result and snapshots | Fresh service **and runtime pool** in lost-ack test returns exact saved result; HTTP replay also covered after Customer/policy changes; no localStorage |
| Malformed/stale/dependency errors controlled | Existing strict JSON/errors; B validation/service | Unit invalid number/cardinality/key/Unicode cases; API DB `expired or mismatched pricing/tax evidence and stale customer preconditions fail atomically`; nine dependency fault cases |
| Logs/audit/events exclude prohibited PII/credentials/keys | B explicit DTO and reference-only envelopes; audit append/security category | Canonical booking privacy assertions examine API output, logs, audit and producer events; authorized contact fields appear only in operator DTO/snapshots |
| Current exact operator permission, disabled roots, replay revocation | M coordinator | Seven-role denial matrix; revoked operator 404; disabled Organization/Franchise 409; independent capability action/lifetime test |
| Customer and financial snapshot immutability | C SELECT FOR SHARE; B pricing/tax ports; S source/immutable guards | API DB `customer edits and future pricing/tax publication cannot rewrite persisted snapshots or replay`; DB owner UPDATE/DELETE rejected |
| Initial obligation reconciles final paise | B/types.obligation; S obligation FK/check | Unit zero/odd/max integer preservation, no collection/rounding; real canonical result: final 13400, collected 0, outstanding 13400 |
| Strict ordered 1–50 children and exact quote weight | B/validation | Unit cardinality and BigInt sum bounds; multiple-child HTTP creation preserves order/dockets; canonical unit verifies property-order equivalence and child-order significance |
| Migration/history/privilege/failure recovery | S; packages/db/test/support.prepareBookings | Four DB `bookings.test.ts` cases: ten→eleven upgrade/no-op, failed migration rollback/fresh retry/forward repair, least privilege/immutability, partial command/owner/event constraints; all earlier migration-upgrade suites retained with new total counts |
| Scope gate cannot be bypassed | security/scope; scripts/check-tenant-queries.mjs | Tooling `booking and parcel repositories require both owners and cannot mint capabilities or use raw SQL`; existing actual CLI negative controls retained |
| Safe audit view remains usable | audit repository/view/cursor | API DB `booking audit cursor supports multiple pages without exposing commercial snapshots`; original audit compatibility suite remains green |
| Bounded maximum receipt and nested DTO privacy | B/types.bookingDto; S result size check | Unit nested private-field projection and API DB `fifty parcels with maximum Unicode contact lengths fit the bounded durable response`: 50 children, 51 events, saved response within 512 KiB |
| Independent read-only snapshot and live privileged pricing permission | M coordinator; security/scope; B/service replay | API DB `customer snapshot capability is read-only even for directly submitted scoped SQL` and `privileged pricing confirmation additionally requires live W43 while operator remains mandatory`: direct UPDATE forbidden; combined operator/admin succeeds, revoked W43 replay is 403 |

The actual file paths are `apps/api/test/integration/bookings.test.ts` (unit),
`apps/api/test/database/bookings.test.ts` (HTTP/service/real DB), and
`packages/db/test/integration/bookings.test.ts` (schema/real DB). Fixture composition is
`apps/api/test/booking-support.ts`, reusing tax/pricing/customer/audit/testkit foundations.
Counts above are synthetic verification queries through the guarded maintenance seam,
never a public count/search endpoint.

## Verification commands and results

Pinned Node **22.23.2**, pnpm **10.34.5**, Python **3.12.14**, disposable PostgreSQL **18.6**.
`pnpm install --frozen-lockfile` succeeded without lockfile/dependency changes. The package
manager displayed its optional newer-version notice; the required version was retained.
The cached Python tree was incomplete; a fresh Python 3.12.14 standalone archive was
verified against release SHA256 `81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b`.
No repository toolchain requirement was weakened.

```sh
node --version
pnpm --version
python --version
pnpm install --frozen-lockfile
pnpm check:toolchain
pnpm check:migrations
pnpm check:planning
pnpm test:quality
pnpm check:tenant-queries
pnpm lint
pnpm typecheck
pnpm test
pnpm db:local test:db
pnpm build
pnpm db:local quality
pnpm db:local verify:gates
git diff --check
```

`db:local` supplies guarded generated PostgreSQL credentials to the exact `pnpm test:db`,
`pnpm quality` and `pnpm verify:gates` commands, then removes its own container. No required
PostgreSQL layer is mocked or skipped. Unit/service-free tests are separate from SQL proof.
The final source passed the complete quality pipeline with these observed results:

| Command | Result |
| --- | --- |
| `node --version`; `pnpm --version`; `python --version` | v22.23.2; 10.34.5; Python 3.12.14 |
| `pnpm install --frozen-lockfile` | PASS; no dependency/lockfile changes |
| `pnpm check:toolchain` | PASS; exact tools |
| `pnpm check:migrations` | PASS; all 10 released migration files unchanged |
| `pnpm check:planning` | PASS; domain/API/event/security/policy/prototype and local-link checks |
| `pnpm test:quality` | PASS; 20 tests, zero skipped |
| `pnpm check:tenant-queries`; `pnpm lint` | PASS; tenant AST gate and ESLint with zero lint warnings |
| `pnpm typecheck` | PASS; all five packages |
| `pnpm test` | PASS; 22 testkit + 12 DB unit + 223 API + 86 web tests |
| `pnpm test:db` (through `db:local`) | PASS; 45 DB + 118 API real PostgreSQL tests; zero failed/skipped/cancelled/todo |
| `pnpm build` | PASS; API TypeScript and Vite, 61 modules; web 520.49 kB / 143.38 kB gzip |
| `pnpm quality` (through `db:local`) | PASS; entire pipeline, exit 0 |
| `pnpm verify:gates` (through `db:local`) | PASS; all 24 isolated stages behaved as expected; final harness exit 0 |
| `git diff --check` | PASS |

Gate drills passed empty-store install, clean quality, final-gate success and restored
quality. The other 20 stages intentionally rejected unscoped SQL, production/demo imports,
lockfile/lint/promise/async/type/test/testkit/API/build faults, missing/unavailable/empty/
skipped database execution and failed/cancelled/skipped/missing final-gate dependencies.
Those injected exits were expected (type rejection exit 2; other rejections exit 1), not
unresolved test failures. The helper removed its disposable PostgreSQL container.

There are 23 new booking unit tests, 27 new booking API/database tests and four new
schema tests. Existing React `act(...)` warnings remain in the unchanged web prototype
suite; there are no skipped or mocked substitutes for required PostgreSQL checks.
Current-head CI evidence is recorded in the linked PR, whose source commit is immutable.

Initial focused run: 22 new unit tests and 22 booking API DB tests passed. An initial full
DB run failed solely on eight historical migration-count expectations; those were updated
for the one additional migration without removing tests. A new failed-migration recovery
test exposed CommonJS caching of an already loaded failing fixture; a fresh migrator module
path now models process restart before retry. The first quality attempt failed because of
the incomplete cached Python standard library; replacing that local runtime fixed it.
A subsequent full quality run passed: 20 tooling tests, 22 testkit + 12 DB unit, 222 API,
86 web, 45 real DB + 114 real API DB tests; zero DB failed/skipped/cancelled/todo. The
final larger counts above include the additional DTO, receipt-size and permission coverage.

## Synthetic reproduction and review

1. Use the pinned toolchain and Docker; run the commands above. `bookingSetup` creates
   isolated Alpha A1/A2 and unrelated Beta C roots and real users/sessions/memberships.
   No production data, phone directory, external tax service or provider is used.
2. An A1 franchise administrator publishes the explicitly fictional 2099 policy fixtures.
   An operator obtains a 999-gram SYN_DEST quote: freight 12551, packing 249, pre-tax 12800.
   Tax fixture components yield CGST 320 + SGST 320, unrounded 13440, adjustment -40,
   final 13400 paise. These fixture ratios are not production tax rates.
3. Create the existing synthetic Customer, prepare/calculate tax, then POST the body in
   `bookings.md` using fixture-returned IDs, real test session/CSRF cookies and a fresh key.
   Observe Booking active/version 1, Parcel booked/awaiting_intake, permanent SIT docket,
   initial uncollected obligation and exactly two reference-only events plus one audit.
4. Replay, race 20 requests with that key, and race 20 distinct keys through four pools.
   Retry the simulated lost COMMIT acknowledgement with the same key/body through a fresh
   service/pool. Inspect persisted scoped results/counts rather than only HTTP status.
5. Split grams 400/599 across two parcels and manually enter ` syn-a ` / `syn-b`; verify
   preserved order and SYN-A/SYN-B. Collide the second child after allocating the first;
   inspect complete rollback and the consumed sequence gap.
6. Try read_only and all other non-operator roles; valid A2/C Customer IDs; unknown IDs;
   guessed selectors; disabled roots; stale source/proposals; lot_id/paid/tax/status fields.
   Inspect uniform safe denials and unchanged Booking state/counts. Revoke operator and
   prove an old receipt cannot disclose its DTO.
7. Edit Customer, publish future rate/tax versions, advance the synthetic clock, replay.
   Original contact/charge/docket/result evidence remains identical. Inject each dependency
   fault and prove rollback/retry. Inspect protected fixtures for no key/PII in audit/events/logs.

No UI is changed, so new browser/keyboard tests are inapplicable; all existing frontend
regression suites and production/demo isolation checks remain active.

## Migration, rollout, rollback and handoffs

Apply the eleventh additive migration with the migration owner, grant the exact least
privileges in `packages/db/README.md`, deploy compatible API, and run the synthetic flow.
There is no seed/backfill/legacy-browser import. Existing tax/pricing approval/configuration
requirements remain. AUTH_SECRET_REF controls authenticated composition; no public bypass
or frontend fallback is added. Preserve all ten released migration hashes.

For rollback, disable/revert compatible Booking API code and retain tables, immutable facts,
receipts and sequence watermark. Do not delete completed commands or reset/reuse dockets.
Repair applied schema with a new forward migration; failed unapplied schema/ledger changes
roll back together, and a fresh migrator can retry. Receipts are retained at least 24 hours
and never purged by this implementation. After an uncertain response use the same key/body;
if authoritative receipt evidence is unavailable, stop automatic resubmission and require
scoped reconciliation. No expired-uncertainty reconstruction endpoint is promised.

Exact API, docket layout/normalization/watermark behavior, confirmation-time derivation,
customer/pricing/tax snapshots, payment semantics, event counts and limitations live in
`bookings.md`. #23 owns retrieval/reconciliation UI/search, #24 lifecycle/custody, #26
persistent lots and membership validation, #29 collections/ledger, #30 issued receipts,
#33 production UI, #35 relay. No WhatsApp/provider call, payment settlement, issued receipt,
lot implementation, frontend migration or worker was added. Privileged confirmation requires both operator and current W43 membership; unsupported
historical/special tax timing is not activated here.
Organization-wide serialization is conservative; this test proves correctness at the
requested concurrency, not production throughput. W01's broader role ceiling versus
Issue #22's operator-only activation requires reviewer confirmation, not a silent matrix edit.
