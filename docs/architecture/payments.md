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

## Receiving-account configuration — #138 implementation in progress

Receiving choices have a stable franchise-owned `receiving_accounts` identity and
append-only `receiving_account_revisions`. Each revision freezes its name, methods,
explicit other-method label, active state, actor, correlation and server-recorded
time. A cash drawer accepts only cash; a non-cash account can explicitly enable
UPI, card, bank transfer or a named other method. Configuration is evidence of the
operator's chosen destination, never confirmation by a bank or gateway.

The internal account service checks current membership before every read/write/replay.
Only an explicit local franchise-admin grant configures accounts. Org admins may
read a selected own-org franchise; local admins/accountants may read their selected
franchise. Operators receive only the named choices needed to record a receipt,
without bank credentials or ledger history. Read-only/dispatcher/agent membership
does not grant this selection action. R31/R32 and W49–W52 in the
[authorization contract](authorization-contract.md) declare the exact API/UI grants.

Configuration uses a principal/franchise request-key digest and canonical intent.
A repeated key returns the original immutable revision, even after a newer revision
is saved; a different intent conflicts. Expected version, franchise/account locks
and a database revision guard serialize updates. Identity, revision and reference-only
audit commit together; unconfigured orphan identities cannot commit. Receipt source
links pin the exact account revision rather than a mutable account label.

Apply forward migration `1792515600000-receiving-accounts.cjs`; it creates no accounts
or synthetic receiving evidence for legacy payments. Runtime configuration needs
SELECT on the two source tables, INSERT on receiving-account identity columns and
revision input columns, plus EXECUTE on `valid_receiving_methods(text[])`. Exclude
revision `recorded_at` from INSERT grants. Audit insertion is trigger-owned; grant
no runtime audit INSERT or source UPDATE/DELETE. The test provisioner demonstrates
these grants. The public API and production receipt workspace use these services;
new writes remain disabled by default until the documented rollout is qualified.


### Receipt source and allocation compatibility

`money_receipts` holds each actual manually recorded inflow once. It freezes the
customer, receiving-account revision, method, receiver, initial custody evidence,
actual occurred-at time, server-recorded time and private external transaction
reference. The reference is neither the legacy collection UUID nor proof of bank
settlement. Initial custody identifies the receiver at receipt; later handovers
require their owning recorded transfer source and never overwrite this row.

`money_receipt_commands` retains scoped principal/operation request identity,
expected receipt version, canonical intent and the original result.
`money_receipt_allocations` links each application or release to an existing
single-obligation payment entry and child command in the same transaction.
The owning receipt lock and original obligation lock serialize competing writes.
Existing adjusted-debt, payment-version, reversal-ceiling, audit and settlement
checks still apply. Same-customer booking ownership and exact parent/child intent
are checked independently by the database; arbitrary cross-customer application
has no permission here.

```text
receipt availability = original received paise - net linked allocation paise
net linked allocation = sum(allocation paise) - sum(linked release paise)
0 <= net linked allocation <= original received paise
```

The residual is an advance, never another sale. Allocation or release creates no
new inflow. There is no mutable stored receipt balance. Deferred checks require
matching committed parent/child commands, complete allocation intent, exact
as-of-version result and atomic audit. An unpaired ledger reversal cannot bypass
a receipt allocation: the old route returns `PAYMENT_ALLOCATION_CORRECTION_REQUIRED`
and a database constraint independently rejects incomplete pairing. Provision
SELECT on `money_receipt_allocations` for that legacy reversal guard.

Newly issued acknowledgements for linked entries use schema version 2, freezing
only receipt/allocation IDs, source kind and occurred/recorded times. They show
**Applied amount** or **Released allocation**. They expose no bank reference,
receiver/custodian or other-bill amounts. Existing issued schema-1 documents remain
unchanged, including their numbers and snapshots. New-method read DTOs include
card/bank-transfer/configured-other; the old cash/UPI collection command stays
compatible. Existing booking-cohort ledger totals measure funds applied to those
obligations. Actual inflow and residual advance use receipt sources, not allocation
dates or totals. Saved historical reports are never rewritten.

The receipt coordinator, source event publication and authenticated commands are
implemented through one root transaction. Operators record and apply receipts;
franchise admins additionally release mistaken allocations; accountants and scoped
organization admins can read finance evidence without gaining write permission.
A duplicate command returns its original result even after later applications,
corrections or receiving-account changes; current membership is still rechecked.

`POST /api/v1/money-receipts` records a source; `POST /:receipt_id/allocations` applies
its advance and `POST /:receipt_id/allocation-corrections` appends an admin release.
`GET /:receipt_id` is the finance evidence read; `GET /:receipt_id/balance` is the
operator-safe result. Customer-filtered receipt and bill selectors require an
explicit owned customer. Receiving-account creation/revisions are admin-only;
account reads provide method/name choices. List routes accept UUID `cursor` and
string `limit` (default 50, maximum 100); cursors only advance the ID keyset and
never change current owner/customer filters. Browser adapters retain one immutable
scope-bound command/key through uncertainty and check response money conservation,
intent matching and public evidence projection.

Each receipt command publishes its own durable aggregate event atomically, including
an unallocated advance without a Booking. Missing publication fails deferred commit.
Only source IDs enter event payloads; actual occurrence remains on the receipt,
while event time describes server recording/application. These events enable no new
automatic consumer. See [the event contract](event-contract.md).

Real PostgreSQL service tests cover the 20000 cash + 30000 UPI split against a 50000
bill, 100000 receipt applied to 40000 + 50000 debt with 10000 advance, competing last
funds, administrator release, exact retries, uncertain commit and atomic rollback.
Authenticated HTTP recording and bounded selector tests verify persistence,
conservation, pagination, privacy and cross-franchise customer denial. Allocation
history retains original application IDs, later releases and remaining releasable
amounts; receiver selection lists only currently eligible own-franchise staff.

### Production receipt workspace

`/business/money-receipts` uses real scoped APIs for explicit customer selection,
active receiving destinations, actual occurrence time, receiver/initial custodian,
private reference and optional per-bill amounts. Recording 100000 paise and applying
40000 + 50000 leaves 10000 advance. Split tender is two actual receipts, each with
its own method/account and allocations. Applying an existing advance creates no
second inflow. Admin corrections select an original history entry and append a
paired release; the source amount is unchanged and no cash refund is implied.
Finance-only detail displays private evidence, while the operator sees minimum
balances/history. Read-only and delivery/dispatcher roles gain no receipt access.

The booking counter saves commercial evidence first and links its owned customer,
Booking and planned payment context to this workspace. It cannot record a legacy
collection without account/source evidence. Package detail keeps its read-only
ledger and links new recording to the same workspace. Historical server collection
APIs remain compatible; old evidence is not rewritten. A new UI collection uses the
receipt service. Controls and workspace links lock during pending/uncertain saves;
retry retains the exact body, scope and key. A scope change invalidates old private
lifetime. Forced reload during uncertainty requires source reconciliation before a
replacement; no private request or bank reference is stored in browser storage.

Five controlled-transport React cases verify exact lost-response reconciliation,
100000/40000/50000/10000 accounting and owned counter context, advance application,
admin historical release/finance-only evidence and a named-other account revision.
Separate real PostgreSQL tests establish persistence and transaction authority. Finance-only accountant/org-admin users open a known owned receipt reference through R32, then receive its R31 customer bills/balances/history. They do not call the R05 customer directory or fetch phone/address data. Operators and local admins retain their explicitly permitted scoped customer selection.
Browser inspection of the production component with controlled fictional transport
verified keyboard customer selection, uncertain-save locking and exact retry, advance
application, finance-only receipt entry and admin account/correction forms. At a
375-pixel viewport the form has no horizontal overflow; bill labels expose their
distinguishing ID suffix and retain the complete accessible ID. Invalid money,
amounts above bill debt and applications above received funds disable confirmation
with associated errors. This browser evidence does not establish backend persistence;
real PostgreSQL tests separately verify that authority, including legacy collection
races, adjusted debt, cross-customer refusal and refund/correction interaction.
Broader final acceptance, CI and review remain required before #138 completion.

### Receipt rollout and rollback

The server defaults `MONEY_RECEIPTS_ENABLED=false`. Apply the forward schema and
least-privilege runtime grants, deploy compatible readers, then explicitly enable
new receipt/account writes. Demo rejects enablement. Disabled mode refuses new
commands with `MONEY_RECEIPTS_DISABLED` after membership checks, while allowing
saved reads and an exact completed-command replay. It does not turn an uncertain
old save into a new receipt. Rollback disables new writes and retains financial
history; repair applied schema only with a forward migration. Production deployment
and grant changes require separate authorization under the active Goal.
