# ADR 0006: Canonical domain, custody and authorization contracts

Status: submitted for acceptance through the issue #3 PR; accepted on approved merge.
Date: 2026-09-07 (UTC). Owner: #3 / domain architecture.

[Architecture index](../architecture/README.md) · [Decision register](../architecture/open-decisions.md)

## Evidence and precedence

Issue [#2](https://github.com/ShippingCo/ShipIT/issues/2) closed after
[PR #85](https://github.com/ShippingCo/ShipIT/pull/85) merged at
`256512a725c56c5c0e0fa180253add5ac20a69d0`. ADRs 0001–0005 constrain this decision.
The project owner's approved Issue #3 execution instructions (sections A–X, supplied
6 September 2026 Toronto time) are the business authority recorded here and in the
linked contracts. The Issue #3 PR preserves this decision evidence for reviewers.

The original issue's one-parcel MVP suggestion is intentionally replaced by **one
Booking with one or more Parcels from day one**. Prototype types/store are mapping
evidence, never state, identity or authorization authority. No accepted ADR requires
one parcel, an operational org_admin, or a particular #3 role matrix.

## Decision

- One Organization → Franchise architecture supports independent and parent businesses.
  Customers and commercial records have explicit organization/franchise ownership.
- Booking owns the customer/commercial transaction; Parcel owns physical lifecycle,
  docket, custody, routing, attempts, delivery and RTO. Dockets are globally unique.
- Custody grants minimum access to that parcel's shipment snapshot, never a customer
  directory or sibling booking. Delivery agents see current assignments only.
- Seven roles have closed action/resource/scope grants. org_admin has declared own-org
  reads/audit/verification, without automatic operations or exports. Franchise admins
  administer local operations; exact state roles still apply. Agent custody transfer
  requires a separate, revocable grant from the responsible franchise admin.
- Whole-booking cancellation is restricted to operator, dispatcher and franchise_admin
  before **any** child ever moves. It does not create a parcel cancellation state.
- The lifecycle includes held_at_office, at most two delivery attempts, reason-driven
  retry/collection, admin-approved RTO and audited admin-only delivered correction.
- INR money uses integer paise; final customer amount rounds once to whole rupees,
  50 paise upward, with a separate adjustment. UTC instants and Asia/Kolkata business
  dates are distinct. Tax/proof/ledger implementation remains with its owning issue.
- Parent adoption requires franchise and receiving-organization approvals against a
  conflict-reviewed migration plan. No direct organization ID edit or automatic merge.

Normative details: [domain](../architecture/domain-contract.md),
[authorization](../architecture/authorization-contract.md),
[lifecycle](../architecture/parcel-lifecycle.md),
[prototype mapping](../architecture/prototype-domain-mapping.md),
[synthetic cases](../architecture/domain-scenarios.md).

## Conservative decisions and unresolved policy

The lifecycle explicitly records narrow decisions for office intake, counter collection,
failed-attempt counting, collection deadline interpretation and delivered correction.
These are visible #3 contract decisions with rationale, not undocumented constants.
Absent authority for cross-organization custody, generic state rewinds, customer merges,
financial reversals, holiday calendars or new job privileges means deny/defer to the
named owner. See the lifecycle policy ledger and the decision register.

This completes D01/D02's canonical policy portion on acceptance. D03 resolves ownership
and isolation only; #19 still owns matching/merge mechanics. D06/D07/D12/D14 retain
implementation/policy questions beyond the approved #3 boundaries.

## Consequences and alternatives

One combined Booking/Parcel record cannot represent partial deliveries, separate routes
or per-parcel attempts. A global customer directory violates sibling isolation. Treating
admin as superuser violates the approved read/audit boundary. Separate franchise/enterprise
architectures would make later adoption harder and are rejected.

Downstream #4/#12/#14/#19/#22/#24/#42 must implement these contracts with real server and
DB tests. No production schema, RBAC, API, money engine, timer, data migration or provider
integration is implemented here. Existing prototype behavior remains intact. Reverting
these documents has no runtime/data rollback effect. Changing an accepted policy requires
a reviewed amendment/superseding ADR and downstream compatibility evidence.
