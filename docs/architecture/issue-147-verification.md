# Issue #147 implementation verification

Date: 2026-10-12. Base: `82df0727f863b91563d96a99561fd44c4d9b4a2a`, with #145
merged. Branch: `issue-147-shipment-costs`. Pinned Node 22.23.2, pnpm 10.34.5 and
Python 3.12.14. No production deployment, customer data, provider calls or external sends.

## Focused automated qualification

The final focused PostgreSQL cohort passed twelve tests in 49.846 seconds with no failures,
skips, cancellations or TODOs. It exercised genuine revenue and applied gross fees,
missing-cost coverage, estimated-to-actual E/K history, source identity, concurrent
allocation attempts, lost committed replies, rollback and current role/scope denial.
It also covered linked native expense correction and capacity reconciliation, genuine
approved purchase-rate import, native microsecond boundaries, posted reductions/refunds,
HTTP CSRF/no-store/disabled replay and selectors. A populated migration 49→50 case
preserved existing monetary and physical evidence without inventing cost history. The
initial expanded attempt passed seven and failed two due to fixture funding and a
collection reference; corrected production-service fixtures passed all nine. The subsequent expanded cohort
also exercised 102 genuine booking choices, paging all 5,001 cost sources without duplicates,
a controlled limit for 5,001 relevant sources, and an empty narrow cohort unaffected by
unrelated source history. Partial and moved allocations retain eligible historical heads;
invalid import batches leave no partial sources. Raw SQL negative checks use the owner
pool to assert SQLSTATE rather than the sanitized test-administration wrapper. Initial
guard/assertion failures were repaired; the final twelve-case run passed with all owned
database resources removed. Logs retain unsuccessful diagnostic attempts.

Fourteen controlled-transport React cost tests plus three existing report tests passed.
They cover exact retry, stale navigation/pagination, scoped state clearing, form/native
source/CSV workflows, groupings, source detail focus restoration, export decoding and
explicit actual-zero native expense allocations. Date blur/value and Kolkata-to-UTC
conversion assertions passed. Web typecheck and targeted lint also passed. These React
tests are not evidence of a real database or native segmented browser date entry.

Six API validation tests also passed, along with API typecheck, focused lint and the
tenant-query AST gate. All 49 released migrations remained unchanged. This focused
cohort is not final release approval.

## Actual browser qualification

Chrome and the Codex in-app browser exercised production React/Vite and Fastify against
a disposable PostgreSQL 18.6 database through its limited runtime role. Synthetic sources
were created through production booking, tax, pricing, delivery-proof, agent-fee and applied
expense services. No shipment costs or report outputs were seeded. The fixture confirmed
two ₹100 tax-exclusive bookings; one contained two parcels and one applied ₹10 agent fee.

The initial report showed ₹200 revenue, ₹10 known actual cost and two incomplete bookings.
Source detail retained the native expense, effect, earning and proof references. A real
selector-query failure blocked the editor during the first pass; its missing SQL cursor
parameter was repaired and a fresh fixture confirmed both booking choices and the editor.
The auto-attributed per-delivery expense was excluded from manual expense choices.

A three-row synthetic CSV was uploaded, previewed and applied through the UI: ₹60 estimated
courier cost and explicit packing/payment not-applicable declarations, allocated to the
first booking. Its report showed ₹30 estimated contribution and unknown actual contribution.
The other booking remained incomplete, so aggregate contribution remained unknown. A form
revision changed that same courier source to ₹65 actual with a complete ₹65 allocation,
an explicit reason and the retained effective instant. The current report then showed
₹75 actual cost and ₹25 actual contribution for that booking; it counted revenue once
across the two parcels and retained the earlier estimate version.

Re-entering exact earlier E/K cutoffs `2026-10-12T18:26:08.564194Z` and creating a fresh
report reconstructed the original ₹60 estimate, version 1, and ₹30 estimated contribution
after the actual correction. This exercised retained evidence reconstruction rather than
merely redisplaying the old saved report. The actual-cost report was downloaded as CSV;
its two rows matched ₹100 revenue each, ₹75/₹25 actual cost/contribution for the complete
booking, and explicit unknown contribution for the incomplete booking. Source IDs were
present and private invoice/reason fields were absent. The downloaded file was 1,677 bytes,
SHA-256 `069da8ca3a3ce6b96abcbb409fc147e207ce112b1018cbbdb484ddcea0231d4a`.

Opening source detail focused its heading; closing restored the originating button.
A visible focus outline was observed. At 390×844, document width was 380px with no
horizontal overflow and wrapped cutoff text. Operator login exposed Delivery performance
without the financial shipment-cost workspace. Both browser tabs were closed, the viewport
override reset, Vite stopped and owned PostgreSQL resources removed afterward.

## Qualification limits

Fresh manual creation through the native date-time field remains unqualified in the actual
browser: supported automation displayed date segments but did not retain a controlled value
after blur. Inspection found no shipment-specific date wiring defect; this is not evidence
that native human entry fails. CSV creation and retained-time form revision were exercised.
Chrome's file-upload extension permission was unavailable; the in-app browser's supported
chooser completed the upload. A download-event observation timed out, but the resulting
file was independently located, read and checked. These limitations are not reported as
successful automation calls.

The first browser fixture classified a booking with one known and one unknown parcel
courier as mixed; the later correction to unknown is covered by automated regression.
Native zero-expense reconciliation, complete carrier-rate cases, all grouping switches,
concurrency, scope revocation and timestamp boundaries rely on automated evidence rather
than claims of browser coverage. A saved report
was not downloaded twice to establish byte immutability in this browser pass.

Full repository quality, independent review, exact PR CI and merged-main verification
remain separate release gates. This focused and browser evidence alone does not establish
release readiness.
