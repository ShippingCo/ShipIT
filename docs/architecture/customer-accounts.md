# Monthly customer accounts (#141)

Implementation contract and operating guide. The approved financial contract remains
[financial operations](financial-operations.md). Product-owner decisions D141-1–D141-6
were explicitly approved on 17 October 2026 and recorded in
[issue #141](https://github.com/ShippingCo/ShipIT/issues/141#issuecomment-6230982555).
This is product approval, not independent engineering review or deployment approval.

## Approved rules

Closing day is inclusive in Asia/Kolkata; a configured day missing from a short
month clamps to its last calendar day. Due date is that closing date plus explicitly
configured calendar days. Freeze terms and due date at booking. No historical due-date
backfill or universal net-30 default.

Held/suspended accounts and any known overdue outstanding balance block new credit
bookings. Limit exceptions cannot bypass either hold. Unknown legacy due evidence
remains unknown. Exposure includes unbilled account obligations. Advances reduce it
only through explicit valid allocations, never by netting a customer's unallocated funds.

An account is a franchise-private debtor relationship, distinct from shipment sender
identity. The debtor can be the same existing customer. Administrators explicitly link
shipping customers; names and phone numbers never group identities or grant access.
Booking retains both original shipping customer and frozen bill-to customer. Receipt
allocation for account bookings uses that frozen debtor, while ordinary booking
allocation retains its existing customer rule.

A valid matching negotiated rate takes precedence; otherwise normal franchise pricing
applies. Preserve ordinary policy and negotiated version/source evidence. New versions
affect future bookings only. Browser freight overrides cannot silently replace an account
agreement; administrators publish a revised negotiated rate.

Only a current franchise administrator may approve a credit-limit exception, with a
reason and exactly one operator's complete booking intent. It expires with the existing
pricing/tax validity, not an invented duration. Changes to the intent or account revision
require refreshed approval. Current roles, holds, source versions and expiry are checked
again when the booking atomically consumes it. Admin status alone grants no new booking
permission; the existing operator requirement remains.

Billing contact authority is a recorded franchise-admin attestation with an evidence
reference. It is not independent legal verification, customer-channel identity, login
provisioning or authorization to send an external message.

## Implementation and rollout evidence

Additive migration `1793206800000-customer-accounts.cjs` preserves all existing bookings,
pricing, taxes and receipt history. New entry points are gated by
`CUSTOMER_ACCOUNTS_ENABLED=false` until the migration and runtime grants are installed.
Disable new writes to roll back compatible code; retain evidence and repair schema
forward. No browser storage import or fallback is allowed.

Focused PostgreSQL tests cover normal ₹150 versus
negotiated ₹120, unchanged historical prices, two concurrent ₹600 bookings against
₹1,000 credit, exact one-use exceptions, overdue debt, separate debtor allocation,
current-grant revocation and lost acknowledgement recovery. The fictional browser
exercise is recorded below. Full quality, exact-head CI and independent approval
are mandatory PR gates; product approval alone does not establish production readiness.

## Evidence and transaction boundaries

An immutable account identity fixes its debtor. Each admin revision records the
complete contact/terms/links/state/limit, actor, server time and reason. An account
can link 1–100 existing local shipping customers. Attestation is mandatory on every
revision; its evidence reference is private. Each effective rate version contains
1–100 non-overlapping weight rules. A newer effective schedule replaces the entire
previous schedule; when that replacement expires, normal rates apply. Schedules
must begin at or after publication time and cannot rewrite an old booking.
Ordinary franchise quote validity/tolerance policy still governs proposals. Source
metadata distinguishes the ordinary policy/rule from the negotiated revision/rule
index; a negotiated quote has no ordinary rule ID.

For every account booking, define `remaining = max(0, original gross − approved
charge reductions − net collections + net refunds)`. Exposure is the sum of these
remaining amounts, including unbilled bookings. Available credit is
`max(0, current limit − exposure)`; overdue is the same remaining sum restricted to
frozen due dates earlier than today's Asia/Kolkata business date. Credit source
pages use the total's server cutoff (the last complete millisecond). Immutable
booking/payment command commit times and financial-entry recorded times exclude
later records across all pages, regardless of a payment's economic occurrence time. They show original charge, reductions, collections, refunds,
remaining amount and booking reference. A source is not invented for legacy
bookings: existing bookings have no account binding, and no balance is backfilled.

Current authority locks the organization before the franchise/account locks. The
booking transaction revalidates quote/tax, account revision, shipping link, debtor,
expiry and hold; checks exposure; then commits the booking, obligation, account
snapshot, command result and existing domain events together. Competing bookings
serialize at this boundary. Database guards independently enforce snapshot
presence, debtor/terms/due date/source, credit and unique approval consumption.
Approved intent includes customer version, quote/tax, destination, service and all
ordered parcel weights, dockets and recipient details. The stored approval also
binds the complete final booking command fingerprint. No reusable override token
is accepted. A changed intent requires another request/approval.

Account revisions, rates, requests and approvals append safe references to the
existing audit history. Contact addresses, request bodies, phone numbers and raw
financial documents are never copied to audit/log payloads. Request bodies remain
private domain evidence. No new provider, worker or external notification is added.

## API and permission contract

All routes require the authenticated session and explicit `organization_id` and
`franchise_id` selection. Mutations use the existing CSRF and `Idempotency-Key`
contract; scope comes from current membership, never body ownership fields.
Same actor/key/body replays the immutable outcome, including after the feature flag
is disabled. A conflicting body fails; revoked authority cannot recover an outcome.

- `GET/POST /api/v1/customer-accounts`: bounded profile list / create identity+revision.
- `GET /api/v1/customer-accounts/:id`: current approved profile.
- `POST /api/v1/customer-accounts/:id/revisions`: expected-version revision; debtor is immutable.
- `GET /api/v1/customer-accounts/:id/history`: 50 version-keyset revisions per page.
- `GET/POST /api/v1/customer-accounts/:id/rates`: bounded history / expected-version schedule.
- `GET /api/v1/customer-account-choices?customer_id=…`: minimal explicitly linked account choices.
- `GET /api/v1/customer-accounts/:id/credit`: live amounts and server cutoff.
- `GET /api/v1/customer-accounts/:id/credit-sources?as_of=…`: bounded amount evidence at that cutoff.
- `POST /api/v1/customer-credit-requests`: operator's normalized exact booking intent.
- `GET /api/v1/customer-credit-requests/:id`: only the requesting operator's approval outcome.
- `GET /api/v1/customer-credit-requests` and `/:id/review`: admin pending list and review evidence.
- `POST /api/v1/customer-credit-requests/:id/approval`: admin decision with mandatory reason.
- `POST /api/v1/customer-credit-approvals`: equivalent explicit admin command with operator ID, booking intent and reason.

UUID keyset pages default to 50 and permit at most 100. Invalid/foreign nested IDs
share the controlled not-found response. The [role matrix](authorization-contract.md)
adds R39–R42/W72–W75; org-admin/accountant do not inherit operational writes.
`ACCOUNT_HELD`, `ACCOUNT_OVERDUE`, `ACCOUNT_CREDIT_EXCEEDED`,
`ACCOUNT_APPROVAL_INVALID` and `CUSTOMER_ACCOUNTS_DISABLED` are controlled 409
responses. Stale pricing/terms use the existing `QUOTE_STALE` response. The UI
retains an uncertain command's original identity; do not switch account or retry
with a new key while the result is unknown.

## Owner/operator walkthrough

1. In Customer accounts, the franchise admin searches an existing customer by
   name, selects the debtor and explicitly adds shipping links. The debtor may
   also be a shipping customer. Enter contact evidence, closing/due terms, limit,
   status and reason, then attest authority and save.
2. Publish a negotiated schedule with explicit effective times in Asia/Kolkata.
   Review the immutable history and normal-versus-negotiated source.
3. The operator confirms the shipping customer in New Booking, selects a linked
   bill-to account, checks available credit/source bookings, and previews price/tax.
   Held/overdue accounts cannot be bypassed by a limit exception.
4. If a limit exception is needed, request it for the current draft. The admin
   reviews that request and its source amounts, enters a reason and approves.
   The operator checks approval and saves before the existing quote/tax expires.
   Editing any shipment field clears the client approval; the server also checks
   the exact intent. The saved confirmation displays debtor, due date and source.
5. Record actual money through Money receipts for the saved debtor. An unallocated
   advance does not restore credit until explicitly applied to the account booking.
   Accounting statements and monthly billing remain #142, not this feature.

## Runtime grants and rollout order

Apply all forward migrations with the schema owner, then the existing runtime grants
plus the following (replace `shipit_runtime` with the deployment's restricted role):

```sql
GRANT SELECT, INSERT ON shipit.customer_accounts,
 shipit.customer_account_revisions, shipit.customer_account_rates,
 shipit.customer_account_bookings, shipit.customer_credit_requests,
 shipit.customer_credit_approvals TO shipit_runtime;
GRANT UPDATE(id) ON shipit.customer_accounts, shipit.customer_credit_requests,
 shipit.customer_credit_approvals TO shipit_runtime;
GRANT SELECT ON shipit.customer_account_customer_links,
 shipit.customer_account_audit_events TO shipit_runtime;
```

Column UPDATE grants support row locking only; immutable triggers reject updates.
Do not grant audit insertion, trigger function execution, schema ownership or public
access. Existing receipt allocation runtime roles need SELECT on account-booking
bindings even with new account writes disabled. Keep the flag false while installing
schema/grants and compatible API/UI, verify fresh/populated migration and fixtures,
then explicitly enable it. Ordinary bookings/collections/refunds/reporting continue
without account entry. Disable new account commands/quotes/bookings to roll back;
keep compatible readers and retained history. Do not deploy older receipt allocation
code against existing account bookings because it uses the shipping customer rather
than frozen debtor. Schema repair is forward-only; never delete financial history.

## Fictional verification evidence (17 October 2026)

The isolated PostgreSQL 18.6 browser exercise used an admin and operator, a synthetic
customer, and a fixed 2099-01-01 business clock. It revised a monthly account from
₹1,000 to ₹0 credit with an explicit attestation and retained both revisions. The
operator selected the linked account, obtained ₹120 negotiated freight plus ₹6 tax,
and was blocked at the limit. The admin reviewed the exact recipient, 999g weight,
quote/tax references and current credit, then approved with a recorded reason. The
operator checked approval and saved docket `SIT-0000000000000000001` at ₹126.
Confirmation showed the debtor, negotiated source and frozen due date 2099-02-10;
no collection was recorded. The account source view independently showed original
₹126 − reductions ₹0 − collections ₹0 + refunds ₹0 = outstanding ₹126. The pending
approval queue was empty after approval. The fixture's attachment provider was not
configured; its separate attachment retry state did not prevent booking.

The 390px mobile check exposed account-editor overflow; scoped layout corrections
were verified with document width no greater than the viewport. Desktop account
history and source evidence were also inspected. Local screenshots are retained in
ignored `.codex/issue-141/booking-mobile.jpg` and `account-desktop.jpg`; all data is
fictional. The disposable database and browser tabs were removed after verification.
The owner/operator walkthrough above reproduces the same scenario with existing
seeded customers, rates and tax policy; no production credentials are required.

Focused automated commands (pinned toolchain):

```sh
pnpm --filter @shippingco/web test -- src/test/customer-accounts.test.tsx src/test/counter.test.tsx src/test/settings.test.tsx
pnpm --filter @shippingco/api test -- test/integration/customer-account-validation.test.ts
pnpm check:migrations
pnpm db:local quality
```

The full quality gate discovers `apps/api/test/database/customer-accounts.test.ts`
and `packages/db/test/integration/customer-accounts.test.ts`. These additionally
exercise scope denial for identical company names, real HTTP CSRF/mass-assignment,
rate fallback/expiry, malformed DB rate rules, unchanged source cutoff after later
backdated collection, concurrent credit, and upgrades from populated released schema.
Exact final-code gate results and independent review remain separate PR evidence.
