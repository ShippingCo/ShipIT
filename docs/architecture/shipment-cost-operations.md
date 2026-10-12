# Shipment cost operations

Issue #147 records direct shipment cost evidence and compares it with adjusted tax-exclusive
booking revenue. It does not calculate net shop profit, settle agents, move cash or verify
supplier invoices. Use the production Reports workspace with current franchise scope.

## Capture and correct costs

Only a current franchise admin may create costs, replace allocations or apply imports.
Choose courier, packing, agent or payment cost; record its amount, effective time, reference
and reason. Amounts are integer paise at the API boundary. Select owned bookings and,
when applicable, their parcels. Allocate explicitly; the system does not invent a weight
or value split. Any unallocated remainder remains visible and prevents complete coverage
for the affected contribution. Revision allocations replace the previous allocation set.

Use estimated evidence until an actual amount is known. Revise the same source with its
current version when actual evidence arrives. Use explicit not-applicable declarations
only when that category is inapplicable; missing evidence is not zero cost. All four
categories must have actual or not-applicable evidence for complete actual contribution.
An estimate can support estimated contribution but cannot establish actual contribution.

Supplier/document/line identity prevents recording one invoice line twice under new command
keys or another category. Link an existing native applied expense to enrich that same cost,
not to create a second cost. Native per-delivery agent expenses already attribute to the
proved booking automatically; do not manually allocate them again. Period fees require
explicit allocation. Payments, advances and earnings are not counted again as expenses.
Approved carrier purchase-rate evidence produces an estimate with retained source inputs;
it does not change the booking's selling price or certify an actual invoice.

Corrections are append-only. If a native expense is corrected below its allocations,
reconcile allocations explicitly before recapturing; a conflict is not permission to cap
or redistribute amounts silently. Earlier eligible evidence remains reconstructible.
A native applied expense corrected to zero may retain actual zero-cost evidence with
explicit zero allocations. This does not turn a missing cost into zero or permit a manual
monetary cost or purchase-rate estimate with a zero amount.

## Imports and uncertain results

Preview the supported ShipIT cost CSV or structured rows before applying. The CSV contract
is documented in [API contracts](api-contract.md); it is not a claim of compatibility with
an unnamed supplier's file. Inspect each row's outcome. Preview alone records no cost.
Apply revalidates source versions and commits the complete batch atomically. Invalid or
stale previews require correction and a new preview; no partial-success claim is valid.

After a timeout or lost acknowledgement, retry the identical command with the same key
and body. Do not generate a new key merely because the response is uncertain. Changed
bodies conflict, and revocation takes effect before replay. On a stale-version conflict,
reload source history and reconcile the intended change against the current revision.

## Read contribution

Select an Asia/Kolkata booking-date cohort of at most 31 days. Blank effective E and recorded
K cutoffs use the same current server instant. E selects effective facts; K selects retained
facts recorded by that instant. Copy exact UTC cutoffs, including microseconds, to reproduce
eligible evidence. This is not arbitrary reconstruction of past database visibility.

Revenue is counted once per booking across its parcels. GST, goods COD and money transfers
are not revenue. Unknown or mixed courier attribution stays explicit; it does not invent a
revenue split. Group by courier, service, customer, destination or booking day and inspect
the saved source references. A missing category produces unknown contribution. For example,
INR100 revenue less INR60 courier and INR10 agent costs gives INR30 only when packing and
payment coverage are also established; with a courier estimate this is estimated contribution.

Period shop expenses are a separate occurrence cohort with attributed and unallocated
amounts. Do not add that list again to booking costs or label the result net profit.

Snapshots are private, immutable, actor-bound and expire after 24 hours. They retain exact
cutoffs, source IDs and versions. Download uses the same saved evidence, safe CSV columns
and current E03 authorization. An expired snapshot needs a new capture; exact saved E/K
can reconstruct retained facts. Large results return a controlled limit error, never a
silently truncated financial total; narrow the cohort when necessary.

## Rollout and rollback

Apply migration 50 and [runtime grants](../../packages/db/README.md), complete required
verification, then independently authorize activation of `SHIPMENT_COST_WRITES_ENABLED`.
The flag defaults off and is invalid in demo. Disable new commands to roll back activation;
keep historical schema, source evidence and exact committed replay. No deployment or
production-data access is authorized by this guide. See [authorization](authorization-contract.md)
and [financial contracts](financial-operations.md) for governing boundaries.
