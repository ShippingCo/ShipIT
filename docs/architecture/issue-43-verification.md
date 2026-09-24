# Issue #43 verification

Implementation branch: `issue-43-final-mile-notifications`. Work started from a clean,
freshly pulled `main` at `3932078a0e901701aca218e505cc51ca1959b1ff`.

## Prerequisite and live-state evidence

Before branching, Issue #43 was read from GitHub and remained open with stale
`status: blocked` metadata. There was no open PR or remote #43/final-mile branch. Issues
#24, #39, #40 and #42 were closed by PRs #107, #123, #124 and #126 respectively; their
merged implementations and verification documents were inspected. Exact-main Engineering
Checks run 35890585468 succeeded for the seven required jobs. Main had not advanced beyond
the prompt SHA. The latest of 29 released migrations was
`1791133200000-secure-delivery-proof.cjs`.

## Implemented boundary

The existing `customer-notifications` consumer retains M ordering and adds exactly:

| Policy | Source schema | Kind |
| --- | --- | --- |
| `delivery-attempt-failed:1` | `delivery.attempt_failed` v1 | `delivery_attempt_failed` |
| `parcel-rto-approved:1` | `parcel.rto_approved` v1 | `rto_approved` |
| `delivery-completed:1` | `delivery.completed` v1 | `delivery_completed` |

No attempt-start, retry-start, challenge-resend, payment, office-collection or reversal
policy was added. Policy identity remains separate from the stable consumer identity. Each
policy receives the existing immutable activation/code-and-binding hash. Retained sources
older than first activation become `skipped / historical_cutover`; restart cannot move it.

Dedicated scoped resolvers prove source/Parcel/attempt or approval/proof ownership and the
ordinary Booking → current Customer relationship. Optional update consent and current
contact remain #38/#39 authority. The private #42 `delivery_recipient` is never selected.
Failure text uses the closed mapping in [notification automation](notification-automation.md);
raw notes and subreasons are absent. RTO wording is template-owned return initiation and
cannot claim return completion/refund. Completion exposes only the safe proof-method wording
`recipient verification` or `approved alternate delivery proof`. Exceptional evidence,
reason, actor and challenge data are not loaded into variables or decision projections.

Immediately before outbound reservation, the #39 worker invokes the narrow #43 relevance
check while holding the Parcel row. An already committed newer outcome causes
`suppressed / source_superseded`, purges sealed rendering and makes zero provider calls.
The automation decision remains immutable historical evidence. If the lifecycle outcome
can commit only after reservation, the existing provider evidence is preserved; no remote
cancellation or exactly-once claim is made. Other outbound purposes are unchanged.

Completion variables contain no payment wording. The PostgreSQL fixture preserves the
positive To-Pay obligation byte-for-byte and proves no `payment.settled` event appears.
Automation performs no Parcel, Delivery or Payments mutation.

## Persistence, tenancy and privacy

No migration is required: #39/#40 tables already support the new policy IDs, kinds,
outcomes and safe reasons. All 29 released migration files remain unchanged.

Every new query accepts trusted `TenantAccess` and scopes the source event, Parcel,
attempt/failure/RTO/proof, Booking and Customer joins by Organization and Franchise. The
tenant-query suite includes a #43 positive control and an intentionally unscoped
`delivery_proofs` query that makes the actual checker exit nonzero. Foreign nested IDs
cannot resolve an item or enqueue. Stored decisions contain no event payload or variables;
sealed outbound variables contain no OTP, verifier, ciphertext, private recipient phone,
proof body, full address, staff identity or provider body.

## Reproducible fictional scenario

1. Create a fictional To-Pay Booking and begin a delivery attempt.
2. Commit T07 and process its event; inspect one failure decision and one sealed intent with
   the closed public reason.
3. Start the genuine retry and complete it before the old intent reserves.
4. Run the outbound worker; observe `source_superseded`, purged rendering and zero provider
   calls for the failure.
5. Process `delivery.completed`; inspect `recipient verification`, send once, restart/replay
   the consumer and observe no second decision or logical intent.
6. Repeat through independent exceptional approval and inspect
   `approved alternate delivery proof`, with no OTP claim or evidence reference.
7. Compare the To-Pay row before/after and observe unchanged positive outstanding value and
   zero `payment.settled` facts.

All fixtures use generated tenants, contacts, evidence and a synthetic provider. No real
customer/provider traffic occurs.

## Verification record

Pinned toolchain: Node 22.23.2, pnpm 10.34.5, Python 3.12.14; disposable PostgreSQL 18.6.

- `pnpm install --frozen-lockfile --ignore-scripts`, toolchain, migration, planning,
  tenant-query, lint, all five workspace typechecks and both production builds passed.
- `pnpm test:quality`: 31/31 passed, including the real-checker #43 negative fixture.
- `pnpm test`: 22 testkit + 12 database-unit + 482 API + 157 web + 3 object-store tests
  passed. Existing React `act(...)` and injected S3 streaming warnings remained visible;
  no rule or assertion was relaxed.
- Focused final-mile PostgreSQL: 10/10 passed, zero failed/skipped/cancelled/todo.
- Full `pnpm db:local test:db`: 67 database + 310 API PostgreSQL tests passed, zero
  failed/skipped/cancelled/todo; the disposable PostgreSQL container was removed.
- `pnpm db:local quality` passed: 31 quality tests, 22 testkit tests, 12 database-unit
  tests, 482 API tests, 157 web tests, 3 object-store tests, 67 database tests and 310
  database-backed API tests; both production builds passed and PostgreSQL was removed.
- `pnpm db:local verify:gates` passed the clean/restore paths and every controlled
  failure-injection drill, including the #43 unscoped-query negative control; PostgreSQL
  was removed. Exact-head CI is recorded in the PR after the final commit.
- The first exact-head CI attempt exposed that the test harness's pinned upstream MinIO
  digest was no longer available from Quay. The harness now pins the maintained Silo
  2026-09-03 multi-architecture release by immutable digest; a cold pull passed all three
  S3-compatible private-object contract tests before the aggregate reruns.

## Known external limits and downstream scope

Synthetic tests do not certify live Meta template approval, delivery or provider behavior.
Deployments must bind reviewed templates whose static copy expresses return initiation and
payment-independent completion. Issue #44 still owns provider-backed messaging/history UI;
#45 still owns end-to-end release qualification. Neither is implemented or advanced here.
