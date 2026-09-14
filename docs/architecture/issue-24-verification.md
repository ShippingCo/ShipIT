# Issue #24 verification — guarded Parcel lifecycle and delivery exceptions

Verified locally on 14 September 2026 from the Issue #23 merge on `origin/main`. The work
is on `issue-24-guarded-parcel-lifecycle` and remains uncommitted, unpushed and unmerged.

## Implemented boundary

The API adds five explicit POST commands; there is no status PATCH:

| Route | Edge | Current authority | Required evidence |
| --- | --- | --- | --- |
| `/api/v1/parcels/{id}/check-in` | booked → checked_in | operator F | expected version, evidence/location refs |
| `/api/v1/parcels/{id}/dispatch` | checked_in → dispatched | operator, dispatcher or franchise_admin F | expected version, evidence/manifest refs |
| `/api/v1/parcels/{id}/transit` | dispatched → in_transit | dispatcher F | expected version, evidence/route refs |
| `/api/v1/parcels/{id}/failed-attempt` | out_for_delivery → failed_attempt | assigned delivery_agent A | expected version, active attempt, closed reason/evidence |
| `/api/v1/parcels/{id}/rto` | failed_attempt → rto | franchise_admin F | expected version, eligibility/approval/return-plan refs |

F is the owning Franchise. C is deliberately not inferred from another Franchise membership:
no custody-transfer record exists yet. Failed-attempt is the one implemented A command and
requires both stored assignment and active-attempt identity. This is fail-closed compatibility
with the canonical F/C/A policy, not a replacement policy.

Every command rejects unknown fields and arbitrary/free-text reasons. `other_controlled`
requires a closed subreason. Ordinary RTO requires exactly two failures and a retry-path last
reason; a privileged early RTO requires at least one real failure plus a closed override,
approval, eligibility and accountable return-plan reference. Timer-only RTO is absent.

## Storage and concurrency

Forward migration `1789750800000-guarded-parcel-lifecycle.cjs` adds the command ledger,
append-only transitions, failed attempts and RTO approvals, extends the Parcel aggregate,
and expands the existing domain-event/audit projections. Composite keys retain Organization,
Franchise, Booking and Parcel ownership on every child.

`SELECT … FOR UPDATE` serializes each aggregate. The expected version is checked again in
the guarded UPDATE. A scoped `(principal, tenant, operation, key digest)` receipt reserves
intent and stores the original response. The deferred completion trigger requires the exact
new version/status plus one matching transition and event, with matching edge, actor,
correlation, sequence and event identity. Failure/RTO commands also require their one typed
evidence row. Any error rolls the transaction back.

Aggregate shape constraints fix custody/count/assignment relationships. The lifecycle
trigger permits only a reserved typed edge and a one-step version increase. Runtime receives
only lifecycle-column UPDATE, command completion UPDATE, and SELECT/INSERT on lifecycle
tables. History has no runtime UPDATE/DELETE/TRUNCATE/DDL grant and immutable triggers also
reject owner mutation. Existing rows migrate as unchanged booked/version-1 Parcels.

## Primary-source technical review

- AWS Builders' Library recommends caller-provided request identifiers, semantic-equivalence
  checks and atomic storage of deduplication state with the mutation:
  <https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/>.
- Stripe describes durable idempotency keys for mutating POST requests so a lost response can
  safely return the original result: <https://stripe.com/blog/idempotency>.
- PostgreSQL documents `SELECT FOR UPDATE` row locking and application-level consistency for
  serializing conflicting writers: <https://www.postgresql.org/docs/17/explicit-locking.html>,
  <https://www.postgresql.org/docs/16/applevel-consistency.html>.

The implementation follows those patterns without adding a broker, distributed lock or new
runtime dependency. The existing PostgreSQL transaction remains the consistency boundary.

## Acceptance evidence

Real PostgreSQL tests exercise typed happy paths, exact version/custody changes, timeline and
audit append, concurrent same-key replay, changed-intent conflict, two different same-version
contenders, attempt/agent binding, one-time failure increments, two-attempt RTO, controlled
early override, invalid subreasons, stale/backward commands, role ceilings, identical unknown/
foreign denial, absent generic PATCH, injected post-history failure rollback and fresh-pool
retry. Migration tests cover fresh/upgrade/repeat execution, failed migration rollback/retry,
catalog objects, legacy-row preservation and runtime least privilege.

Latest focused results before the final repository-wide gate:

- API Vitest: 231 passed.
- PostgreSQL 18.6: 45 database plus 129 API/database passed; zero failed, skipped,
  cancelled or todo.
- Tenant-query AST gate and ESLint passed.

## Deployment and rollback

1. Apply all forward migrations with the migration identity.
2. Add the exact lifecycle runtime grants documented in the DB package README.
3. Deploy compatible API code and probe check-in/replay/foreign denial using synthetic data.
4. Monitor controlled 409/422/503 rates and command receipts; never retry with a new key after
   an uncertain response.

Rollback disables or reverts the compatible API while preserving the additive schema,
aggregate history and command receipts. There is no down migration or history deletion.
Repair an applied schema only with another reviewed forward migration.
