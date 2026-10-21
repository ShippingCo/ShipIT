# Issue #67 — cross-report reconciliation and provenance

Engineering evidence for [#67](https://github.com/ShippingCo/ShipIT/issues/67).
Started from freshly pulled main `17a9c9bbb11e8fb784751f43b3e12e246d49b372`
on `issue-67-report-reconciliation-verification`. The live prerequisite issues
#32, #62, #63, #64, #65, #66, #145, #146, #147, #148, #149 and #150 were each
verified CLOSED before implementation. Historical verification documents may still
show their earlier pending PR state; closure does not establish external qualification.

No new financial authority, metric, table, migration, permission or dependency is
introduced. Existing production services own every economic effect. The only
production change fixes ambiguous accountant CSV column names, described below.
The PR is to remain OPEN, unmerged, with auto-merge disabled; #67 remains OPEN.
Independent human review and all post-merge steps are not claimed here.

## Reproduce and locate evidence

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and running Docker, as in
[quality checks](../QUALITY_CHECKS.md). From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local demo:reconciliation
pnpm db:local quality
git diff --check
```

`demo:reconciliation` runs the integrated cycle plus the existing sales, ageing /
accounts, accountant, cash-close, reconciliation, shipment-cost, owner-summary,
agent-COD-remittance and e-way suites. It uses the normal guarded PostgreSQL runner,
strict result checking and registered cleanup. Missing PostgreSQL, failure, skipped
or cancelled tests and cleanup failures fail the command. It makes no customer sends,
bank calls, government calls or accounting-software writes. All data is fictional.
Normal `test:db` and every corresponding CI discovery path include the new file.

- [Integrated DB/API/worker tests](../../apps/api/test/database/report-reconciliation.test.ts).
- [Runtime-service source fixture](../../apps/api/test/report-reconciliation-support.ts).
- [Independent CSV decoder](../../apps/api/test/report-csv-support.ts).
- [Accountant header and exact-paise regressions](../../apps/api/test/integration/accountant.test.ts).
- [Reproducible demo runner](../../scripts/test-report-reconciliation.mjs).

Run IDs are disposable, generated UUIDs. Tests carry the returned IDs through their
source links; fixed fake UUIDs are not inserted as report answers. `first`, `second`
and `codBooking` name the three bookings; `bankReceipt`, `cardReceipt`, `upiReceipt`,
`cashReceipt`, `codReceipt` identify the five receipt sources. Original and revised
statements, adjustment decisions, cashbook effects, reconciliation import/match,
count/submission and scheduled run IDs are returned by their owning services.
Accountant rows carry stable `event_line_id`, `source_id`, `source_version`, family,
period basis and correction links. Capture IDs identify a view, not a new economic event.

## Time, authority and capture strategy

The integrated business day is the current **Asia/Kolkata** day; the monthly account
statement covers month start through that day. The pricing/booking fixture uses its
established injected 2099 clock. The disposable owner places only booking
`confirmed_at` timestamps into the chosen reporting calendar, transactionally restoring
triggers afterward. It also installs a synthetic reviewed e-way policy, grants the
same restricted workflow privileges as existing tests, and rearms the scheduler for
its correction test. No amount, balance, tax result, allocation, report or audit answer
is seeded or rewritten. Runtime-role write-denial assertions remain active.

Report captures use their own persisted transaction cutoffs and source versions.
There are no intervening economic writes between the initial comparison captures;
we compare overlapping definitions and windows, not assume different captures have
identical timestamps. The owner worker uses an injected next-midnight dispatch clock
to close the current day; source recording timestamps remain database facts. A late
approved reduction is deliberately recorded after initial captures. Old artifacts
retain their original bytes and source versions; new captures and the linked scheduled
correction reflect it. Current report-scope settings do not rewrite saved evidence.

A separate fixed month-end test places four bookings at
`2026-01-30T18:29:59.999Z`, `2026-01-30T18:30:00.000Z`,
`2026-01-31T18:29:59.999Z`, `2026-01-31T18:30:00.000Z`.
January 31 in Kolkata contains exactly the middle two: half-open local-midnight bounds,
200000 paise gross. Sales groups, API, CSV and accountant period rows select the same
IDs; the daily comparison sees 100000 on the prior day and February 1 selects the last.

Money assertions use exact decimal strings / `BigInt`. No float tolerance or rounding
allowance reconciles a discrepancy. General report CSV's formula-protection apostrophe
is decoded only for exact signed integers; accountant `_paise` columns preserve signed
integer values directly. Missing fields remain `unknown`, not numeric zero.

## Authoritative producers and independent expected amounts

All amounts below are **INR paise**, before the deliberately late 100-paise reduction.

| Source owner / returned fixture source | Persisted evidence / expected result |
| --- | --- |
| Booking, pricing and tax: `first`, `second` | Each original pre-tax 12800, taxable 12800, CGST 320, SGST 320, IGST 0, rounding −40, gross 13400; separate immutable policies/receipts |
| Booking, pricing and tax: `codBooking` | New approved fictional exempt treatment: pre-tax/gross 10000; two parcels; no invented statutory tax position |
| Financial workflow: `cancelled`, `refunded` | Independent operator request/admin approval; cancel second gross 13400, actual bank refund 2000; source decisions/evidence retained |
| Money receipts | Cash COD 210000, bank 10000, card 5000, UPI 4000, office cash 5000 = **234000**; exactly five stored receipts |
| Allocations | COD freight 10000, first booking bank 6000 + card 1000, second 2000 = **19000**; one receipt may cover multiple bookings |
| Advance / COD allocation owners | Unallocated customer advance **15000**; seller COD reservation **200000**; receipt conservation `234000 = 19000 + 15000 + 200000` |
| Accounts / statements | First due `13400 − 7000 = 6400`; cancelled second due 0 after refund; monthly statement and ageing **6400**; advance **15000** stays separate |
| Cashbook effects | Supplies expense 1000; fee expense 2000; card fee 100; total expense **3100**. COD remittance and agent advance are not expenses |
| Custody / handover | Agent receives 210000 cash, hands all 210000 to office; agent known held cash **0**. Handover is neither new receipt nor revenue |
| COD remittance | Seller reserved 200000, remitted 150000, remaining liability **50000**, independent of physical agent custody |
| Agent fee / advance | Fee earned 2000; cash paid 500; advance applied 500; payable **1000**. Advance issued 2000, recoverable **1500** |
| Cash close | Actual opening 10000; cash receipts 5000 + accepted handover 210000; outflows 1000 supplies + 150000 COD + 2000 advance + 500 fee cash; expected **71500**, counted **71000**, signed variance **−500** |
| Cashbook position | Drawer known recorded **61500**; physical opening 10000 is an observation, not an invented ledger entry. Thus close expected = 10000 + 61500 |
| Manual reconciliation | Card receipt 5000 − evidenced fee 100 = verified net **4900**; separate imported **700** remains unassigned. Duplicate file/import retries retain exactly two transactions |
| Shipment costs | COD freight revenue 10000 − actual courier cost 6000 = contribution **4000**; other three categories explicitly not applicable. First booking incomplete: combined contribution **null**, never invented zero cost |

Sales original gross is `13400 + 13400 + 10000 = 36800`. Approved cancellation
reduces gross by 13400, yielding **23400**. Adjusted pre-tax **22800** consists of
12800 taxable + 10000 non-taxable; CGST 320 + SGST 320 = GST **640**, IGST 0;
`22800 + 640 − 40 = 23400`. Collections applied to the booking cohort are **19000**;
actual receipts in the day are **234000**. Those intentionally different quantities
must never be forced equal. Actual refunds **2000** are not a second sales reduction.

The late approved discount reduces pre-tax/taxable by 100 with no additional tax
reduction. Fresh gross becomes **23300**, debt **6300**; the immutable first original
gross remains 13400. Old sales, accountant bundle, customer statement/export and
scheduled summary remain unchanged. The new summary links `corrected_from` to its
prior run and contains the new 6300 debt.

## Cross-report comparison

| Projection | Overlap asserted against independent source expectations | Different basis retained |
| --- | --- | --- |
| Sales / grouped GST | 3 booking rows; gross 23400, pre-tax 22800, GST 640, rounding −40, collections 19000, refunds 2000, debt 6400; original gross 36800 | Booking cohort plus append-only adjustments; COD goods excluded from sales |
| Daily dashboard | Gross 23400, tax-exclusive revenue 22800, receipts 234000, refunds 2000, debt 6400 | Collections by receipt occurrence, not allocation sum |
| Ageing / monthly statements | Due 6400, separate advance 15000, frozen account revision and both statement IDs | COD booking without due terms stays unknown, not fabricated overdue |
| Cashbook / cash close | Drawer ledger 61500, observed opening 10000, expected 71500, shortage 500 | Physical observation vs recorded funds; approval does not create balancing money |
| Reviewed agent statement | Captured source frame retained after independent approval; COD 200000/150000/50000, held cash 0, fee and advance positions from source owners | Seller liability, custody, fee payable and advance recoverable are separate |
| Scheduled owner summary | Same dashboard metrics; expenses 3100, held cash 0, cash difference magnitude 500, reconciliation exceptions present | Absolute discrepancy magnitude differs intentionally from signed count variance |
| Reconciliation | Verified net 4900, unassigned 700, immutable import/batch/source versions | External observed transaction evidence is not a new receipt |
| Contribution | COD 4000; incomplete booking and aggregate null | Not net profit; unknown costs are visible |
| Financial audit | Cancellation present; saved audit row detail matches its source-linked row | Read/export audit records are access evidence, not money mutations |
| Accountant generic register | Original sales 36800 plus separate adjustments; receipts 234000, allocations 19000, refunds 2000, cashbook expense 3100, COD reservation 200000 | Opening/period, position/reference/economic rows must not all be summed together |

Every accountant control must have difference **0**. CSV family identities equal API
row identities; per-family period control sums are recomputed independently from decoded
cells. Null fields are first checked against the saved API field before excluding them
from a numeric control; `unknown` is not converted into a made-up amount. Saved sales
CSV compares every money cell and total with the saved DTO. Cashbook, ageing, daily,
contribution, reconciliation and audit CSVs retain row IDs and capture metadata.
Cash-close CSV retains its independent review and −500 variance. Scheduled-summary
CSV recomputes all five financial metrics. Statement exports retain the exact statement.
Existing frontend suites verify these saved DTOs / authenticated downloads; no screen
or navigation behavior is changed by #67, and no new live-browser inspection is claimed.

## Isolation, failure and provenance

The new suite runs services, HTTP handlers, artifact reads and audit projection using
an actual restricted database runtime role, and separately inspects persisted source
counts/fee positions with the disposable owner. The runtime cannot edit receipts,
delete financial changes or rewrite snapshot rows. Existing producer suites retain
concurrency, stale expected versions, lost-COMMIT acknowledgements and rollback tests.

| Actor / case | Verified behavior |
| --- | --- |
| Franchise admin A | Capture/read/export, source and statement drill-through, restart/reload with identical saved response and `no-store` |
| Accountant A | Financial source read, register references opt-in, scheduled report/export, audit projection; own saved register denied after revocation |
| Organization admin | May capture authorized sales; CSV export denied 403 |
| read_only | Finance read and financial capture denied 403 |
| Sibling franchise B / unrelated organization C | Valid foreign IDs and random unknown IDs return the same 404 error code across sales, ageing, daily, accountant export, finance booking/statement and e-way; no private rows/counts/identifiers; own empty scope totals 0 |
| Revoked capture owner | Read, export, source drill-through and later page request denied 404 |
| Invalid dates, unauthorized scope list, mass assignment | Controlled 422/404; no stack or private resource details |
| Same key / altered valid filter | Conflict; same key/body returns exactly the original saved capture |
| Report access-audit insert failure | Transaction rolls back: snapshot count unchanged |
| Runtime report dependency failure | HTTP 503 `TEMPORARILY_UNAVAILABLE`, without SQL, stack, session token or contact phone |

Access evidence contains actor, tenant, snapshot, action and correlation. Public report
responses and captured logs are checked for fixture session token, customer phone,
address and optional private reference leakage. References appear only in the explicitly
requested accountant export and formula-like text is escaped. No credentials, plaintext
OTP, private customer payloads or raw bank imports are written to public evidence.

E-way tests preserve three distinct facts: supplied external validity is
`source_supported`, external verification remains `unverified_external`, and calculated
validity is `shippingco_estimate`. They disagree deliberately; neither overwrites the
other. Correcting distance leaves the old estimate and original external evidence
unchanged; an unrecorded booking stays `unknown`. History contains all three actions.
Existing e-way UI tests retain the explicit estimated/official labels.

## Defects found and compatibility

The independent CSV decoder exposed duplicate header names in two generic files:

- `agent_fees.csv`: common period `basis` collided with source fee `basis`.
  The exported source column is now **`fee_basis`**.
- `settlements.csv`: common export `capture_id` collided with source cash `capture_id`.
  The exported source column is now **`source_capture_id`**.

Both focused regressions failed before the corresponding fix. A bundle-wide check
requires unique headers even for empty family files. Source fields, stored rows,
shared DTOs, API preview, stable event IDs, controls and `generic_csv_v1` stay unchanged.
CSV generation maps the existing saved fields to the distinct header names; old saved
registers remain readable/exportable without migration. Previously downloaded ambiguous
files are not rewritten; consumers should use the new dictionary and re-download within
artifact expiry or create a new capture. These generic files have no qualified external
mapping to preserve. Rollback is compatible code rollback, with the known header defect
returning; it must not mutate or delete financial evidence.

## Acceptance map

PASS here means engineering verification, not external certification. Evidence abbreviations:
**cycle** = integrated test; **CSV/history**, **e-way**, **HTTP** = its named subtests;
**boundary** = fixed Kolkata month-end test. Producer paths are under
`apps/api/test/database/`; frontend paths are under `apps/web/src/test/`.

| # | Criterion | State / evidence |
| --- | --- | --- |
| 1 | Independent sales, tax and collections | PASS — cycle exact equations and persisted receipt totals; no revenue/cash conflation |
| 2 | Scoped report/source drill-through | PASS — HTTP matrix, audit detail; accountant control drill-through producer tests |
| 3 | Estimated vs official e-way validity | PASS — e-way subtest, `eway.test.ts` DB and existing UI tests |
| 4 | Filtered CSV / UI data across timezones | PASS — boundary IDs/groups/API/CSV, CSV/history money cells; existing UI saved-DTO/download suites |
| 5 | Configuration cannot rewrite history | PASS — new tax/pricing version, settings update, later approved discount; old capture/statement/summary equality |
| 6 | Cross-tenant export regression in CI | PASS — auto-discovered HTTP test and accountant actor/tenant tests |
| 7 | External processes explicitly excluded | PASS — boundaries below and generic manifest; no filing claim |
| 8 | Authorized reload/restart / reproducibility | PASS — new runtime pool/server reload and guarded demo |
| 9 | Sibling B / unrelated C denied | PASS — valid-ID vs unknown-ID HTTP/service matrix |
| 10 | Nested references and counts isolated | PASS — mixed unauthorized franchise filter rejected; source/statement IDs hidden, foreign captures empty; existing producer nested-ID tests |
| 11 | Malformed input controlled | PASS — HTTP invalid date/mass-assignment and accountant unit boundaries |
| 12 | Stale state controlled | PASS — existing cash-close opening/version, reconciliation source-version, sales/statement/accountant conflict tests included in demo/full quality |
| 13 | Dependency failures controlled | PASS — runtime fault returns safe 503; worker/producer failure regressions |
| 14 | No unauthorized partial mutation | PASS — snapshot rollback count; runtime write denials; producer transaction/fault tests |
| 15 | No sensitive error payload | PASS — HTTP failure/foreign response inspection |
| 16 | Logs/audit/API/browser privacy | PASS — cycle/HTTP projection checks plus unchanged auth/report frontend tests; no live-browser inspection claim |
| 17 | All ten owner modules reconcile | PASS — cross-report table, independently reviewed agent statement and real scheduled-worker run |
| 18 | 200000 seller COD + 10000 freight | PASS — freight revenue 10000, actual receipt 210000, COD liability reserved 200000 |
| 19 | Duplicate import/retry/month-end | PASS — exact receipt/statement replay, duplicate file import count 2, worker tick deduplication; existing races/lost-ack tests |
| 20 | Missing evidence remains unknown | PASS — due date unknown, contribution null, imported 700 unassigned, e-way unknown, shortage −500 retained |
| 21 | Strict tenant isolation | PASS — current runtime scope and role matrix |
| 22 | Immutable financial evidence | PASS — direct write denial, saved byte/DTO equality and linked corrections |
| 23 | Exact paise | PASS — string/BigInt equations, signed CSV and above-safe-integer accountant control regression |
| 24 | Current authorization / safe retry | PASS — own accountant/admin revocation, page/export recheck, same-key replay/conflict and producer uncertain-commit recovery |

## External responsibilities and remaining review

`generic_csv_v1` is the only enabled format; qualification stays `generic_only`.
The [#150 manual GnuCash 5.17 candidate pack](../fixtures/accountant/gnucash-5.17-candidate-v1/README.md)
is evidence preparation. **Actual target import and genuine accountant review remain
PENDING EXTERNAL REVIEW.** The existing generator check proves reproducible files,
not successful GnuCash ingestion or professional approval. #67 verifies truthful labels
and source reconciliation; it does not manufacture the separate external outcomes.

ShipIT does not file GST returns, issue statutory GST invoices/credit notes by inference,
create/cancel/extend government e-way bills, certify tax/legal compliance, authenticate
unverified external validity, import directly from bank APIs, or post external journals.
Operators/accountants perform filing, independent source verification and external
accounting review. Shipment contribution is not certified net profit; imported/matched
bank evidence is not automatic bank confirmation. M7/pilot release qualification (#76)
and commercial/provider work remain separate. No production deployment occurs here.

## Execution record

Final implementation checks on the pinned toolchain:

| Command / group | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; lockfile unchanged |
| `pnpm check:migrations` | PASS; all 55 released files unchanged |
| Focused accountant Vitest | 9/9 passed; both new header regressions failed before their respective fixes |
| Integrated PostgreSQL file | 5/5 passed; also included on final code in demo/full quality |
| `pnpm db:local demo:reconciliation` | 69 passed; 0 failed/skipped/cancelled/todo |
| `pnpm db:local quality` | PASS, exit 0; complete checks below |
| Quality harness | 41/41 passed |
| Testkit / DB unit | 22/22 and 12/12 passed |
| API Vitest | 776/776 across 61 files passed |
| Web Vitest | 375/375 across 43 files passed |
| Actual private object-store contracts | 3/3 passed; disposable object store removed |
| PostgreSQL schema / API | 91 across 42 files + 610 across 83 files = **701 passed**, 0 failed/skipped/cancelled/todo; disposable PostgreSQL removed |
| Planning, tenant-query lint, ESLint | PASS |
| Typecheck | All five workspace projects passed |
| Build | API TypeScript and web production bundle passed, 258 modules |
| `git diff --check` | PASS |
| `verify:gates` | Not run: optional in current workflow; no gate/harness enforcement changed |

Existing React `act(...)` warnings remain visible. The intentional failed/truncated
S3 upload cases emit non-retryable-stream warnings and pass their negative assertions.
No warning was suppressed or test skipped. Logs stay in ignored local `.codex` files;
public evidence contains synthetic facts and counts only. The final documentation-only
result updates are checked again with planning/link validation before commit.

The exact pushed head, all eleven remote checks (five quality jobs, five PostgreSQL
shards and the required aggregate), PR review and open/unmerged state are verified
at handoff. Branch protection requires the strict `Planning and prototype checks`
aggregate; independent human approval is not represented by automated checks.
