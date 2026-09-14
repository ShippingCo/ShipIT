# Atomic booking creation — Issue #22

The Fastify booking command creates one commercial Booking and 1–50 independently
identified Parcels in one PostgreSQL transaction. It reuses the [customer](customers.md),
[pricing](pricing.md), [tax](issue-21-verification.md), [idempotency](idempotency-contract.md),
[event](event-contract.md), and [audit](audit-contract.md) contracts. Executable acceptance
and rollout evidence is in [Issue #22 verification](issue-22-verification.md).

## Activated authority

Only an authenticated user with a current **operator** membership in the selected
Franchise can create or replay. org_admin, franchise_admin, dispatcher, accountant,
delivery_agent and read_only alone are denied. The Issue #22 action sentence is the
narrower activation policy within W01's broader ceiling. The global authorization
matrix is unchanged; reviewers should confirm this deliberate contract tension.

`withBookingTenantScope` authenticates once, locks the selected Organization after
identity-bound membership discovery, reloads memberships, checks the exact operator
grant, and locks/rechecks the Franchise. Both roots must be active. Seven independent
transaction-bound capabilities cover booking persistence, parcel persistence, customer
snapshot read, pricing validation, tax validation, audit, and events. Neither the raw
executor nor issuer reaches domain consumers. Capabilities expire at transaction end.
The existing Organization lock also serializes membership, customer and configuration
commands. This is deliberately conservative; it is not a throughput qualification.
Every private query uses both ownership predicates. Unknown and foreign customer IDs
produce identical 404 envelopes; guessed selectors cannot widen scope. ADR 0013's
existing compromised-runtime-credential limitation remains: this is not PostgreSQL RLS.

## Ratified v1 API

```text
POST /api/v1/bookings?organization_id=<uuid>&franchise_id=<uuid>
Idempotency-Key: <1–255 ASCII letters/digits/hyphen/underscore>
Content-Type: application/json
```

Normal session cookie, Origin, CSRF, no-store, safe correlation/error and request-size
limits apply. Query selectors narrow live membership; ownership is never in the body.
Exactly one key header is required; duplicates, commas, whitespace and missing/invalid
keys fail validation. Raw keys are neither returned nor logged nor persisted.

```json
{
  "customer_id": "00000000-0000-4000-8000-000000000101",
  "expected_customer_version": 1,
  "tax_calculation_id": "00000000-0000-4000-8000-000000000401",
  "tax_intent": {
    "quote_id": "00000000-0000-4000-8000-000000000301",
    "pricing_input": {"destination_key":"SYN_DEST","service":"standard","weight_grams":999},
    "facts": {
      "service_recipient_ref":"SYN_BUYER", "registration":"unregistered",
      "recipient_state":null, "recipient_gstin":null, "handover_state":"27",
      "evidence_ref":"SYN_HANDOVER", "special_case":"none"
    }
  },
  "parcels": [{
    "weight_grams":999,
    "recipient":{"name":"Synthetic Recipient","phone":"+1 202-555-0101","address":"21 Fictional Street"}
  }]
}
```

IDs above are fictional shape examples; use actual fixture-created IDs for execution.
All objects reject unknown fields. Customer version is 1..2147483647. Each weight is
an integer 1..9007199254740991 grams; the BigInt sum must equal the whole-booking
quote's exact weight and fit its safe integer range. No dimensional-weight inference.
One destination/service applies to the quoted Booking; multiple quotes or independently
classified freight groups remain outside the accepted tax port. Recipient fields reuse
Customer contact validation (trimmed 1–120 code-point name, explicit international phone
up to 40 input characters, address up to 500 code points). Omitted address means empty;
omitted docket means automatic allocation. Explicit docket null is invalid. No other
default is invented. Sender is the authorized Customer snapshot on each Parcel; recipients
are independent shipment snapshots and never directory records. Service-recipient tax
facts remain distinct from sender, consignee and payer; no automatic jurisdiction inference.

`lot_id` is unknown at every level, including a valid foreign fixture UUID. No lot can
be attached during creation. [Issue #26 lot commands](lots.md) attach confirmed Parcels
through separate scoped/versioned membership transactions. Their destination is this
Booking's frozen tax_intent.pricing_input.destination_key; this does not change booking intent. `payment_mode`, `paid`, `settled`, collected amounts, client ownership/status,
versions, totals, tax components, confirmation time, audit and event metadata are rejected.
The existing JSON parser also rejects duplicate keys and inaccurate numeric lexemes.

HTTP **201** returns `BookingDto` from `apps/api/src/modules/bookings/types.ts`:

- `id`, `version:1`, `state:active`, authorized organization/franchise IDs and `event_id`.
- `customer`: source customer ID/version and frozen required contact fields.
- `charges`: authoritative pricing evidence, tax evidence and `confirmed_at`.
- `payment_obligation`: opaque ID, INR, total, zero collected, full outstanding, uncollected.
- Ordered `parcels`: identity, version 1, booked status, awaiting_intake custody, canonical
  docket, grams, sender/recipient snapshots and each parcel.booked event ID. Recipient
  projection uses name, phone_normalized, phone_display and address.

The mapper allowlists nested fields on initial response and replay. No command key/digest,
canonical intent fingerprint, tax intent/GSTINs, database rows or full event envelopes are
public. Pricing/tax provenance and calculated amounts are the existing authorized operator
projections; the pricing quote remains identified as original proposal evidence within the
confirmed charge snapshot. No private retrieval/search endpoint is introduced (#23).

## Snapshot confirmation and obligation

The Customer port takes a customer.snapshot.read capability and SELECT FOR SHARE until commit;
source ID/version and scalar values are persisted, with a composite same-owner FK. Later
Customer edits cannot change Booking/Parcel snapshots. No historical live Customer join.

`validatePricingSnapshot` reloads the actor-bound quote and exact expected commercial input;
`validateTaxSnapshot` reloads the tax calculation and exact expected tax intent, current
policy, rule, jurisdiction/resolution and fingerprints. Their existing engines are reused.
Both locks and the coordinator's authorization/configuration locks survive snapshot insertion.
Stale/expired proposals produce QUOTE_STALE/TAX_STALE; unknown jurisdiction remains denied.
Above-tolerance proposals additionally require the independent current W43 authority: an
operator must also hold an explicit own-franchise franchise_admin membership. The coordinator
then issues pricing.override.approve instead of pricing.validate. Revoking that additional
authority denies privileged-result replay; franchise_admin alone still cannot create Bookings.

Production confirmation time is a single millisecond-truncated PostgreSQL clock_timestamp
read inside the reserved command transaction after authority/lifecycle locks. The opaque
command UUID is the internal evidence reference. The caller supplies trusted-contemporaneous-records,
serviceAt=invoiceAt=that instant, paymentAt=null to the tax port. None is browser input.
The injected server clock exists solely as the established synthetic test seam. This timing
boundary does not issue a statutory invoice. Historical timing/prior payment/special tax
cases remain outside Issue #21's supported contemporaneous selector.

Storage freezes the full original quote/calculation, tax intent, source IDs and version/rule/
policy provenance, jurisdiction facts, freight/packing, basis, CGST/SGST/IGST, tax total,
unrounded payable, final rounding adjustment, final payable and component allocation/evidence.
Confirmation time and command reference accompany them. Reporting/receipts consume saved
facts; they must not call expiry-sensitive validation or recompute history after policy edits.

The initial `booking_obligations` row is immutable, bound by FK to the Booking's exact final
payable. Integer INR paise, collected=0, outstanding=total, state=uncollected; zero-value
bookings also record no collection. Constraints enforce collected+outstanding=total. No
second rounding, ledger entry, settlement, collection method, customer receipt or payment
provider acceptance. #29 must add its owned append-only collection/reconciliation model
and explicit authorization/migration while retaining this original obligation snapshot.

## Global permanent dockets

The database trigger uses one non-cycling bigint sequence across all Organizations and
Franchises. Generated layout: `SIT-` plus exactly 19 zero-padded decimal digits (23 ASCII
characters). Example: `SIT-0000000000000000001`. Prefix and number confer no tenant authority.
Sequence allocation is not transactional: gaps survive rollback and are never recycled.
Runtime cannot read/reset/advance the sequence directly; only the fixed-path allocator
trigger advances it. Sequence exhaustion fails closed pending reviewed migration.

Optional manual docket: trim leading/trailing ASCII space/tab, uppercase ASCII a–z,
then require 1–32 ASCII letters/digits/internal hyphens. Empty, edge hyphens, punctuation,
internal spaces, Unicode and overlength values fail. No lookalike folding or stripping.
All rows share unconditional **UNIQUE(docket)**. A collision returns safe 409 DOCKET_CONFLICT
and rolls back the entire Booking. It discloses no existing owner/customer. Manual values
matching the generated layout at/below an allocated sequence watermark are also rejected,
preventing reuse of rollback gaps. Future generated-layout values are allowed manually;
if the sequence later reaches one, the same global constraint rejects the command, consumes
that sequence value, and same-key retry may allocate the next value. No namespace bypass.

## Idempotency, atomicity and durability

Identity is `(user, principal_id, organization_id, acting_franchise_id,
api.v1.bookings.create, SHA256(key))`. INSERT ON CONFLICT on this unconditional unique
identity reserves the command; competing requests wait on PostgreSQL. SELECT FOR UPDATE
then resolves the committed original result or intent conflict. The existing Organization
lock further serializes same-Organization commands across processes. Lock/dependency
failure may return 503; it does not prove rollback and must retain the key/body.

Canonical v1 uses Issue #20's recursive lexical object sorting/SHA-256. All schema keys
are ASCII, numbers are safe integers and contact strings reject lone surrogates, satisfying
the Issue #4 canonical domain. Fingerprint contains operation, empty resource_ids/query,
normalized JSON media type and every validated/default-expanded input. Ordered children,
normalized manual dockets, recipient contact, source precondition and tax/pricing intent all
matter. Generated identities/dockets/times, correlation and key transport are excluded.

Same authorized key/body returns original 201 DTO, even after proposal expiry or Customer
edits; different body gives 409 IDEMPOTENCY_CONFLICT without effects. Current identity,
operator action, scope, active roots and complete DTO visibility are checked before replay.
Revocation denies the whole result. Replay creates no audit or event. Lost HTTP/COMMIT
acknowledgement reconciles through this same POST and persists across new service/pool instances.

Receipts are bounded to 512 KiB, accommodating all 50 maximum-length shipment contacts.
Receipts record opaque command ID, digest, fingerprint/version, state, original status/DTO,
Booking reference, correlation, commit and retain_until at least 24 hours later. No cleanup
or expiry-based key reuse is implemented, so retained receipts continue replaying. If evidence
is later lost/pruned or an expired uncertain command cannot be reconciled, stop automatic
resubmission; authorized support must inspect scoped retained commercial records. #23 owns
general ID/docket retrieval. There is no public raw-key lookup or promise to reconstruct
an absent receipt from a fingerprint. Never create a new key merely after timeout/500/503.

The one forward migration enforces owner tuples, permanent identities/snapshots, child count,
source evidence, obligation arithmetic, command completion, and event/actor/payload consistency.
A deferred command trigger requires the complete Booking, all ordered children, one obligation,
one successful audit and all events at commit. Reserved/incomplete commands cannot commit.
Committed children/events cannot be appended later. Changes to these v1 guards belong to
future owning forward migrations; runtime has no delete/truncate/DDL/history-update access.

## Events, audit and downstream handoffs

Exactly one booking.created and one parcel.booked per child, schema 1, persist in domain_events
with the original required envelope. Booking payload is only parcel_set_ref (the immutable
Booking child set); Parcel payload is only booking_id. Logical unique keys forbid duplicates.
No PII, raw key, tax internals or request payload enters events. One reference-only
bookings.create audit fact uses append_booking_audit and audit_history's booking:UUID namespace,
committed version 1, actor, scope, command, time and correlation. Replay adds none. Denials
use existing identity-only evidence with null guessed scope/target and safe telemetry.

#23 owns lookup/search/timeline; #24 lifecycle/custody and future mutable Parcel versions;
#26 lots/membership; #29 collection/reconciliation; #30 issued receipts; #33 production UI;
#35 relay/worker. No WhatsApp/provider call, queued/sent/delivered claim, receipt issue,
settled payment, intake, dispatch, lot implementation, frontend migration or worker is added.
Prototype addBooking still belongs exclusively to the fictional demo: browser sequence,
client tax/paid state, lot attachment and simulated WhatsApp/receipt effects are not reused.

## Tenant-isolated retrieval — Issue #23

The ratified #4 resource contract takes precedence over the older issue-body route sketch:
retrieval is `GET /api/v1/parcels`, `GET /api/v1/parcels/{parcel_id}`, and
`GET /api/v1/parcels/{parcel_id}/timeline`. Detail selectors are UUIDs; exact docket lookup
is a list filter. Every request requires `organization_id`; optional `franchise_id` can only
narrow the caller's current live grants. org_admin, franchise_admin, operator, dispatcher and
read_only receive their R06/R07 read ceiling. Accountant is denied. Delivery-agent assignment
is not yet persisted, so its conditional grant fails closed rather than widening visibility.

List filters are exact normalized `docket`, closed `status`, `customer_id`, and a half-open
`from`/`to` confirmed-at interval. Sort is allowlisted to `created_at_desc` (default),
`created_at_asc`, `docket_asc`, or `docket_desc`; `limit` defaults to 50 and is bounded at
100. The result is exactly `{items,page}` without a total count. Keyset order always appends
Parcel UUID as a deterministic tie-breaker. Opaque, authenticated, encrypted cursors expire
after 15 minutes and bind actor, Organization, permitted Franchise set, live membership
revision, normalized filters, sort, and schema version. A cursor is continuation state, never
authorization; every page reauthenticates before decoding or querying.

Detail and timeline queries constrain both Organization and Franchise before ID matching.
Foreign-but-valid and unknown UUIDs therefore return the identical safe 404. Public Parcel
DTOs explicitly allowlist current shipment fields and frozen party contact snapshots; they
omit tenant IDs, command/replay records, pricing/tax evidence and event envelopes. Timeline
projects only ratified lifecycle event names to safe code/status/label entries and orders by
`(occurred_at, aggregate_sequence, event_id)`, making equal-time history deterministic.

Migration `1789664400000-booking-retrieval.cjs` backfills first-class event time/sequence from
the immutable envelope, checks the two representations agree, and retains a compatibility
insert trigger for rolling deployment of the #22 writer. Owner-first indexes support docket,
status/booking, created-time, customer/time and Parcel timeline access. Exact index/query
review and executable acceptance evidence are recorded in
[Issue #23 verification](issue-23-verification.md).

## Guarded Parcel lifecycle — Issue #24

Typed lifecycle commands mutate the #22 Parcel aggregate one optimistic version at a time
and append facts consumed by the #23 timeline. Check-in, dispatch and transit establish the
approved office/route custody progression. Failed-attempt consumes only a pre-existing
trusted active delivery attempt assigned to the authenticated agent; this issue does not
create assignments, OTP challenges, out-for-delivery state or delivery completion.

The command receipt, aggregate update, transition, event and typed exception evidence share
one PostgreSQL transaction. Replay is durable and scoped to principal, tenant, operation and
key. RTO means an approved return workflow started, not physical return completion or a
financial reversal. Full API, policy and rollout details are in
[ADR 0014](../adr/0014-guarded-parcel-lifecycle-commands.md) and
[Issue #24 verification](issue-24-verification.md).
