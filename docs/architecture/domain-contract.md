# Canonical domain and ownership contract

[Architecture index](README.md) · [ADR 0006](../adr/0006-domain-ownership-and-authorization.md) · [Authorization](authorization-contract.md) · [Lifecycle](parcel-lifecycle.md) · [Examples](domain-scenarios.md)

Contract version: Issue #3 / v1, with the bounded Issue #12 tenancy implementation and
[ADR 0010 amendment](../adr/0010-organization-franchise-tenancy.md) below. Other domains
remain requirements for later production work. The approved owner decisions take
precedence over Issue #3's original one-parcel suggestion and the browser record shape.

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

## Organization and Franchise persistence — Issue 12

The same two roots represent a standalone shop (one Organization + one Franchise) and
a multi-location business (one Organization + multiple Franchises). Neither requires
national-carrier enrollment, a parent-company account or a separate tenant type.
Internal bootstrap creates the Organization and initial Franchise atomically; a
failure before commit rolls both back. It creates no User or Membership. An internal Organization
creation primitive may exist for trusted composition, but active business onboarding
must create its initial Franchise in the same transaction; #17 owns the future
authenticated identity/membership/idempotency coordinator.

| Root | Persisted fields | Constraints |
| --- | --- | --- |
| Organization | `id`, `display_name`, `lifecycle`, `version`, `created_at`, `updated_at`, `lifecycle_changed_at` | UUID primary key; nonempty trimmed display name up to 120 Unicode code points without ASCII controls; lifecycle `active` or `disabled`; positive PostgreSQL integer version; UTC instants |
| Franchise | `id`, `organization_id`, `franchise_code`, `display_name`, `lifecycle`, `version`, `created_at`, `updated_at`, `lifecycle_changed_at` | UUID primary key; required Organization FK; same profile/lifecycle/version/instant rules; organization-scoped stable code and composite ownership candidate key |

IDs are opaque UUIDs generated by the trusted server implementation; names, telephone
numbers, carrier identifiers and client counters are not tenant identity. The minimal
roots contain no customer/staff personal details, tax/pricing/settings JSON, credentials
or subscription data. Lifecycle initially is `active`, version initially is 1, and all
three timestamps initially refer to creation. Every actual mutation increments version
once and updates `updated_at`; lifecycle changes also update `lifecycle_changed_at`.
The PostgreSQL `integer` storage ceiling is 2147483647, within the public API's safe-
integer range. Issue #12 commands accept `expected_version` in 1..2147483646 so one
increment cannot overflow; a root at the storage ceiling remains readable, while
further mutation/no-op commands fail validation pending a reviewed forward widening.

`franchise_code` must already match the exact ASCII expression `[A-Z][A-Z0-9_]{0,31}`
(1–32 characters). There is **no normalization**: lowercase, surrounding whitespace,
hyphens and Unicode lookalikes are rejected, never silently rewritten. API/service and
PostgreSQL enforce the same accepted language. `MAIN` may exist in unrelated
organizations, but `UNIQUE (organization_id, franchise_code)` makes concurrent duplicate
creation within one organization a controlled `FRANCHISE_CODE_CONFLICT`. Display names
are not unique business keys. Code and opaque identity remain stable through ordinary
profile/lifecycle administration.

PostgreSQL enforces `franchises.organization_id → organizations.id`, and
`UNIQUE (organization_id, id)` on Franchises is the reusable candidate key for later
private records:

```sql
FOREIGN KEY (organization_id, franchise_id)
  REFERENCES franchises (organization_id, id)
```

Future owners must use this relationship to reject mixed ownership pairs at the DB
boundary. Issue #12 proves Alpha/Beta mismatches with a disposable test-only child
table; it does not add a production Booking, Customer or other child table. The scoped
code index supports equality lookup, the ownership candidate key supports relationship
proof/detail access, and `(organization_id, created_at, id)` supports scoped keyset
listing. The organization-leading indexes also cover the Organization → Franchise path.

Ordinary commands cannot change `id`, `organization_id`, `franchise_code` or `created_at`.
Command schemas reject unknown/ownership fields, services use explicit validated
commands, and repository update signatures/SQL exclude immutable columns. The existing
separate runtime DB identity has SELECT/INSERT plus explicit mutable-column UPDATE
privileges, never tenant-root DELETE/TRUNCATE or table-wide UPDATE. It owns no schema,
cannot perform DDL and cannot reparent even with direct SQL. The migration/owner
identity stays separate; no grant uses a generated runtime-role name baked into the
migration. Issue #79 must review any future ownership migration; Issue #12 supplies no
adoption, transfer or hidden reparent capability.

### Lifecycle and operational write linearization

The complete tenant-root lifecycle is `active` / `disabled`. Disabling preserves the
root row, ownership, IDs and all history. R01/R02 safe reads and permitted listing include
disabled roots under current authorization; disable never grants or retains a revoked
membership. No ordinary hard-delete endpoint exists. Organization profile/lifecycle
administration remains an internal capability; staff franchise lifecycle changes require
the explicit W41 action and its documented transitions/reasons. W29 changes only the
franchise profile display name, not lifecycle or ownership.

The reusable active-franchise operational-write guard accepts trusted Organization +
Franchise scope and the **same DB transaction** that will perform the operational write.
It proves the relationship in SQL and locks the organization before the franchise,
checks both are active, and keeps conflicting lifecycle mutation blocked until the
write transaction ends. Lifecycle administration uses a compatible lock order. A write
serialized first can complete before disable; successful disable linearizes at its
transaction commit. Once disable commits, a newly started operational-write guard fails
with `ORGANIZATION_DISABLED` or `FRANCHISE_DISABLED`, as applicable. An active sibling,
a submitted `active` value or a different Organization selector cannot substitute for
the authorized target.

The guard is an integration primitive for later owning services, not proof that every
future Booking/Parcel/Payment write already calls it. Reactivation changes only the
root lifecycle and version under the same concurrency rules. An organization remaining
disabled still blocks operational writes even if one franchise is reactivated. Explicit
franchise lifecycle recovery is permitted even while its Organization is disabled;
Organization recovery requires internal service authority. Profile updates require the
target root, and its parent for a Franchise, to be active. Recovery does not bypass a
business operation's active-write guard.

### Scoped services and safe results

The trusted authorization seam supplies approved action, actor reference, Organization
and permitted Franchise scope. Normal production HTTP composition exposes no private
tenancy routes before #13/#14. Repositories take scope explicitly and put it in SQL;
they never read all tenants and filter afterwards. List scope applies before the page
boundary, `limit + 1`, `has_more` or any count. The bounded internal keyset is
`created_at ASC, id ASC`, with 50 default / 100 maximum rows; immutable ID breaks
timestamp ties. Disabled roots participate in the same authorized ordering. No public
cursor encoding, replay persistence or unscoped organization directory is introduced;
#9/#23 own public cursor integrity and #17 owns public onboarding replay guarantees.

Database rows, domain results, allowlisted safe profile DTOs and audit facts are distinct
types/mappings. New private DB columns cannot automatically enter a DTO. Historical
and current results retain R01/R02 projection restrictions. Foreign, sibling-without-
grant and unknown IDs share the private 404 behavior; conflicts are disclosed only
after visibility/action authorization. SQL/constraint details and submitted hostile
values never enter public errors or logs. Committed administrative changes call the
typed audit seam with safe references, versions, reason and UTC time; failed validation,
authorization, version or rolled-back transaction execution cannot create a successful
change fact. This is a **post-commit notification**: adapter failure can return a controlled
503 after the mutation committed, and a crash between commit and notification can lose
the fact. There is no durable delivery or retry/replay promise. Durable transactional
append-only audit persistence remains #16 and is required before private production
routes activate; ADR 0004's integration obligation remains intact.

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
