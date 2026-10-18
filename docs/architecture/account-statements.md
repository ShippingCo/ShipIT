# Monthly account statements (#142)

Account statements group existing shipment obligations; they never post a sale,
collection or new debt. They are **not tax invoices**. The approved #137 document
policy, #141 frozen debtor/terms and #138 allocation service remain authoritative.
There is no subscription invoice, gateway, tax filing, automatic message or new
LLM integration.

## Evidence and equations

Select a franchise-private billing account and inclusive Kolkata dates (at most
31 days). Preview includes every account shipment through the period's end,
including earlier balances. Each line freezes booking and original tax amounts,
due date, issued receipt reference (or explicit unknown), payment/adjustment IDs
and versions. Frozen payment/reversal amounts and adjustment reasons/amounts let
each closing balance reconcile independently to its original gross. Frozen
advance receipt/version contributions reconcile received minus allocated minus
seller COD reservation and actual advance returns to the separate advance total. The latest account revision/name and responsible debtor are frozen.

Opening is the signed balance immediately before the period. Charges are the
original shipments confirmed in the period. Credits, net allocated payments and
actual refunds are separately retained. Activity is captured **through the stated
server snapshot**, retaining PostgreSQL microsecond precision, including corrections/payments recorded after period end;
this is an updated account position, not a claim of a historical month-end ledger.
Occurrence timestamps cannot backdate recorded evidence into opening balance.
The legacy statement issue route rejects account-bound sources, and its legacy
read route returns only legacy snapshots; account documents use the dedicated
account permission boundary.

`closing = opening + charges - valid credits - net allocated payments + actual refunds`

Each line also shows positive outstanding debt and separately refundable credit.
Totals sum those same lines; refundable credit on one obligation does not silently
settle another. Unallocated debtor receipts are separate from debt and exclude
seller COD reservations. Account names/phone numbers do not join debtor identities.
The existing receipt screen records or allocates payments across obligations in
several issued statements. Its allocation history and residual receipt balance
remain the source; issuing a statement never allocates money.

## Immutable lineage and concurrency

The original `account_statements` and `account_statement_lines` are reused.
Forward migration `1793379600000-monthly-account-statements.cjs` adds account,
previous-document, revision and source digest columns; no balance table is added.
All 53 released migrations remain unchanged. Existing statement JSON, identifiers
and source memberships stay intact with null new account metadata; historical
monthly-account identity/due evidence is not invented.

Preview retains the account-wide next revision and a digest of financial sources.
Issue accepts only that expected revision/digest, under current administrator
authority and the existing organization/franchise financial lock order. Concurrent
issue requests cannot both consume a version. The database independently constrains
same-owner account/previous-document references, consecutive revision and unique
booking membership. State and existing statement audit commit together. There is
no asynchronous side effect requiring an outbox event.

An unchanged capture is rejected. Late shipments and changed allocations,
cancellations or refunds produce a later document linked to its predecessor.
Previously documented sources show their original document; only newly documented
shipments add membership rows. All historical snapshots stay unchanged. Review the
new preview after a stale-version rejection. A lost acknowledgement must replay
the original actor/key/body; a changed body conflicts. Current authority is checked
on every replay, read and download. Disabling new writes still permits authorized
recovery of a committed result.

## APIs, permissions and private downloads

All routes require current session, explicit organization/franchise selection and
the existing CSRF/idempotency contract for writes. Ownership fields and financial
amounts are never accepted from the browser.

- `POST /api/v1/account-statements/preview`: bounded source preview.
- `POST /api/v1/account-statements`: issue with expected version/source digest.
- `GET /api/v1/customer-accounts/:id/statements`: 50-revision keyset history.
- `GET /api/v1/account-statements/:id`: original immutable evidence.
- `POST /api/v1/account-statements/:id/exports`: capture actor-owned private CSV.
- `GET /api/v1/account-statement-exports/:id`: current authorization, actor and expiry checked again.

Account reads/previews use #141's administrator/accountant/organization-admin read
policy. Only local franchise administrators issue under W48. Export uses E03:
local franchise admin/accountant only, with no implicit organization-admin export.
Operators, agents and read-only roles receive no billing-profile access. Receipt
record/allocation permissions remain #138's existing permissions; viewing or
issuing a statement grants none. Foreign and unknown resources return the same
controlled not-found result.

The existing `report_snapshots` infrastructure retains each export for 24 hours,
at most 20 active captures per actor/franchise. Download is actor-owned, audited,
formula-neutralized CSV with explicit paise columns and per-line JSON ledger evidence.
The first data row carries the separate advance-source JSON; statement control
totals are repeated metadata, not extra economic rows. There are no contact/address/bank
reference fields, at most 5,000 lines and 8 MiB. An expired capture must be captured
again from retained issued evidence; the statement itself remains immutable.

## Unused advance returns

The approved #137 handoff assigns advance refunds to #142. The product owner
confirmed inclusion of request, independent approval, actual-return evidence and
UI. This is separate from a booking's refundable credit: no synthetic booking,
sale, expense or tax adjustment is created.

In Money receipts, open a saved receipt and use **Unused advance refunds**.
Operators and franchise administrators may request a positive amount with a
reason and current receipt version. A different current franchise administrator
must approve or reject; the cash-close sole-admin exception does not apply.
Approval reserves no funds and records no movement. A current franchise
administrator then records the actual return with the approved request version,
active source location/revision, supported payment method, actual time and private
recipient/acknowledgement and transfer references. Evidence is manually recorded
and unverified; no bank transfer is sent. References use the existing #139
letters/numbers/colon/underscore/hyphen format. A transfer reference cannot be
reused from the same account and method across booking and advance returns;
both producer guards serialize this check with the franchise monetary lock.
The source location must have sufficient recorded funds after pending handovers,
with no unresolved refund custody. Return time must follow the request and cannot
be in the future. If funds have since been allocated or reserved for seller COD,
the actual return fails atomically. Requests can be independently rejected; an
approved request remains unapplied until sufficient funds are available.

`advance_refund_commands` retains immutable request/review/return events, actor,
correlation, intent fingerprint and exact retry identity. Current membership is
checked on every action and replay. The shared audit feed projects safe event
codes, actors and times without free-text reasons or private transfer references.
Each request has at most one review and one
actual return. Receipt/franchise locks serialize returns with both freight
allocations and COD reservations; database guards enforce the shared capacity.
Receipt summaries subtract all actual returns. Later allocation results include
the returned amount; previously committed results and statement snapshots remain
unchanged. Statements freeze returned totals with their advance sources, retaining
fully returned sources with zero residual so actual returns remain visible.
Actual returns appear exactly once as refund outflows in the existing cashbook
source view and cash-close captures. Noncash returns are also available as debit
sources in manual reconciliation (`advance_refund:<return-id>`). Private references
are confined to finance-authorized refund/reconciliation views.

API: GET/POST `/api/v1/money-receipts/:receipt_id/advance-refunds`; POST
`/api/v1/money-receipts/:receipt_id/advance-refunds/:request_id/{approve|reject|return}`.
All writes require CSRF and idempotency keys. Finance history is keyset paged;
the browser loads complete history before enabling decisions. Uncertain requests
retain their exact body/key and lock workspace navigation until reconciled.
`MONEY_RECEIPTS_ENABLED` gates new refund writes, with committed replay retained.

## Research decisions

- **Reuse** [PostgreSQL 18 statement snapshots](https://www.postgresql.org/docs/18/transaction-iso.html)
  for a single source/advance capture and the existing short monetary locks for
  issue. This prevents mixed totals; cost is a bounded SQL read, with no warehouse,
  queue or distributed locking system.
- **Adopt existing** [AWS idempotent request identities](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  and source fingerprints for uncertain results. Cost is existing immutable command
  identity storage and retaining the exact browser intent, without a retry daemon.
- **Retain** ADR 0045's statement-versus-invoice decision and #137/#138 allocation
  ownership. Statutory invoice/software qualification stays with #150.

## Development rollout and manual verification

Apply the additive migration first. Reuse the documented financial/report runtime
grants plus SELECT on the account/revision/binding, money-receipt/command and
`cod_receipt_positions` sources. Enable `CUSTOMER_ACCOUNTS_ENABLED=true` only after
schema/grants are ready; it also gates new account statement writes. Disable it
to stop new writes while preserving evidence/read/replay. Never deploy older
debtor-unaware code against account bookings; repair schema forward.

Also grant the runtime SELECT on `shipit.advance_refund_commands` and INSERT on
its `id,organization_id,franchise_id,receipt_id,request_id,version,operation,actor_id,
correlation_id,key_digest,fingerprint,input,amount_paise,receipt_version` columns.
The migration replaces `shipit.money_receipt_result(uuid,uuid,uuid)` in place,
preserving existing execute grants and historical results without an extra
function layer. Apply schema and new table grants before activating the upgraded
API. Do not grant UPDATE/DELETE on refund history. Existing
cashbook and reconciliation view grants continue to apply. Reuse
`MONEY_RECEIPTS_ENABLED=true` for refund writes after schema/grants are ready.

With two fictional organizations/three franchises, create a monthly account and
three shipments. Part-pay one and financially cancel another. In Customer accounts,
select the debtor, preview its period and compare each source with the equation.
Issue, reload history and capture/download the private CSV. Issue a changed
statement after adding a shipment or allocating another payment; compare the
unchanged original and linked revision. Allocate one receipt across shipments
in different documents and inspect its history/residual. Repeat denied reads,
issue/replay/export as sibling, foreign and read-only users. Resolve an uncertain
issue using “Retry same request”; do not change account or intent first.

For advances, record a fictional unallocated receipt to a configured source
location. Request a partial return, confirm self-review is denied, approve with a
different administrator, then record actual return evidence. Compare the remaining
advance, one cashbook outflow and one optional noncash reconciliation source.
Reopen the original statement to confirm its frozen balance. Repeat with seller
COD funds and concurrent allocation: neither path may spend the same funds twice.

Verification results are recorded only after their commands finish. Native
PostgreSQL tests use the existing guarded disposable database harness; no real
customer data, deployment or provider/accountant compatibility is claimed.
