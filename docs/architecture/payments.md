# Payments — Issue #29

[ADR 0019](../adr/0019-payment-ledger.md) · [Verification](issue-29-verification.md) ·
[Authorization](authorization-contract.md) · [Booking opening](bookings.md)

Payments owns actual manually recorded money against an existing Booking obligation.
It uses Fastify, the existing transaction/capability infrastructure, pg and parameterized
SQL. Booking, Parcels, tax, receipt generation and provider execution retain their owners.

## Authority and reconciliation

`booking_obligations` remains immutable opening evidence: its original collected=0,
outstanding=total and uncollected state are historical, including on the Booking creation
receipt. Those fields are **not** the current financial projection.

```text
gross = booking_obligations.total_paise = frozen Booking.final_payable_paise
collected = sum(collection amounts) - sum(reversal amounts)
outstanding = gross - collected
0 <= collected <= gross; collected + outstanding = gross
```

Every collection and reversal amount is a positive safe integer INR paise. Database sums
use numeric and application arithmetic uses BigInt before checked JSON conversion. No
binary-float rupee arithmetic or second tax/installment rounding. The query returns
`uncollected` at zero net, `partially_collected` between zero and gross, `settled` at gross.
Zero gross is the special empty settled position at version 0, with no fabricated collection
or event. One multi-Parcel Booking still has one gross; physical fulfillment allocates no money.

## Storage and transaction

| Object | Responsibility |
| --- | --- |
| Existing booking_obligations | Immutable opening and financial row-lock boundary |
| payment_commands | Principal/tenant/operation/key digest, canonical fingerprint/version, safe intent, original response, immutable committed receipt; exact-reference retry aliases point to the original entry |
| payment_entries | Immutable ID, tenant/Booking/obligation, kind, positive paise, INR, method/context, collection UUID, actor/time/command/correlation, per-obligation sequence, reversal target/reason |
| payment_audit_events / audit_history | Existing canonical audit architecture's reference-only financial producer; no independent audit subsystem |
| domain_events | Existing durable event store gains scoped payment command/obligation ownership and settlement envelope checks |

Composite FKs bind every nested resource to the same Organization/Franchise/Booking/obligation.
A reversal's composite FK additionally requires target kind=collection. Reference uniqueness
is `(organization_id, franchise_id, collection_reference)`. Per-obligation sequence and
one-entry-per-original-command are unique. No raw-key or global-reference discovery query.

The membership coordinator authenticates, locks the Organization, resolves current grants,
then checks/locks active Franchise. Payments locks the opening obligation **before** reading
ledger sums or deciding any financial effect. Its transaction reserves a receipt, appends
one entry, appends audit, emits settlement if required, and commits the original response.
Entry guards independently lock/check sums, target capacity and sequence. Deferred command
checks reconstruct the historical prefix projection and verify exact result/audit/event;
incomplete reservations and omitted components cannot commit. Aliases have no own financial,
audit or event effect. Session/Organization locks also serialize normal operations; retaining
those conventions is conservative correctness, not per-obligation throughput certification.

## API, intent and safe responses

All four routes require current session authentication. POST also requires Origin/CSRF,
one valid `Idempotency-Key`, JSON and the existing body-size limits. Each query requires
`organization_id` and `franchise_id`; these only select live authorized scope.

| Method and resource | Meaning / operation ID |
| --- | --- |
| POST /api/v1/bookings/:booking_id/payments | Collection; api.v1.payments.collect |
| POST /api/v1/bookings/:booking_id/payments/:payment_id/reversals | Linked correction; api.v1.payments.reverse |
| GET /api/v1/bookings/:booking_id/payments | Current reconcilable PaymentProjection |
| GET /api/v1/bookings/:booking_id/payments/:payment_id | Safe immutable entry plus current PaymentProjection |

Collection body (UUID is fictional; clients retain a distinct opaque UUID for each actual collection):

```json
{"amount_paise":40000,"currency":"INR","context":"to_pay","method":"cash","collection_reference":"00000000-0000-4000-8000-000000000029"}
```

Contexts are exactly `paid_counter` and `to_pay`. Methods are exactly `cash` and `upi`;
UPI is manual recording, with no provider call or verified-bank claim. A reference identifies
this logical evidence, not an account, address, bank credential or narrative. No paid flag
or booking context implies collection. Reversal body:

```json
{"amount_paise":20000,"currency":"INR","reason_code":"incorrect_amount"}
```

Reasons are exactly `duplicate_recording`, `incorrect_amount`, `collection_not_received`.
Both partial and full reversals are supported. Reversal inherits method/context and references
one collection, with positive amount no greater than its unreversed portion. No negative
credits, unlinked adjustments or provider refunds. Original evidence remains unchanged.

Every command returns **200 PaymentResult** `{payment, entry}`. `payment` explicitly contains
Booking/obligation IDs, currency, gross/collected/outstanding paise, derived state and version.
`entry` contains ID, kind, amount/currency, method/context, collection UUID or null, reversal
reference/reason or null, version and server UTC time. Shared exports only these public DTOs.
Actor, command, fingerprint, tenant ownership, audit internals and Customer data are omitted.
GET of the root returns PaymentProjection; GET of an entry returns PaymentResult with **current**
projection. Command replay returns its **original** historical projection. Compare versions
before applying a replay response to a current display; fetch GET for the latest balance.

Unknown fields fail strict validation, including `settled`, `paid`, `paymentMode`, totals,
ownership, obligation selectors, actor, timestamp and audit fields. Neither delivery status
nor a generic PATCH can manufacture money. Production has no demo-store dependency.

## Authorization and privacy

| Action | org_admin | franchise_admin | operator / dispatcher / agent | accountant | read_only |
| --- | --- | --- | --- | --- | --- |
| W20 collect | Denied | Own Franchise | Denied | Denied | Denied |
| W21 reverse | Denied | Own Franchise | Denied | Denied | Denied |
| R11 financial read | Declared own-org read, explicit selected Franchise | Own Franchise | Denied | Own Franchise | Denied |
| R28 audit | Declared own-org audit | Own Franchise | Denied | Financial facts only, own Franchise | Denied |

No manager role or implicit org_admin mutation. This transparently reconciles the stale
accountant/manager issue sentence; see ADR 0019. Custody/agent assignment confers no ledger
write or general financial history access. Role claims in input are rejected. Revoked grants
and inactive roots prevent command replay too; authorized financial history remains readable
when roots are disabled. Unknown/sibling/foreign IDs share 404 behavior; visible scope with
a denied role is 403. Accountant audit filtering occurs in SQL before paging, with independent
administrative and financial scope sets, never a general audit grant.

Payment records use opaque UUID references and closed enums only. No free-text note, phone,
address, PAN/CVV, account credentials, provider secret, raw key or transport credential is
stored in this domain or its event/audit projection. Existing safe logs record registered
route/status/correlation only. ADR 0013 capability/least-privilege limitations remain: runtime
SQL credentials are trusted server credentials, not RLS isolation against credential compromise.

## Retry, conflicts and restart

Identity: authenticated user + trusted Organization/Franchise + versioned operation +
SHA256(Idempotency-Key). Fingerprint includes canonical v1 media type/query, resolved Booking/
obligation/reversal IDs and every validated intent field. Property order does not matter;
amount, method, context, currency, reference, reason and target do.

Same key/intent returns the original response with no append. Same key/different intent
returns IDEMPOTENCY_CONFLICT. Same tenant reference/identical intent, even under a different
actor/key, returns the original effect after authorization and binds the new key with an
alias receipt. Changed intent returns PAYMENT_REFERENCE_CONFLICT. A changed Booking cannot
reuse a reference. Other tenants have independent namespaces and cannot discover these facts.
Concurrent requests use real PostgreSQL locks and constraints; only serially valid effects
commit. Reversal races use the same obligation lock and target remaining sum.

Pilot receipts retain indefinitely (`retain_until=infinity`) with no cleanup path. A lost
response or uncertain COMMIT is 503 and does not prove rollback: retain the exact intent and
retry its POST after reauthentication, including after pool/process restart. GET reconciles
current balances and known entries. If evidence is lost outside this contract, stop automatic
resubmission and require authorized reconciliation; never invent a new key to guess the result.
#72 must review coordinated retention before pruning financial evidence.

| Error | HTTP / interpretation |
| --- | --- |
| MALFORMED_REQUEST | 400 invalid JSON or duplicate keys |
| VALIDATION_FAILED | 422 inaccurate numeric lexemes, missing/invalid key, selector, amount, method/context/currency, reason or extra field; repository-standard semantic split |
| UNAUTHENTICATED | 401 |
| ACTION_FORBIDDEN | 403 visible scope with disallowed action |
| RESOURCE_NOT_FOUND | 404 unknown/foreign Booking or nested entry; non-collection reversal target |
| IDEMPOTENCY_CONFLICT / PAYMENT_REFERENCE_CONFLICT | 409 changed intent |
| PAYMENT_OVER_COLLECTION / PAYMENT_REVERSAL_EXCEEDED | 409 insufficient remaining capacity; refresh/reconcile |
| IDEMPOTENCY_IN_PROGRESS | 409 bounded lock wait; retain exact intent |
| VERSION_CONFLICT | 409 sequence ceiling reached, pending reviewed widening |
| ORGANIZATION_DISABLED / FRANCHISE_DISABLED | 409 operational writes disabled |
| TEMPORARILY_UNAVAILABLE | 503 dependency, invariant failure or uncertain commit; no SQL/constraint internals |

## Events, audit and delivery independence

A genuine positive-outstanding → zero transition produces `payment.settled`, schema 1,
producer Payments, aggregate payment_obligation and current ledger sequence. Payload is only
Booking ID and settlement entry reference. Correlation/causation/command and authenticated
actor use the existing envelope. No event for partial collection, reversal, delivery, opening
creation or replay. Partial/reversal revisions are intentional non-emitting revisions. After
financial reversal reopens money, recollection can settle at a later revision. Consumers
reconcile complete needed ledger evidence; event high-water alone is not a receipt or balance.
No payment.reopened event is invented. No consumer directly mutates money.

Financial reversal never undelivers a Parcel; delivery reversal never reverses collection.
#42 still owns proof-backed completion and T13's future implementation. The delivery regression
uses controlled migration-owner synthetic lifecycle states because those commands are not yet
available, with their fixture guards restored before every Payments operation.

#30 owns receipt issuance/amendment and #61/#63 report definitions/export. They can reconcile
via `createPaymentService.read`, `readEntry` and the scoped repository projection, independently
checking opening total and ledger sums. Historical prefix evidence is retained for original
results. No receipt/report consumer needs browser payment state. Their deliverables are not
claimed complete here.

## Rollout and rollback

Apply `1790182800000-payment-ledger.cjs` and [explicit grants](../../packages/db/README.md#issue-29-payment-ledger)
first. Fresh and populated upgrades retain all original amounts/IDs, create no synthetic
collections, and repeat as a no-op. Failed migration rolls back schema and migration ledger.
Opening-row UPDATE(id) privilege permits PostgreSQL row locking; the original immutable
trigger still rejects every actual UPDATE. Do not disable that guard. Runtime cannot update,
delete or truncate ledger/history or insert base audit rows; restricted definer functions
have fixed search paths and no PUBLIC execution. Rollback disables/reverts the payment API,
retains compatible Booking writers and all financial history, and repairs schema forward.

No payment frontend, gateway, refunds, receipt document, reporting UI, remittance, subscriptions,
WhatsApp or other provider execution is enabled. No new dependency or browser fallback.
