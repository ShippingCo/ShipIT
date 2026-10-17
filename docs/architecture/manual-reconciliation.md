# Optional manual statement reconciliation — #146

[Issue #146](https://github.com/ShippingCo/ShipIT/issues/146) implements the approved
[D137 financial contracts](financial-operations.md) after #138/#139. The product
owner explicitly requires optional, disabled-by-default franchise opt-in, manual
CSV only, configurable mapping, deterministic matching, discrepancy review and
history ([recorded decision](https://github.com/ShippingCo/ShipIT/issues/146#issuecomment-6231742804)).
There are no bank APIs, banking credentials, payment gateway connections, AI calls,
paid subscriptions or automatic money movements. Ordinary bookings, collections,
receipts, refunds and reports never depend on reconciliation configuration.

## What is authoritative

A statement transaction is external evidence, not revenue or a collection. Explicit
classification distinguishes customer payment, advance, owner funds, transfer, fee,
other and unassigned. A confirmed match never appends payment entries, allocations,
refunds, cashbook requests/effects or sales. Original receipt inflow remains its
original amount even when its customer-debt allocation is released. A refund uses
its qualified receiving-account evidence and original refund less linked refund
corrections. A noncash cashbook source uses the root request identity and latest
applied complete replacement, not a sum of replacement amounts. Deposits and
withdrawals preserve the noncash leg and its direction. Physical cash is excluded.
Legacy facts without a proven receiving account remain explicitly unknown; a report
shows those franchise facts without assigning them to the selected bank account or
including them in that account's control totals.

All monetary storage uses positive integer INR paise (safe integer per allocation).
Sums use SQL numeric/JavaScript BigInt. For normal matching, recorded gross equals
statement net. For card batches, `gross = net + evidenced fees`: ₹5,000 recorded card
receipts minus ₹100 approved expense evidence equals ₹4,900 statement net. A fee
uses the same source capacity as any other match; it cannot also be consumed as a
separate bank debit. Missing fee evidence prevents confirmation. Batches carry an
explicit expected business date; unsettled future batches are pending, not missing
money. Calendar dates use Asia/Kolkata. No floating-point/locale currency guessing.

Matching is deterministic: account, currency, direction, external reference and
full amount must agree uniquely for an exact match. Amount/date-only similarity is
a review suggestion. A person must explicitly confirm it as manual verification,
with a reason. Screenshot-only verification is unsupported: confirmation requires
an imported transaction and recorded source amounts. Every match stores actor,
server time, account, source versions, allocations and reason. Partial and split
matches may consume remaining capacity only. A franchise-admin unmatch is a new
immutable record releasing reconciliation capacity; originals remain intact.

Later legitimate financial corrections remain possible. A changed source version
or amount makes an active match visibly different in a new report. The prior report
retains its original evidence. Reviewers must inspect the correction, unmatch and
rematch appropriate current evidence; reconciliation does not prevent truthful
ledger correction or silently adjust the old match.

## CSV format and identity

Only fictional fixtures are verified. No named bank, processor or accountant export
format is certified. An administrator selects headers and explicit formats from an
uploaded sample. Supported grammar: UTF-8 CSV, optional BOM, quoted cells/escaped
quotes, LF/CRLF, 64 KiB decoded bytes, 200 data rows, 16 columns and 256 characters
per cell. Headers follow the existing bounded import grammar. Dates are explicitly
`yyyy-mm-dd`, `dd/mm/yyyy` or `dd-mm-yyyy`; invalid days and out-of-period dates are
rejected. Amounts may use signed amounts (explicit positive direction), separate
credit/debit columns, or an amount plus exact credit/debit labels. Select rupees
(maximum two decimal places) or integer paise. Currency is INR by explicit mapping
contract; if supplied, every row must contain INR. Thousands separators, currency
symbols, scientific notation, formula amounts and unsupported layouts are rejected.

A versioned mapping records a stable uppercase identity namespace, selected date,
amount, optional external reference, optional proven unique transaction ID and
optional currency columns. A reference is not presumed unique. The operator selects
an owned noncash account and inclusive period before preview. Raw CSV and unselected
columns are never persisted. Preview keeps only normalized financial candidates,
row errors, file SHA-256, mapping/account revision and row provenance. Invalid rows
retain a safe error code with no raw cell values. A bounded commit processes at most
20 selected rows atomically. Resume from saved import outcomes; processed rows are
not imported twice. Invalid rows become rejected outcomes.

The same file/row or namespace/proven ID maps to the original transaction. Overlap
without a proven ID requires explicit duplicate/distinct/reject review. No heuristic
silently merges equal payments. Reused proven identity, or reused reference with a
different amount/account/direction, raises a conflict instead of blind matching.
A conflict can be rejected; corrected data must be submitted as a new preview.
No-ID duplicate review binds to an existing same-account/currency/direction/amount
transaction with a reason. Original candidate provenance remains available.

Synthetic mapping example (no bank compatibility claim):

```csv
Date,Amount,Reference,ID
2026-01-01,500.00,SYN-UPI-500,SYN-BANK-001
2026-01-02,4900.00,SYN-CARD-NET,SYN-BANK-002
```

Use date `yyyy-mm-dd`, signed rupees with positive credit, `Reference`, proven `ID`,
namespace `SYNTHETIC`. Blank IDs exercise manual identity review.

## Transactions, scope and privacy

Every owned row has organization/franchise ownership and composite foreign keys.
Current authentication and membership are rechecked before every read, write,
export and retry. R43 and W76–W79 define explicit grants; E03 limits exports. Reads
receive an independent audit capability, never a ledger capability. All responses
are `Cache-Control: no-store, private`; browser DTO projection, scope tickets and
abort/purge prevent cross-franchise late responses or browser persistence.

Commands lock organization then franchise, use actor/action/scoped request-key
digests and a canonical fingerprint, and append domain evidence plus command/audit
in one transaction. Deferred constraints enforce command linkage, exact source
provenance, full match equation and both capacities. SQL also enforces append-only
history, version ordering, current actor/lifecycle, opt-in, mapping/preview shape,
row resolution transitions and review identity. A prior committed command cannot
acquire more lines. Competing allocations serialize. After a lost acknowledgement,
retry exactly the retained key/body; a current authorized retry recovers the saved
outcome even after opt-out. Revocation still denies that replay.

Audit exposes identifiers, actor, server time, action and review reason, not raw
statement contents. Only the minimum normalized evidence required for financial
traceability is retained under existing finance access/hold policy. There is no raw
statement download or invented statutory deletion period. Any legal retention
qualification remains in #72. Report snapshots are private to the capturing actor,
expire after 24 hours and use existing bounded cleanup/quotas (20 per actor,
5,000 rows, 8 MiB, at most 31 dates). CSV export uses a selected-column allowlist;
external references are excluded by default and spreadsheet formula cells escaped.
Never put bank passwords, PAN/CVV or unrelated beneficiary details in selected CSV
columns or free-text reasons.

## API and owner workflow

All endpoints are under `/api/v1/reconciliation`, require session/selected
`organization_id` + `franchise_id`, and reject mass-assigned fields. POSTs require
origin/CSRF and, except bounded header inspection, `Idempotency-Key`.

| Endpoint | Behavior |
| --- | --- |
| GET/POST `config` | Read default-false/current state; admin opt-in/out with expected version and reason |
| GET `accounts`, `sources`, `transactions`, `batches`, `imports` | Bounded cursor catalogs; account filter required except account catalog |
| GET/POST `mappings`; POST `mappings/:profile` | Private mapping history and explicit version publication |
| POST `columns`; POST `imports` | Authorized bounded header inspection; immutable normalized preview |
| GET `imports/:id`; POST `imports/:id/commit`, `imports/:id/resolve` | Resume and review row outcomes |
| GET `transactions/:id/suggestions`; POST `matches` | Deterministic suggestions and explicit confirmation |
| POST `batches`, `batches/:logical-id` | Card receipt/fee evidence and expected date versions |
| POST `matches/:id/unmatch` | Admin-only reasoned unmatch revision |
| POST `transactions/:id/classification` | Explicit classification revision |
| POST `cases`, `cases/:logical-id` | Open/resolved discrepancy revisions with stable source references |
| GET `history/:resource-id` | Paged actor/time/reason action history |
| POST `reports`; GET `reports/:id`, `reports/:id/export` | Frozen review, offset pages and E03 selected-column export |

Owner UI: choose Receiving account; Statements and mappings inspects the CSV, saves
mapping versions and previews, commits the next 20 rows, and resolves ambiguity.
Match evidence selects bank and recorded amounts, previews suggestions, and records
card gross/fees/expected date before confirmation. Daily review captures controls
and evidence, filters recorded/verified/pending/different/unassigned, drills into
verifier/source versions and history, classifies entries, opens/resolves cases, and
allows administrator unmatching. Open exceptions carry forward. A resolution records
an explicit review outcome, not an invented sale or cash transfer.

Report rows and control sums use one SQL statement/MVCC cutoff. Credits and debits
are separate; source and statement totals are not added together. Each control
reconciles to its same-kind/direction detail rows. Batch and case rows are evidence,
not additional money totals. New capture is required after changes. All loading,
empty, error, validation, disabled, success and exact-request retry states remain in
the production seam. Uncertain commands retain body/key and block account, section,
franchise and router navigation until reconciled; no localStorage fallback.

## Rollout and verification

Apply migration `1793293200000-manual-reconciliation.cjs` (53) before new code. Fresh
and populated released-52 upgrade preserves original financial/custody evidence and
creates no reconciliation or opt-in records. Runtime grants are explicit SELECT,
INSERT on reconciliation owned tables; SELECT on the recorded-sources view and
existing financial/report dependencies. No UPDATE/DELETE, public or ledger-writer
grant is introduced. See `prepareReconciliation` in test support for the exact table
set; production provisioning must apply only corresponding service-role grants.

`RECONCILIATION_ENABLED=false` by default is the server rollout/rollback gate. `true`
allows a local administrator to opt in each franchise; it does not opt in any
franchise itself. Demo rejects enabling. Roll back compatible application code or
set the flag false; retain schema/history, repair schema only forward. No deployment
infrastructure is provisioned under this issue (#68 stays deferred).

Focused tests cover optionality, CSV grammar, identity overlap/ambiguity, exact ₹500,
ten reference-free ₹100 suggestions, partial/raced allocations, ₹5,000−₹100=₹4,900,
correction-visible differences, stable reports/control sums, explicit exception
resolution, current grants, revoked retry/export, lost commit acknowledgement,
direct SQL rejection and populated migration. Browser regression tests cover
keyboard selection, reasoned matching, private projections and exact uncertain
retry/navigation. A real PostgreSQL browser run also verified normalized import,
explicit ambiguous-row rejection, keyboard exact UPI selection, the card equation,
six verified report rows with zero remaining capacity, verifier/time/source drilldown,
classification, audit history and a selected-column CSV download without references.
At 390px, evidence buttons wrap without horizontal page overflow. Receiving-account
method changes or deactivation preserve access to historical bank evidence; new
matching still requires a noncash account.

Final local `pnpm db:local quality` passed on 17 October 2026: 671 real PostgreSQL
cases (89 schema, 582 API), 758 API unit/integration tests, 357 frontend tests,
40 quality harness tests, 22 testkit tests, 12 DB unit tests and 3 private S3
contract tests. Planning, lint, typechecks and production builds passed. All 52
released migrations remain unchanged. Two earlier full runs exposed stale migration
fixture expectations; those counts and synthetic forward-repair ordering were fixed,
and the final complete run passed without failures or skips. Existing React/router
warnings and intentional negative S3 request diagnostics remain visible.

Current-head CI and applicable review remain separate merge gates. These fictional
checks do not claim bank-specific or accountant compatibility.

Reproduce with the pinned toolchain from `docs/QUALITY_CHECKS.md`:

```sh
pnpm check:migrations
pnpm --filter @shippingco/web exec vitest run src/test/reconciliation.test.tsx
pnpm db:local quality
```

The complete quality command runs the synthetic two-organization/three-franchise
fixtures in `apps/api/test/database/reconciliation.test.ts`, the HTTP authorization
and CSRF fixture, and `packages/db/test/integration/reconciliation.test.ts` for the
populated upgrade. It also runs existing receipt/financial workflows that prove the
source view preserves original inflow after allocation release and reduces a refund
only by its own corrections. The frontend workflow test uploads a synthetic local
CSV, saves the selected mapping, previews it and commits the normalized row, as well
as testing exact matching, report drilldown, grants and uncertain-request recovery.
