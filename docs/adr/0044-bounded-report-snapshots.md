# ADR 0044: bounded, private report snapshots

Status: implemented locally for #61; verification is recorded separately.

## Problem and boundary

A courier owner must not see one balance on screen and a different balance in the
CSV merely because another payment arrived. #61 supplies a common snapshot contract,
not the downstream GST register, ageing policy, profitability dashboard or accounting
mapping. M6's approved expansion allows this framework to start independently of #137.

Existing R11 financial reads permit franchise admins/accountants in granted locations,
and org admins in their own organization. E03 exports remain franchise-admin/accountant
only; an org-admin role alone cannot export. Each snapshot belongs to its creating
actor and one explicitly authorized franchise. #66 owns organization-wide selection.
No role is added, and report access grants no financial mutation authority.

## Research and decisions

| Problem / primary source | Decision and fit | Cost and verification |
| --- | --- | --- |
| Concurrent source changes: [PostgreSQL 18 transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html) | **Adapt.** One SELECT captures booking and ledger facts in a single statement snapshot. Save those rows and derive all totals/pages/CSV from them. No open database cursor across HTTP requests. | Extra private derived storage, bounded to 5,000 rows/8 MiB. Test changes after capture, restart, pagination, matching totals and exports. |
| Response lost after commit: [AWS Builders' Library: safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | **Adopt.** Actor/tenant/key plus normalized fingerprint; same request returns the existing snapshot, conflicting reuse fails. No automatic new key after uncertainty. | One unique constraint and replay lookup; test concurrent duplicate capture, injected uncertain COMMIT and conflicting reuse. |
| Spreadsheet interpretation: [OWASP CSV injection](https://community.owasp.org/attacks/CSV_Injection) | **Adopt at the output boundary.** Quote every cell, double embedded quotes, and prefix dangerous formula/control starts with an apostrophe. V1 selects only IDs, timestamps, source versions and money, omitting customer contact fields. | Formula/control/delimiter tests; escaping is not a guarantee after a spreadsheet user edits or resaves the file. |

These practices assume one PostgreSQL-backed pilot deployment and bounded shop-sized
reports. An analytics warehouse, streaming pipeline and long-running export workers
are **deferred**: they add operational state and retry complexity without a current
requirement to export more than the documented maximum. Oversized requests fail before
persisting a partial snapshot. Existing statement/query timeouts remain in force.

## Semantics and exact values

`booking_cohort_v1` selects bookings confirmed within inclusive Asia/Kolkata calendar
days (start inclusive, next-day midnight exclusive in UTC), sorted by confirmed time
and UUID. Every booking appears once even when it has multiple parcels or payments.
`as_of` is the database statement capture time: facts visible to that statement, not
an arbitrary historical reconstruction or a promise to include uncommitted transactions.
New captures can differ after late source changes; an existing ID cannot change.

Independent measures: billed gross is saved booking payable; tax-exclusive revenue
is saved pre-tax charges; collections are net collection less reversal entries on the
selected obligations; outstanding is their booked obligation less net collections.
This is a **booking cohort**, not collections received during the booking date period.
Saved rounding adjustments are not recomputed. No current pricing/tax configuration
is consulted. Future #139 adjustments require an explicitly new calculation definition.

Refundable credit, customer advance, seller-COD liability, expenses, agent custody and
verified settlement have independent typed measure slots and remain `unknown` until
their owning producers exist. In particular, a payment record is not verified settlement,
a monthly bill is not a second sale, and a cash transfer is not another collection.
Cost and due date remain unknown, never estimated from missing evidence. Exact aggregate
paise use decimal strings and BigInt, avoiding unsafe floating-point sums.

Source references carry type, ID, version and correction linkage. Booking and ledger
versions are populated now; the other source types reserve a public interface only.
Later producers must provide their authoritative facts, versioned correction links,
freshness and a new calculation definition when semantics change. No future source
workflow, permission or financial policy is implemented here.

## Storage, privacy and recovery

One additive migration creates private snapshots and append-only access evidence. It
does not backfill or modify existing financial rows. Runtime gets SELECT/INSERT and
guarded expired-payload clearing only; original unexpired snapshots cannot be changed.
The existing audit projection includes capture/read/export actions, actor, scope,
snapshot reference, correlation and time; no CSV content, contacts or credential data.

Snapshots expire after 24 hours. Every read/download rechecks current membership,
actor ownership and expiry; foreign and missing IDs return the same 404. Export uses
authenticated API delivery with `no-store`, not a public URL or bearer download token.
The client retains only the opaque snapshot ID in its URL for reload. It stores no
financial report in browser persistence. At most 20 unexpired snapshots per actor and
franchise are allowed; existing snapshots may be reused.

The simple pilot implementation serializes capture/quota checks on the existing
franchise lock, following monetary command lock order. Downloads do not lock or change
financial sources. Failure of snapshot/access-evidence insertion rolls back the capture.
Expired same-key replay is a controlled 410; use a new key for an intentional new capture.
See the report guide for retention and deployment grants.
