# Accountant target qualification proposal — candidate v1

Status: target selected by the user on 19 October 2026; mapping unqualified, unavailable in the production format selector.
Prepared 19 October 2026. No accountant review or application import is claimed.
This proposal does not replace #150's target-import acceptance criterion.

## Selected qualification target

GnuCash **5.17**, desktop CSV transaction importer, multi-split mode, local fictional
book in INR. This pins a concrete published stable release rather than promising
compatibility with all 5.x releases. No purchase, external account or bank connection
is needed for the proposed workflow. Actual accountant review
remains required before enabling or advertising a supported production mapping.

Official research: [GnuCash CSV import manual](https://www.gnucash.org/docs/v5/C/gnucash-manual/trans-import.html)
describes multi-split rows and date, account, deposit/withdrawal column assignments.
The [release announcement](https://www.gnucash.org/news.phtml) identifies 5.17.
[TallyPrime's official Excel import guide](https://help.tallysolutions.com/import-data-using-any-excel-file/)
is a realistic alternative with mapping templates; no Tally selection, access or
accountant-approved chart was supplied. The user selected GnuCash; no alternative target is being implemented.

## Proposed mapping `gnucash-5.17-candidate-v1`

All accounts below are fictional proposed masters, each denominated INR. These
journal treatment choices require accountant review; they do not establish statutory
invoice qualification or invent missing source evidence.

| Source | Debit | Credit | Qualification / correction treatment |
| --- | --- | --- | --- |
| Booking original gross | Assets:Customer receivables | Income:Freight for saved pretax; Liabilities:CGST/SGST/IGST for saved components; Income:Rounding for saved signed rounding | One booking transaction; no statutory invoice claim; saved non-taxable component remains separately identifiable |
| Actual money receipt | Assets:Cash, Assets:UPI clearing, Assets:Card clearing, or Assets:Bank by saved method/account | Liabilities:Customer advances | One receipt regardless of number of allocations |
| Valid allocation | Liabilities:Customer advances | Assets:Customer receivables | Allocation application date; links existing receipt and booking; release reverses this pair |
| Legacy allocated collection | Saved asset method, or Assets:Unclassified receipts if account provenance unknown | Assets:Customer receivables | Do not also import as modern receipt; legacy reversal reverses pair |
| Approved charge reduction | Original freight/tax/rounding accounts using approved component reductions | Assets:Customer receivables | Distinct correction event linked to booking; not automatically a statutory credit note |
| Actual booking refund | Assets:Customer receivables | Recorded payment asset | Only actual-return source; correction reverses recorded effect and is not another physical transfer |
| Unused advance return | Liabilities:Customer advances | Recorded payment asset | Actual return only, not request/approval |
| COD reservation | Liabilities:Customer advances | Liabilities:Seller COD | Never freight income; reversal releases reservation |
| Seller remittance | Liabilities:Seller COD | Recorded payment asset | Actual applied remittance; never silent fee deduction |
| Applied ordinary expense | Expenses:Approved category | Recorded payment asset | Signed correction difference, not full replacement amount |
| Fee expense with advance application | Expenses:Agent fees (gross) | Assets:Agent advances (applied) and payment asset (cash paid) | Fee entitlement is reference-only; one expense |
| Later fee payment | Liabilities:Agent fees payable, if recognized by the approved chart | Payment asset / Assets:Agent advances | Requires accountant approval of recognition policy; do not infer a second expense |
| Agent advance | Assets:Agent advances | Payment asset | Not expense until applied under approved policy |
| Acknowledged custody transfer | Destination asset/custodian subaccount | Source asset/custodian subaccount | No collection, revenue or expense |
| Reconciliation and net card batch | No journal by matching alone | No journal by matching alone | Actual independently evidenced fee is expense; clearing settlement requires approved source transfer evidence; unmatched credit remains unresolved |
| Statements, documents, controls, review/approval | No journal | No journal | Reference only; statement revision creates no sale/debt |

`Date` maps occurrence/application date in Asia/Kolkata, serialized `YYYY-MM-DD`.
`Number` is `SIT-<family>-<stable-source-id>-v<source-version>`; `Description` uses the
same identity and the record kind. `Account` is the exact approved full master path.
`Deposit` and `Withdrawal` are non-negative decimal INR with two digits, converted
using integer quotient/remainder; only one is populated per split. No float or
spreadsheet formula is used. All transaction splits must balance exactly.

The synthetic candidate CSV uses fixed safe identifiers only. Production user text
and external references are excluded from target fields pending validation of the
importer's treatment of formula-neutralized text. Generic exports retain their
existing spreadsheet safety. Unknown tax, source account or qualification must
block the affected target transaction for review; never choose an income account
merely to balance an unexplained difference.

## Identity, revision and reimport procedure

The CSV importer is not claimed to deduplicate by ShipIT's event IDs. Maintain an
accountant-reviewed import log keyed by organization/franchise/family/source/version,
including the target transaction reference and file checksum. Before importing,
exclude already accepted immutable events. Import only genuinely new correction
entries; never reimport a complete snapshot as though it were a delta. Statement
reissues and matching changes are excluded. Saved generic captures keep their original
schema/mapping. A changed approved mapping must get a new version and separate fixtures.

## Fictional validation and review evidence

The [manual import pack](../fixtures/accountant/gnucash-5.17-candidate-v1/README.md)
contains the exact input files, required accounts, settings, source totals, expected
trial balances, correction/reimport steps and a separate results/review template.
The generator checks balanced integer-paise splits and fixed source controls.

Verified executable: GnuCash 5.17, build `5.17+(2026-09-26)`, macOS Arm bundle 5.17-1.
Actual import remains pending: desktop-control failed before the importer. The user
explicitly accepted manual verification as the alternative. Genuine accountant review
is separately pending. The candidate serializer is limited to fictional review files;
the production selector exposes only generic CSV v1. No software compatibility claim
or #150 closure is authorized by this pack.
