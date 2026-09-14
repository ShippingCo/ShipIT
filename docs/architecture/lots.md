# Persistent lots and safe parcel membership — Issue #26

Lots owns operational grouping, not custody or Parcel lifecycle. Every Lot and membership
belongs to exactly one trusted Organization/Franchise tuple. [ADR 0016](../adr/0016-persistent-lots.md)
refines R08/W04 and extends the existing domain event producer. No new role, ORM or RLS.

## Identity, lifecycle and destination

A Lot has UUID id, owner tuple, server code, required name, canonical destination_key,
active/archived state, positive integer version, created/updated/archived timestamps and
last command reference. Codes are `LOT-` plus 19 decimal digits, allocated transactionally
by a protected per-owner counter. Partial UNIQUE(organization_id,franchise_id,code) WHERE
state='active' enforces the required scope; the allocator never intentionally reuses a code.
Clients cannot set codes, ownership, state, actor, timestamps or command/event fields.
Name uses the existing trimmed 1–120 code-point label rule. Destination keys use Pricing's
exact ASCII `[A-Z][A-Z0-9_]{0,31}` representation, without normalization. Creation requires
that key in a published pricing rule in the selected scope (including retained expired
versions). No new destination directory is invented. A parcel's destination is its frozen
Booking tax_intent.pricing_input.destination_key, already validated against the quote at
booking confirmation. Equality is exact. Neither addresses nor prototype city labels count.
Code and destination are immutable; metadata update changes only name. Correct a wrong
empty Lot by archiving it and creating the right destination Lot.

## Membership and state policy

Membership rows retain UUID, organization/franchise, booking/parcel/lot references,
started_at, start_command_id and nullable ended_at/end_command_id/end_reason. Ending is
one-way; the original association cannot be edited or deleted. Partial UNIQUE on
(organization_id,franchise_id,parcel_id) WHERE ended_at IS NULL guarantees at most one
active association. Composite FKs bind both Lot and Parcel (including Booking) to the
same owners. A parcel with no open row is ungrouped. Grouping never changes Parcel status,
custody, delivery attempt counters or Parcel version.

| Operation | franchise_admin / operator | dispatcher |
| --- | --- | --- |
| Create / rename active lot | Local W04 | Local W04 |
| Add/move booked or checked_in parcel; both lots have only pre-dispatch history | Allowed | Allowed |
| Add/move dispatched, in_transit, out_for_delivery, failed_attempt, held_at_office | Denied | Allowed |
| Add/move delivered or rto | Denied | Denied |
| Remove pre-dispatch parcel from pre-dispatch lot | Allowed; becomes ungrouped | Allowed |
| Remove post-dispatch/terminal parcel, or change membership of a lot with post-dispatch history | Denied | Allowed; grouping correction only |
| Archive lot with only pre-dispatch history | Allowed | Allowed |
| Archive lot with any post-dispatch history | Denied | Allowed |

A lot is conservatively considered operationally locked if any historical/current member
has progressed beyond booked/checked_in; membership history keeps this guard after removal.
There is no invented locked/dispatched Lot state or physical transfer. R08 reads permit
org_admin within its Organization, and franchise_admin/operator/dispatcher/read_only within
explicit F grants. All requests select one franchise. Accountant is denied. Delivery-agent
A-only lot-label access awaits the owning assignment projection; it grants no broad R08.
org_admin has no W04. No role inheritance. Each replay rechecks current session, selected
owners, W04 and any dispatcher restriction recorded with the original command; it does
not rerun already-satisfied versions/states. Both roots must be active for commands/replay.

## API and optimistic concurrency

All paths use `/api/v1`, current session, no-store, and required organization_id/franchise_id
query selectors that only narrow live grants. Mutations also require CSRF/Origin and exactly
one canonical Idempotency-Key. Strict inputs reject unknown fields.

| Method/path | Input / operation |
| --- | --- |
| POST /lots | name, destination_key; api.v1.lots.create; 201 |
| GET /lots | optional state (active/archived), destination_key, limit, cursor; 200 |
| GET /lots/:lot_id | 200 LotDto |
| PATCH /lots/:lot_id | expected_version, name; api.v1.lots.update; 200 |
| POST /lots/:lot_id/archive | expected_version; api.v1.lots.archive; 200 |
| GET /lots/:lot_id/memberships | optional state (active/ended), limit, cursor; 200 |
| GET /parcels/:parcel_id/lot-membership | active MembershipDto or null; 200 |
| POST /lots/:lot_id/parcels | parcel_id, expected_version; api.v1.lots.membership.add; 200 |
| POST /lots/:lot_id/parcels/:parcel_id/move | membership_id, target_lot_id, expected_version, expected_target_version; api.v1.lots.membership.move; 200 |
| POST /lots/:lot_id/parcels/:parcel_id/remove | membership_id, expected_version; api.v1.lots.membership.remove; 200 |

Expected versions range 1..2147483646; stored versions 1..2147483647. Each affected lot
advances once. Move checks both lot revisions and exact active membership ID atomically;
remove checks its source revision and membership ID. Add requires no active membership.
Membership IDs protect against stale remove/move after replacement; Parcel lifecycle
versions are never overloaded. Archive closes all open associations with reason archived,
advances the lot once and preserves every row. Archived lots reject new membership and
metadata changes. Repeated deliberate archive with a new key conflicts; exact replay returns
its original result/time. No DELETE route, reactivation or destructive cascade.

LotDto: id, code, name, destination_key, state, version, created_at, updated_at,
archived_at, active_member_count. MembershipDto: id, lot_id, parcel_id, started_at,
ended_at, end_reason. No customer/contact/docket, internal command or actor fields.
Mutation result: {lots: LotDto[], membership: MembershipDto|null}; lots are ordered by UUID.
Create/update/archive return LotDto. Reads project explicit columns. Lists return only
items/page, limit 1–100 (default 50), created/start time DESC then UUID DESC, encrypted
15-minute cursors bound to actor/live membership revision/scope/filter/limit/resource.
No totals or cross-scope selectors. Current membership lookup authorizes Parcel first.

## Transactions, replay, events and audit

Existing membership coordinator locks serialize organization commands. The lot coordinator
also locks the active franchise; affected lots lock in UUID order, then the parcel. All
queries use transaction-bound TenantAccess/assertTenantAccess/scopedQuery. DB uniqueness
is the independent final race invariant; reviewed conflicts translate only after normal
rollback. Command lock timeouts give IDEMPOTENCY_IN_PROGRESS after rollback; read timeouts and transport/commit uncertainty give
503 and must retain the exact intent. New stale mutations give VERSION_CONFLICT.

Command identity: user, principal, trusted owners, operation ID, SHA256(key). Canonical v1
fingerprint reuses Pricing's recursive normalized object hashing and includes all IDs,
versions and validated body fields. No raw key is stored/logged. Command reservation,
state, membership close/open, lot versions, audit, domain events and original result commit
together. Deferred completeness checks reject incomplete/reserved commands. Retention is
at least 24 hours; this implementation prunes no receipts or evidence. Same authorized
key/intent returns original DTO; changed intent returns IDEMPOTENCY_CONFLICT. After missing
replay evidence, stop automatic resubmission and reconcile scoped reads/support.

Five schema-1 facts extend the closed aggregate set with lot: lot.created, lot.updated,
lot.archived, lot.parcel_added, lot.parcel_removed. A move emits removal on source and
addition on target, one per exact aggregate revision, shared command/cause/correlation.
Safe membership payload identifies parcel, membership and optional counterpart lot only;
metadata events have empty payload. Archive has one lot fact; ended membership rows are
its detailed evidence, not extra per-parcel lifecycle events. Events use the existing
shipit.domain_events with additive lot/source FKs; all old booking/parcel constraints and
producer behavior remain enforced. Future projections/timeline (#27/#34/#35) consume under
their own authority; no messaging subscriber or provider effect is activated.

lot_audit_events is an immutable source in canonical audit_history (lot:UUID), one fact
per lot revision, appended through a fixed-path SECURITY DEFINER function with EXECUTE-only
runtime permission. It records references, closed action/reason, actor/correlation/time/version;
no names, destination, free text, body, key or PII. Independent lots.audit/lots.events
capabilities are issued only inside an authorized command. R28 scope/roles remain unchanged.

## Safe failures and UI consumer contract

Foreign/unknown IDs, including nested IDs, use identical RESOURCE_NOT_FOUND before private
state checks; no unscoped discovery. Existing 400/401/403/404/422/409/503 apply. New safe
conflicts: LOT_STATE_CONFLICT, LOT_MEMBERSHIP_CONFLICT, LOT_CODE_CONFLICT and
LOT_DESTINATION_MISMATCH. Mismatch says: “Parcel destination does not match this lot. Choose
or create a lot for the parcel's destination.” It echoes no submitted/private values.
Mismatch leaves source association, versions, receipt and success events/audit unchanged.

#34 must retain safe draft/selection, announce/focus the corrective error, never claim a
move, offer a matching lot or correct-lot creation, and require deliberate changed intent
with a new key when target/version changes. Uncertain retry retains exact key/body/path.
Use #18's one API client → purpose adapter → scope controller → component; purge/abort on
scope change, discard stale responses, and never optimistic-write server state or persist
mutation recovery in browser storage. No browser adapter or screen cutover is needed here.
The fictional LotsPage may retain “elsewhere” selection and destructive demo deletion;
production intentionally rejects incompatible destinations and archives operational history.

## Downstream and deployment boundary

#24's T03 opaque manifest evidence remains intact; #27 owns validated persistent routes,
frozen manifests, active-route guards and integration with this membership authority. No
production route relation exists on starting main, so no invented active-route table/guard.
Archive preserves lot identity, historical associations and Parcel dispatch/timeline facts.
#27 must reference retained identities with composite ownership and RESTRICT, snapshot the
manifest membership/revisions and never reinterpret historical routes from current grouping.
#34 owns the full operational screen migration. No WhatsApp, carrier, proof, payment or UI.

Rollout: apply forward migration and explicit minimum grants; verify old producers; deploy
API; run synthetic A/B/C create/move/remove/dispatch/archive/replay; leave UI cutover to #34.
Rollback reverts compatible API, retains additive schema and all history, and repairs schema
with a new forward migration. Never delete evidence, import browser JSON or fall back to demo.
[Verification](issue-26-verification.md) records actual checks and acceptance evidence.

## Issue #27 active Route amendment

Issue #27 implements the previously deferred Route relationship. Open Route/Lot sources on planning Routes block Lot grouping add/move/remove and archive for all roles, through the owning service plus SQL triggers. Rename remains allowed. Detach, Route archive or finalization releases the guard. Route manifests snapshot exact retained Lot membership IDs and never reinterpret history from later grouping. Old T03 evidence remains intact; new T03 requires authoritative finalized manifest membership. [Routes](routes.md).
