# GnuCash 5.17 fictional manual import pack

Mapping `gnucash-5.17-candidate-v1`. **Unqualified candidate. Actual import and
accountant review are separately pending.** No real customer or bank data belongs
in these files. Generic ShipIT CSV exports work independently of this pack.

## Version and files

The official macOS Arm distribution `Gnucash-Arm-5.17-1.dmg` was downloaded from
[the GnuCash 5.17 release](https://github.com/Gnucash/gnucash/releases/tag/5.17).
Its SHA256 is `adbc91d6d69a297c1c599ad2849303a06c01310130d355473c0700f80dd2eb32`.
The executable reports **GnuCash 5.17**, build **5.17+(2026-09-26)**; the bundle is
5.17-1. This verifies the executable version, not the CSV workflow. Record the
exact version/build/platform actually used for your manual import in RESULTS.md.

- `fictional-month.csv`: initial 20 transactions / 44 splits.
- `fictional-correction.csv`: three linked corrections / six splits.
- `fictional-source-events.json`: exact proposed journal mapping and event IDs;
  positive values are debits, negative values credits, all integer INR paise.
- `required-accounts.csv`: 14 full account paths, types and INR currency.
- `expected-controls.json`: source totals and transaction counts.
- `expected-balances.csv`: before/after expected balances and blank actual results.
- `import-log-template.csv`: immutable event identity, correction link, accepted
  file checksum and target transaction reference; fill only after actual acceptance.
- `SHA256SUMS`: hashes of the exact generated inputs and templates.

From the repository root, run `node scripts/generate-accountant-review-pack.mjs
--check` to verify the committed files. Run the same command without `--check` to
regenerate the fictional originals. Save filled evidence separately so regeneration
does not overwrite it. Decimal conversion uses integer arithmetic.

## Manual import

1. Create a **new fictional local book**, with default currency INR. Use no bank
   connection. Create the full account paths in `required-accounts.csv` with the
   listed types and INR commodity. No opening balances are needed. Save a backup.
2. Choose File → Import → Import Transactions from CSV, then `fictional-month.csv`.
   Use UTF-8, character-separated comma, double-quote quoting, **multi-split on**,
   date format `y-m-d`, decimal point, one leading header line skipped, zero trailing
   lines skipped, alternate-line skipping off. Turn **escape character off**.
   Leave the base account blank because each split has an explicit account.
3. Assign columns exactly: Date → Date, Number → Num, Description → Description,
   Account → Account, Deposit → Deposit, Withdrawal → Withdrawal. Repeated date,
   number and description belong to one multi-split transaction. Confirm the
   importer groups exactly 20 transactions and 44 splits. Do not skip errors.
4. Map every account explicitly to its full account path. Review every split in
   the preview and matcher. Confirm positive Deposit becomes a debit and positive
   Withdrawal becomes a credit for this chart. The official manual warns that
   column signs need verification. Cancel if this produces wrong balances, extra
   transactions, Imbalance/Orphan splits, or an unexpected currency conversion.
5. Complete the import only into the fictional book. Capture the import summary,
   transaction count and a trial balance. Compare every account with the initial
   column of `expected-balances.csv`; record actual paise and differences. Mark
   these 20 event IDs accepted in a working copy of the import log.

## Expected meaning and totals

Original sales gross is ₹2,150, comprising freight ₹2,100, CGST ₹25 and SGST ₹25.
One ₹1,000 sale is settled by separate ₹600 cash and ₹400 UPI receipts. A separate
₹100 freight charge is part of a ₹2,100 receipt whose remaining ₹2,000 belongs to
the seller as COD. The third sale is ₹1,050, paid by card. Actual receipts total
₹4,350; allocations total ₹2,150. Allocations never create another receipt or sale.

The card fee is ₹100 actual expense. An independently recorded ₹950 transfer clears
the remaining card balance to Bank; bank matching alone must not create that entry.
The ₹200 customer advance has a ₹50 actual return, leaving ₹150 liability. Seller
COD has a ₹500 remittance, leaving ₹1,500 liability. A ₹100 agent advance applies
₹50 toward a ₹120 fee expense. That fee is paid ₹30 initially and ₹40 later, leaving
zero fee payable and ₹50 recoverable advance. Initial total debits and credits are
both ₹12,510. See the files for all account balances rather than summing unrelated
sales, receipts, transfers and liability measures together.

## Repeat import and correction evidence

1. Save a copy of the imported fictional book. In that disposable copy, attempt the
   same initial file. Inspect the matcher and capture its actual duplicate choices
   before accepting anything. **No automatic ID deduplication is claimed.** Cancel
   duplicate transactions; record whether the matcher selected skip, add or update.
2. The safe manual procedure is an import log keyed by mapping version and immutable
   event ID. Exclude all 20 accepted IDs from a second import. The second accepted
   event set must be empty. Do not reimport a complete generic snapshot as a delta.
3. In the original fictional book, import `fictional-correction.csv` with identical
   settings. It contains a ₹100 charge reduction linked to sale 0001, an ₹80 actual
   refund linked to that sale, and a ₹10 correction of an incorrectly recorded
   refund amount linked to refund 0001. The correction restores the erroneous
   recorded effect; it is **not a new physical receipt or refund**.
4. Confirm 23 total transactions, with the three original sale event IDs each
   appearing once. Freight is now ₹2,000, net refund ₹70, customer receivables have
   a ₹30 credit, and Cash is ₹2,110. GST is unchanged because the reduction relates
   to the zero-tax first sale. All other balances match the after-corrections column.
   Correction debits and credits are each ₹190. Save target references in the log.
5. Attempt the correction file again in a copy; record actual matcher behavior and
   cancel duplicates. The import log must exclude these three already accepted IDs.

## Capture and review

Fill `RESULTS.md`, save completed balance and import-log copies, the two accepted
file hashes, import summaries, trial balances and representative split screenshots.
Include any importer settings saved by GnuCash. Keep evidence fictional and remove
local user names from paths/screenshots. A manual run is valid target evidence when
its version, settings, inputs and observed results are reproducible.

Then obtain a **separate genuine accountant review**, covering this exact mapping,
account recognition, GST treatment, document qualification, corrections and duplicate
procedure. Record a safe review reference and limitations. Target selection, CI,
serializer tests and a successful import do not constitute accountant approval.

This sample is single-currency and does not cover every tax jurisdiction/rate, a
statutory tax invoice or credit note, arbitrary third-party charts, unknown source
accounts, foreign exchange, opening legacy migrations or automatic bank settlement.
Statements, shipment documents, COD configuration, fee entitlement and reconciliation
matches are reference evidence, not additional journals. Production target mapping
remains disabled until the exact mapping and tested behavior are reviewed.
