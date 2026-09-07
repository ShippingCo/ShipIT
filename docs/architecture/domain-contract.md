# Canonical domain and ownership contract

[Architecture index](README.md) · [ADR 0006](../adr/0006-domain-ownership-and-authorization.md) · [Authorization](authorization-contract.md) · [Lifecycle](parcel-lifecycle.md) · [Examples](domain-scenarios.md)

Contract version: Issue #3 / v1. These are requirements for later production work,
not implemented tables or services. The approved owner decisions take precedence over
Issue #3's original one-parcel suggestion and the browser record shape.

## Glossary and relationships

| Concept | Meaning / canonical responsibility | Ownership and relationship |
| --- | --- | --- |
| Organization | Enrolled business tenant, independent owner or parent courier business | Own tenant identity; does not require national carrier enrollment |
| Franchise | Operating business/location within one organization | Exactly one current organization; independent setup creates its own Organization + Franchise |
| Membership | Authenticated user's explicitly scoped role and grants | Identity → organization → declared franchise(s); absence fails closed |
| Customer | Franchise-owned customer relationship/profile | Organization + franchise; same phone/person in two franchises does not share a record or identity grant |
| Booking | Parent commercial/customer transaction, charge/tax snapshots and payment obligation | Exactly one owning organization/franchise; one or more child Parcels from day one |
| Parcel / shipment | Physical operational unit | Exactly one Booking; inherits commercial ownership; independent lifecycle, globally unique docket, route, custody and delivery history |
| Shipment parties | Sender and recipient snapshots needed for one parcel | Scoped to that shipment; sender may reference own-franchise Customer; recipient need not be an account or directory record |
| Docket | System-wide parcel lookup identifier | Exactly one Parcel; distinct from Booking ID, carrier reference, lot or route code |
| Custody | Current operational responsibility and physical handover evidence | Parcel-level responsibility; never changes owning organization/franchise |
| Hub / office | Operational location operated by a franchise | Has responsible organization/franchise; no new tenant type or global directory |
| Lot / manifest | Validated grouping of physical parcels for operations | Owned by operating franchise; membership references Parcels, not whole Bookings |
| Route / dispatch | Physical movement and its validated parcel manifest | Owned by operating franchise; can contain authorized sibling-owned parcels under custody |
| Delivery assignment | Time-bounded responsibility of one delivery agent | Parcel + current responsible franchise + current member agent; no access after reassignment |
| Delivery attempt / proof | One physical attempt and its protected evidence | Parcel-scoped; OTP verification failures are separate counters; Deliveries approves completion |
| Payment obligation / ledger | Commercial amount owed and append-only collection/reconciliation facts | Booking-owned; partial parcel delivery does not settle it; approved collection allocations owned by #29 |
| Customer timeline | Safe projection of immutable shipment facts | Parcel-scoped; never a dump of internal events, customer history or proof |

Organization has one or more franchises in the active operating model. A standalone
franchise is an organization with one franchise; the same model supports an owner with
multiple franchises and a national parent. No subscriptions, entitlements or separate
editions are needed. Later adoption changes ownership through the migration below.

Booking creation must atomically create all submitted child parcels or none. Every
child shares the Booking's ownership path; parent/customer/child references are checked
server-side. Each parcel may progress independently. A booking summary can report
"1 of 2 delivered"; it is not an operational status propagated to all children.
Changing a parent reference or ownership key is not an ordinary edit.

## Customer isolation and field boundaries

No global or implicit sibling-franchise customer directory exists. A1 and A2 may each
hold an independently obtained customer relationship for the same person; normalization
must not reveal that another record exists. #19 owns scoped matching and reviewed merge
mechanics, #46 verified self-service identity, #72 retention. Typed phone numbers and
dockets are selectors, never authentication.

A custodial A2 sees **only the required shipment snapshot**: docket, parcel description,
required sender details, recipient name/phone/delivery address, destination, weight,
service, current status, relevant route and delivery instructions. Payment amount/status
is included only where collection is operationally required. Access does not follow the
customer reference into profile/history, sibling parcels or the owning franchise's ledger.
An agent sees only the minimum delivery subset for current assignments. Accountant and
read_only projections are narrower as specified in the authorization contract. #4/#23
own exact DTO/query projections; no full row serialization is permitted meanwhile.

## Ownership versus custody

A1 → A2 hub → A3 office → agent → recipient is possible within one organization;
A3 is illustrative, beyond the three-franchise test fixture. A1 retains Booking/Parcel/
Customer ownership throughout. Custody changes do not create membership or ownership.

| Custody facet | Required contract |
| --- | --- |
| Owning organization / franchise | Persisted commercial path inherited from Booking; immutable through ordinary commands |
| Current custodian | Exactly one accountable holder at a time; responsible organization/franchise plus typed holder reference |
| Type / location | `franchise_office`, `hub`, `route_dispatch`, `delivery_agent`, or `recipient`; initial `awaiting_intake` records that ShipIT has not accepted physical possession |
| Route / dispatch | Valid current route/manifest and responsible franchise; a planned route alone does not confer custody or movement |
| Agent | Active assignment, current membership and handover evidence; assignment is access scope, possession is custody; record both explicitly |
| Handover | Current/from and intended/to custody references, physical receipt evidence, UTC time, version, actor and reason/cause; no two simultaneous current custodians |
| Access lifetime | Operational projection only while current custody/assignment justifies it; revoked on handover/reassignment; retained audit evidence does not retain live shipment PII access |
| Terminal | Delivered ends operational assignment/access and records recipient handover; RTO retains accountable return custodian and a limited return-processing projection |

### Transfer boundaries and command

Within an organization, office/hub/route/agent transfers require a valid destination and
current source custody. Franchise_admin of the **current responsible franchise** may
transfer; ownership at A1 alone does not authorize a remote handover of A2-held property.
A current assigned delivery_agent may transfer only with `parcel.custody.transfer` granted
by that responsible franchise's owner/admin. The grant is separate from role, scoped to
franchise/assignments/permitted destinations, revocable, audited and cannot be self-granted
or delegated onward. #14 defines grant mechanics. All other roles lack independent transfer.

Validate live membership, current custodian/version, same-organization destination,
recipient readiness/receipt evidence and parcel state in one authorized command. Replaying
one intent returns its result after reauthorization; changed payload/stale custody conflicts.
A pending handover offer does not create new read access. Acceptance records actual receipt;
old access ends and destination access starts together. An agent handover after failed
delivery needs the explicit grant, or the receiving franchise admin must perform the
handover with evidence. Operator office intake subsequently records the lifecycle event.

**State commands have narrowly prescribed custody effects** (initial intake by operator,
dispatch by allowed roles, dispatcher assignment and proof-backed completion by agent).
They do not grant a generic custody-transfer capability. In particular, entering transit
or changing a route label cannot move custody to a sibling, assign an arbitrary agent or
substitute for the admin/granted-agent handover command. Initial intake and final verified
recipient handover are intrinsic state effects, not independent transfer privileges.

Cross-organization operational custody is **not authorized in v1**, consistent with ADR
0003. Carrier adapter references do not enroll an external carrier as a tenant/custodian
with access. A future inter-organization custody contract requires reviewed authorization,
privacy and reconciliation decisions before #24/#53 expose it. Parent adoption is a
separate approved ownership migration, not a workaround for this boundary.

## Booking create, edit and cancellation

Operator, dispatcher and franchise_admin may create/edit own-franchise Booking commercial
input subject to validated state and owning domain rules. Recipient/route/price changes
after movement must use the affected parcel/domain's reviewed commands, not a generic
parent edit. Immutable issued tax/receipt/payment facts cannot be rewritten. Detailed
amendment/credit behavior is #8/#21/#22/#29/#30; deny unspecified edits.

The approved operator/dispatcher cancellation capability is a narrowly scoped destructive
grant in the #3 matrix, not general administration. It resolves ADR 0003's deferred D02
action grants while retaining its scope/audit guardrails.

Whole-booking cancellation requires all of the following in one serialized transaction:

1. Current own-franchise membership as operator, dispatcher or franchise_admin; explicit
   intent, non-empty safe reason and expected booking/child versions.
2. Booking active, all children still `booked` or `checked_in`, no child **ever** dispatched,
   in transit, out for delivery or physically moved outside initial intake. Historical
   movement is authoritative even if a later correction changes current status.
3. No concurrent dispatch/movement/assignment can pass the same guards; lock/check the
   complete child set and active route work. Cancel pending unexecuted work atomically.
4. Append Booking cancellation and per-child operational ineligibility references; retain
   child records/timelines/dockets. No `cancelled` Parcel state or destructive deletion.
5. Record any outstanding financial reconciliation obligation without rewriting a ledger
   or claiming a refund. Paid bookings remain subject to the separate payment contract.

Cancelled bookings cannot dispatch or acquire new child work. Repeating the same command
is replay-safe; a different attempted cancellation of an already cancelled booking cannot
produce another effect. Any child movement blocks the whole-booking command (409 after
authorization). Post-movement parcel cancellation/recall is unapproved and denied pending
#24 with #8/#29; use only the approved failure/hold/RTO lifecycle where its preconditions fit.

## Money, docket and time invariants

All monetary values are INR integer **paise**: ₹125.50 = 12,550 paise. Charges, tax
components, declared goods value, obligation, collections and rounding adjustment use
minor-unit semantics; no binary floating-point rupee arithmetic. Exact fractional-paise
tax precision/allocation is #8/#21; this contract does not choose statutory tax rates or
round intermediate GST calculations.

For a nonnegative final customer amount `p` in paise, once all approved calculations are
complete: `rounded_paise = ((p + 50) // 100) * 100`; `rounding_adjustment_paise = rounded_paise - p`.
Thus 12,549 → 12,500 (−49), 12,550 → 12,600 (+50), 12,551 → 12,600 (+49).
Keep the unrounded amount, adjustment and final collectible snapshot so reports reconcile.
Do not re-round each parcel, tax component, installment, resend or payment retry. #29/#30
must define the collection boundary/allocation for partial multi-parcel fulfillment before
implementation; negative credit/refund rounding remains #8/#29, not inferred from this formula.
Delivery state, payment settlement and notification delivery are independent facts.

A docket is globally unique across **all ShipIT organizations/franchises**, permanent,
never reused even after cancellation, and maps to one Parcel. Future #12/#22 choose a
globally safe allocator/sequence or globally partitioned prefix contract and enforce
uniqueness atomically. Client counters and per-tenant constraints cannot satisfy this.
#4 defines normalization/wire format; imports preserve carrier/pre-ShipIT references in
a separate provenance namespace. A foreign docket lookup returns uniform 404. Global
uniqueness never grants visibility, nor permits an availability probe to leak ownership.

All event/audit/creation/deadline instants are stored as UTC. Business dates/reporting use
**Asia/Kolkata**, never browser-local time. Interpret a reporting day as the half-open
interval `[local midnight, next local midnight)` converted to UTC. For example,
2026-09-07 is `[2026-09-06T18:30:00Z, 2026-09-07T18:30:00Z)`. A date-only value is a
business date, not a UTC instant. Preserve source timestamps separately from server
recorded-at where needed; #4 finalizes wire representation. The office collection clock
is specified in the lifecycle contract, with a versioned calendar rather than a 48/72-hour timer.

## Controlled parent adoption

#79 implements this later; #3 defines approvals/conflict boundaries only. Org B/B1 may
request to join Org A without automatic migration or existing national-carrier affiliation.

| Phase | Required evidence / gate | Allowed consequence |
| --- | --- | --- |
| Request | Authenticated B1 franchise approval authority identified; intended receiving Org A | Create scoped migration proposal only; no new directory access |
| Inspect | Frozen/versioned inventory of owned records, historical references, active custody/assignments, memberships, consent, attachments, financial/report snapshots and installed integrations | Dry-run conflict report; minimum redacted summary to receiving approver |
| Resolve conflicts | Imported/legacy docket aliases; pre-ShipIT duplicates; customer duplicates/ownership conflicts; inconsistent parent links, grants, active external references and retention/legal obligations | Record each resolution/evidence; any unresolved conflict blocks approvals/execution |
| Approve | B1 franchise owner/admin **and** authorized Org A receiving representative approve the same conflict-free plan/version | Dual approval only; org_admin has this specifically bounded approval, no ordinary operational write power |
| Revalidate / migrate | Approvals still valid; inventory/conflict scan unchanged; #79 reviewed execution, rollback/reconciliation plan and authoritative ownership history | Controlled migration by dedicated coordinator; no human `organization_id` patch |
| Verify | Counts/relationships/financial snapshots reconcile; old grants revoked/rebound explicitly; new grants audited; audit history retains historical scope | Accept completion only with verification evidence; failure stays incomplete for controlled recovery |

New conflicts or plan changes invalidate prior approvals. Receiving approval alone cannot
expose B1 customer records before completion. ShipIT-native globally unique dockets do
not normally collide; collision examples concern imported/pre-ShipIT aliases. If native
uniqueness is broken, treat it as an integrity incident, not routine adoption matching.
Customer duplication never authorizes automatic cross-franchise merge. #19/#72/#79 own
matching/retention/execution; #79 must decide historical versus current ownership views
and active-movement migration strategy before data moves. No production data moves here.

## Immutable audit contract

Sensitive commands append immutable evidence with business mutation/result/outbox in the
same transaction (ADR 0004). Record actor identity, action, opaque resource ID, UTC
recorded-at, trusted owning and acting organization/franchise, previous/new state or safe
references, expected/committed version, cause/correlation, policy/grant version and a safe
reason code plus required sanitized explanation. Custody adds from/to holder references;
adoption adds both approval actors, plan/version, conflict resolutions and old/new scope.

Required facts: custody transfer/grant/revoke; booking cancellation; RTO approval; delivered
reversal; adoption request/conflict/approval/execution; permission-sensitive destructive
commands. Denials/conflict outcomes need safe security evidence, never a success business
event; #16 owns persistence/retention mechanics. Corrections append new facts and reference
prior facts. No update/delete of history; no OTPs, tokens, verifiers, full addresses,
raw sensitive payloads or unnecessary customer data. Audit reads are scoped too.
