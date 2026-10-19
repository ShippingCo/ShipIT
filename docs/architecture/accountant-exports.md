# Accountant register and generic CSV v1

#150 adds a read-only register in Business → Reports → Accountant register. It
uses existing source owners and #61 private report artifacts. It neither posts
journals nor issues tax documents. GnuCash is the selected qualification candidate;
[actual import and accountant review](accountant-target-proposal.md) are pending.
Generic captures and downloads do not depend on GnuCash or reconciliation being enabled.

## Operator workflow and contract

Select inclusive Asia/Kolkata dates and explicitly permitted franchises, optionally
include private payment/approval references, then capture. Preview, control sheet,
source drill-through and download all refer to the same saved capture. The URL can
reload that capture. A complete CSV bundle is downloaded as an uncompressed `.tar`;
extract it and read `manifest.csv` and `dictionary.csv` before processing any rows.
There is one file for every supported family, including empty header-only files.

`POST /api/v1/reports/accountant?organization_id=…&franchise_id=…` accepts only
`from_day`, `to_day`, optional `franchise_ids`, optional boolean `include_references`
and `format: generic_csv_v1`. It requires the existing cookie/CSRF boundary and an
Idempotency-Key. Body ownership/actor fields, unsupported formats and duplicate or
unauthorized scopes are rejected. Same key and normalized body replay the original
capture; a different body conflicts. One bounded server retry recovers transaction
serialization/uncertain acknowledgement with the same identity. If the response is
still uncertain, use **Retry same register request**, not a new capture command.

`GET …/accountant/:id` accepts `offset` in 100-row increments, optional `family`,
exact `row` identity or `control` index. A control drill-through selects the exact
saved family/basis/position or reconciliation account/kind/direction contributing to
that measure. `GET …/:id/export` returns the same metadata plus `{name,csv}` files.
All responses are `Cache-Control: no-store`. Captures remain actor-owned; knowing
an artifact ID does not grant access to another actor's report.

Existing R11 financial-read and E03 export permissions apply. Organization admins
can preview their permitted organization scopes but do not acquire an export grant.
Export requires current franchise-admin/accountant grants for **every saved scope**.
Operators, agents and read_only do not gain accounting access or money mutations.
Current membership is rechecked on replay/read/export, with a fresh authorization
transaction before returning capture results. No new role or role-matrix exception
is introduced. Unknown/foreign/expired artifacts use controlled unavailable responses.

## Source ownership and counting

| File family | Authoritative source / meaning |
| --- | --- |
| sales | One booking's frozen original tax snapshot and gross; no repricing |
| shipments | Parcel/docket to booking links; no money |
| documents, statements, statement_shipments, document_links | Issued document identities, versions and relationships; statements and booking receipts are not qualified tax invoices; external references are unverified |
| receipts | One actual money_receipts event, regardless of allocations |
| allocations | Signed application/release against an existing receipt and booking; no new receipt or sale |
| legacy_receipts | Payment ledger collection/reversal only when no modern allocation owns the entry; account/custody provenance stays unknown |
| adjustments | Approved charge reductions and saved GST/rounding components; not automatically statutory credit notes |
| refunds | Actual refund record and negative correction of an erroneous record; correction is not another physical transfer |
| advance_returns | Actual unused-advance return, excluding request/approval-only commands |
| cashbook | Applied expense or nonrevenue movement; corrections are differences from the predecessor, with revised amount retained separately; fee cash/advance fields are signed differences |
| custody, handovers, handover_acknowledgements | Custody legs and requested/acknowledged evidence; never a new collection or sale |
| cod_obligations, cod_reservations, cod_positions | Configured obligation revisions, actual reserved seller money and remaining liability; never freight income |
| agent_fees, agent_fee_positions, agent_advance_positions | Entitlement, recognized expense, direct payment, advance application, payable and recoverable advance remain separate |
| settlements, settlement_decisions | Submission/review revisions; approval does not prove transfer |
| reconciliation_state, reconciliation | Optional configuration plus recorded external/source/match/batch/case lineage. Matching does not post a receipt, sale, fee or transfer. Existing evidence remains visible when new reconciliation work is disabled |
| booking_positions, advance_positions | Opening/closing positions from independent source equations; not extra journals |
| gst_summary, controls | Reference summaries and independent source versus exported totals; never additional economic events |

GST groups use the original saved rational rate, treatment, jurisdiction and policy.
Original sales and reductions are separate groups. Tax components are retained as
selected JSON source evidence; no current tax configuration or legal qualification
is substituted. A correction linked to a prior-period booking uses that original
booking's tax identity. Unknown is an explicit absent-evidence marker, not zero.

## Exact equations and time

All money is exact integer INR paise; no floating point aggregation. Positive charge
reductions subtract from original gross. Collections/allocations and corrections are
signed. For each booking and each boundary:

- adjusted gross = original gross − approved component reductions;
- held customer money = allocated/legacy collections − net refunds;
- debt = max(adjusted gross − held money, 0); refundable credit = max(held money − adjusted gross, 0);
- unallocated receipt advance = received − allocated − net COD reserved − actual advance returns;
- seller liability = reserved − remitted − reservation reversals;
- recognized agent fee payable = recognized expense − direct payments − applied advances;
- recoverable agent advance = original plus correction differences − applications.

Independent SQL equations are compared with separately reduced exported rows before
saving. Family monetary controls reconcile independent SQL sums to serialized event
fields; reference measures such as revised amounts and handover requests are labelled
and must not be added to economic flows. Negative numeric paise retain a signed
integer CSV representation. Untrusted text uses the shared spreadsheet-formula
neutralization, quoting and embedded-newline handling.

The capture uses a single serializable MVCC source frame; its UTC cutoff preserves
PostgreSQL microseconds. Inclusive Kolkata days end at the following midnight.
Earlier rows are explicitly `opening`; in-period events are `period`. Opening and
closing positions are **period positions updated through capture**, including known
late/backdated corrections. They are not a reconstruction of what an accountant
knew at a historical date. Source occurrence and recorded times are distinct where
sources provide them. Later writes do not rewrite a saved capture.

Schema `1`, definition `accountant_register_v1` and mapping `generic_csv_v1` are
stored with the report. `capture_id` identifies the artifact, while `event_line_id`
is stable across captures and optional-reference choices. Source IDs, versions,
correction links and line discriminators identify economic events and revisions.
Some position/reconciliation source versions are projection digests because several
source records determine them. Never deduplicate by capture ID or append a full
snapshot as new journals. Preserve an import log; compare changed versions and
process explicit correction effects. Never replace an original sale with a statement.

## Limits, privacy and failures

At most 31 days, 50 explicitly authorized franchises, 5,000 **combined** event and
position rows, 100 preview rows/page, 8 MiB combined files/archive and saved payload,
20 active actor captures and 24-hour expiry. Receiving-account reconciliation capture
is additionally bounded to 50 accounts. Existing database statement/lock timeouts
apply. No partial bundle is saved on overflow, failed control, audit failure or
transaction failure. Serializable retry protects the active-capture quota under race.

Earlier supporting history counts toward the bound. A shorter period may not resolve
an oversized opening history. Reduce scope where meaningful; if a single franchise's
required history exceeds the limit, a reviewed storage/report partition remedy is
needed. Do not truncate history, fabricate an opening, or declare missing rows zero.

Names, phone numbers, addresses, raw statements and arbitrary import payloads are
not selected. Private external/payment/approval references are off by default and
require explicit opt-in. Reconciliation lineage has an explicit key allowlist;
source IDs/versions/amounts survive, raw import candidates and bank identifiers do
not. Access/capture/export audit stores identities and correlation, not CSV contents.
Stored artifacts are private; expiry and existing cleanup remove the payload while
retaining the command tombstone. Expired replay returns 410; read/download returns
404. Exported local files remain under the accountant's custody after download.

## Rollout and rollback

No schema migration or independent accounting ledger is introduced. Existing source
migrations through #146 and their runtime SELECT grants are prerequisites. In
particular the report reader needs SELECT on `financial_refund_evidence` as well as
the receipt, booking/document, cashbook, agent/COD and reconciliation source tables
and views it reads. It retains the existing narrow report snapshot INSERT, audit
INSERT and expiry payload-clearing privileges; no new source write privilege is
needed. Fresh/populated DB tests use the restricted runtime role, not owner reads.

Deploy the compatible API before the web entry point. Rollback removes the register
entry point/routes using the previous compatible code; retain source history and
existing artifacts for their normal expiry. Do not alter released migrations or
relabel stored v1 artifacts. New schema/mapping versions require new definitions,
fixtures and decoders. Generic export requires no target feature flag; qualified
software formats are unavailable until actual import plus accountant review.

Reproduce automated checks with the pinned toolchain: `pnpm db:local quality`,
`pnpm check:migrations`, and `node scripts/generate-accountant-review-pack.mjs --check`.
The [verification matrix](issue-150-verification.md) records actual evidence and
pending gates. #67/redesign/M7 must not start from a claim that this issue is closed.
