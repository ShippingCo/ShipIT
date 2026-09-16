# ADR 0019: Payment ledger, settlement and financial corrections

Status: implemented for independent review in Issue #29; acceptance on reviewed merge.
Date: 2026-09-16. Refines ADRs 0006, 0007, 0009 and 0013.

## Authority and reconciliation

Starting main is `9d6b27381a42c7c0edc4491d0cf2508e7b54d98b`. Issues #8/#15/#16/#22
are closed with merged prerequisites. Issue #29's historical “accountant/manager” reversal
scenario conflicts with the accepted W20/W21 matrix. The #29 implementation policy
explicitly preserves that matrix: **franchise_admin F alone** may collect or reverse.
Accountant retains financial read/export authority; org_admin has declared financial
organization reads, without mutation inheritance. Operator, dispatcher, delivery_agent,
accountant and read_only cannot collect or reverse. No manager role exists or is added.
W20 expansion was considered and rejected: there is no merged cashier/agent grant.
Future expansion requires an explicit reviewed authorization change.

## Decision

1. The immutable #22 `booking_obligations` row remains historical opening evidence,
   including its original uncollected state and zero collected amount. Its total is
   the Booking's frozen tax-inclusive `final_payable_paise`; no released migration changes.
2. `payment_entries` appends positive collection/reversal facts. No historical update,
   deletion, mutable paid flag or cached balance is an authority. A scoped sum derives
   collected and outstanding. PostgreSQL numeric sums and TypeScript BigInt preserve
   exact paise; JSON integers stay within 0..9007199254740991.
3. The obligation remains **Booking-level** for every child count. Partial collections
   are enabled, including odd paise. No installment rounding, Parcel freight/tax allocation,
   Parcel paid boolean, or inference from partial physical fulfillment exists.
4. Manual methods are exactly `cash` and `upi`. UPI here is operator-recorded evidence,
   not gateway verification or execution. Context is independently `paid_counter` or
   `to_pay`. Neither context pre-settles money. Reference is a caller-retained opaque UUID,
   not a bank account, UPI address, card detail, provider token or free-text note.
5. Reversals are positive, reference one same-obligation collection, and carry one required
   code: `duplicate_recording`, `incorrect_amount`, `collection_not_received`. Partial and
   full reversals are allowed up to the still-unreversed original amount. Method/context
   inherit the original. The original remains intact. No arbitrary negative credit,
   negative collection, unlinked refund, below-zero net, or above-gross outstanding exists.
6. A PostgreSQL transaction reauthenticates live membership, locks Organization/Franchise
   using the existing coordinator, then locks the scoped opening obligation `FOR UPDATE`.
   Read sums, validate, reserve receipt, append entry/audit/event, finish receipt and commit
   under that lock. Database entry guards independently lock/check the same obligation.
   Existing organization serialization is retained; no in-memory mutex or throughput
   qualification is claimed. Composite FKs, reference/sequence/key uniqueness and deferred
   completeness checks provide defense in depth.
7. Existing canonical v1 fingerprint and scoped key-digest architecture is reused.
   Operation IDs are `api.v1.payments.collect` and `api.v1.payments.reverse`. Intent includes
   resolved Booking/obligation, reversal target and every strict normalized body field.
   Same key/intent returns the original result after live authorization; changed intent
   conflicts. One collection reference is unique within Organization/Franchise, across
   actors/keys/Bookings. Exact reference replay returns the original result; different
   financial intent conflicts. A new replay key gets an immutable alias receipt bound to
   that original effect, never a second ledger/audit/event. Reference reuse cannot silently
   rebind a key. Reversal deduplication uses its command identity and remaining-target cap.
8. Receipts have infinite pilot retention with no pruning/rebinding path. This is a
   conservative replay support choice, not a legal retention ruling. #72 must coordinate
   any future retention change with ledger/reconciliation evidence. COMMIT uncertainty
   returns 503; retain the same body/path/key and reconcile through the same POST after
   restart. A separate authorized GET returns the current projection and entry reference.
9. Every entry allocates the next obligation sequence, initially 1. Opening projection
   version is 0. A collection causing outstanding to move from positive to exactly zero
   emits `payment.settled`, producer Payments, aggregate `payment_obligation`, schema 1.
   Payload remains exactly `booking_id` and `settlement_ref` (the immutable collection ID).
   Partial collections and reversals allocate revisions without settlement events.
   Collection → reversal → recollection may legitimately settle at revisions 1 and 3;
   uniqueness is obligation/revision and command, not one event for the obligation forever.
   Replay emits none. The existing catalog already permits non-emitting revisions, so no
   new event type or payload version is required. A zero-gross opening projects settled
   at version 0 but has no collection or `payment.settled` event; positive collection is denied.
10. Financial reversal can reopen outstanding. It never reverses physical delivery or
    executes an external refund. Conversely, delivery reversal creates only its owning
    reconciliation work and never automatically reverses payment. No circular domain writes.
11. Canonical append-only audit gains a financial producer with entry/command/obligation,
    actor, tenant, revision, reason, correlation and time. Accountant audit queries include
    only financial facts within its grants; administrative scopes remain independently
    constrained. Audit/event/ledger/receipt must all agree at commit or all roll back.
12. #30/#61/#63 consume the immutable opening and scoped ledger projection, reconcile
    sums, and use revisions/entry references. Issued receipt corrections and reporting
    implementation remain downstream; settlement never silently reissues a receipt.

## Migration, rollback and alternatives

Add `1790182800000-payment-ledger.cjs`, scoped runtime grants and compatible readers before
API deployment. There is no backfill or fake historical collection. Tests cover a fresh
schema, a populated #28 schema containing #22 Bookings, failed migration rollback, unchanged
opening IDs/totals and repeat no-op. Column UPDATE(id) on the opening obligation is required
by PostgreSQL for `FOR UPDATE`; its existing immutable trigger rejects every actual update,
including id=id. The released guard is unchanged. A narrow definer function handles audit;
no PUBLIC execute, application ownership or base-audit write grant is added.

Rollback disables/reverts payment API code while preserving all applied schema and financial
evidence. Existing Booking creation remains compatible. Repair schema forward. Never import
browser state or recover money through demo/localStorage. Unqualified cached balances,
per-Parcel allocations, free-text methods/reasons and in-memory retry locks were rejected.
No dependency/framework/ORM/queue/provider was introduced. Gateway/card processing, arbitrary
bank refunds, receipts, subscriptions, remittance, messaging, broad reports and production
payment UI are explicit non-goals. [Implemented API/schema](../architecture/payments.md).
