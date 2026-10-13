# Issue #66 implementation verification

Implementation base: `00c4208c950a0c166ef94687cec0c35d3126dd15`, after #147.
Branch: `issue-66-versioned-settings`. Qualification uses pinned Node 22.23.2,
pnpm 10.34.5 and Python 3.12.14. The initial implementation commit
`f6c24a4f098d86747d223911c0c8647816a17208` passed full quality and PR CI.
Independent review requested two repairs; final repaired-head qualification remains
pending. This record does not authorize production activation.

## Focused backend qualification

The consolidated settings cohort passed **14/14** real PostgreSQL tests in
29.371 seconds, with zero failures, skips, cancellations or todo cases. It uses
a disposable database and limited runtime role. The owned container was removed.
The execution log is retained locally as `.codex/verification/settings-db-6.log`.

- Nine settings cases cover unconfigured state, organization defaults, local
  overrides, explicit clearing, per-key source versions, current role and tenant
  authority, financial references, report options, concurrent version conflict,
  exact canonical retry, changed-body rejection, lost commit and atomic rollback,
  strict HTTP boundaries, and disabled-write/lifecycle behavior.
- Three consumer cases prove accepted source IDs follow new quotes, bookings,
  Sales and contribution snapshots; stale or foreign suggestions fail; completed
  report retries and old quotes retain their original meaning. Revoking a selected
  franchise denies the whole saved report read/export. Settings edits preserve
  accepted close counts, decisions, receipts and effects. Current reviewer controls
  remain identical except for the naturally advancing read-time timestamp.
- Two schema cases exercise direct database guards and a populated migration from
  released migration 50 to 51. The upgrade creates a real booking, check-in/custody,
  issued receipt and Sales snapshot through owning services. Profile, quote,
  booking, receipt, report, parcel and lifecycle-event rows remain byte-identical
  after migration and an explicit synthetic calendar edit. No settings are
  backfilled. Direct writes must satisfy typed shape, tenant/actor authority,
  financial-reference ownership, source provenance, server time and atomic receipt
  constraints.

The final API validation suite passed **15/15** tests (`settings-unit-final.log`),
including the settings-version audit filter. A broader focused API boundary cohort
passed **95/95** tests before that final audit-filter assertion. Focused lint passed. A development migration check confirms all **50 released files are
unchanged**; only the new forward migration is added. These focused results do not
replace the final complete quality gate.

Earlier diagnostic runs are preserved: the first extended cohort passed 11/12
because a close read-time timestamp was incorrectly compared for equality; the
next passed 12/13 with an invalid check-in fixture identifier; the targeted follow-up
passed 4/5 with an incorrect lifecycle-event primary-key column in the evidence
query. The corrected consolidated cohort above passed without weakening immutable
source assertions.

## Browser and frontend qualification

The frontend regression cohort passed **83/83** tests; final settings/operator
navigation checks passed **37/37**. After the browser-discovered wrapping repair,
all **16/16** settings tests passed again. Web types, lint and governed planning
checks passed (293 declarations and 17 negative controls).

Actual production React/API browser checks used synthetic service-created data:
organization identity save/reload, franchise inheritance, explicit local override,
clear-to-inherit, immutable history and two-tab version conflict all passed. The
conflicting draft and reason survived reloading current settings, with an explicit
rebase action. Calendar state stayed unconfigured with its unavailable-clock warning.

Chrome verified native receiving-account/method choices against the owned revision
and allowed only the currently granted franchise in report-scope selection. Saving
that preference did not capture a report; explicitly accepting it in Reports showed
the exact saved source ID. Native unsaved-navigation confirmations were observed,
and cancelling both a link and browser Back preserved the draft. Editor headings
received focus.

At 390 pixels, actual browser inspection found three long action buttons overflowing
their cards. The settings-only wrapping repair preserved focus styling. Rechecking
found no button overflow (viewport390, document width380), and rendered text/actions
remained readable.

Graceful fixture shutdown proved byte-identical historical quote, booking, issued
receipt and saved contribution rows: before/after SHA-256
`7904e366c7cc3b28cbdbe84752448e85869299f715e279cb26e292a377f26497`.
The API runner exited successfully and removed its owned database resources.

Browser automation limits: the in-app browser stalled around a native confirmation;
its warning and narrow-layout attempts were not counted as passes. Chrome supplied
the successful native-confirmation and responsive evidence above. Browser dialog
APIs also stalled there, so the supported native Chrome controls were used. Its
disposable tab/group was closed; cleanup of the stalled in-app tabs could not be
confirmed. Live lost-response injection was not browser-qualified; focused React
and PostgreSQL tests cover exact retry and authority invalidation.

## Full gate and independent review

At initial head `f6c24a4f098d86747d223911c0c8647816a17208`, both
`pnpm check:migrations` and `pnpm db:local quality` completed successfully. The gate
passed 40 tooling, 22 testkit, 12 DB-unit, 731 API-unit, 340 web and 3 actual-S3 tests.
PostgreSQL passed 87 schema tests across 38 files and 568 API tests across 74 files:
655 integration cases, with zero failures, skips, cancellations or todo cases.
Planning, lint, tenant AST, typechecks and both production builds passed. Owned
PostgreSQL and object-store containers were removed. Logs are retained locally as
`.codex/logs/final-migrations-f6c24a4.log` and `final-quality-f6c24a4.log`.
All 11 jobs in [PR CI run 38356120793](https://github.com/ShippingCo/ShipIT/actions/runs/38356120793)
also passed at that head.

Independent review of all 104 changed paths requested changes after reproducing
two P2 defects: cancelling a settings departure overwrote the destination history
entry, and noncanonical timezone spelling passed API validation but failed the
SQL guard as a repeatedly uncertain HTTP503. The original independent probes and
report remain under `.codex/reviews/`. Separate concurrency, option pagination,
current authority and late-result purge probes passed; a focused frontend cohort
passed 43/43. The repairs use React Router's data-router navigation blocker to preserve history
entries and a shared timezone parser plus a case-insensitive PostgreSQL catalog
preflight before any settings writes. Accepted spelling and completed command results
remain stable; unsupported catalog values return a correctable validation error.
The collection-calendar policy boundary remains exact Asia/Kolkata.

Repair qualification passed 32 API unit tests, 12 PostgreSQL tests and 78 focused web
tests. Web/API types, targeted lint, tenant AST, migration history and planning passed
(298 declarations, 17 negative controls). Permanent regressions cover cancelled
Back/Forward, saved URL/key/state and history index, cancelled push/replace, retained
uncertain retries, all three editable timezone families, aliases/casing and correctable
422 recovery without partial state.

Actual Chrome verification repeated native Back and Forward cancellation, subsequent
acceptance, the exact saved Sales snapshot URL and totals, and retained settings draft
and reason. Invalid timezone input remained editable; corrected `asia/kolkata` saved
as version 1 and survived reload. Historical quote/booking/receipt/report rows retained
SHA-256 `141a3da97ff03bb5715549b2151c13253695a13ca617404d9d186a5d4e1b27b4`.
The repair browser tab was closed and its fixture/server resources were stopped and
cleaned. Detailed evidence is retained as `.codex/verification/browser-repair-results.md`.
Focused independent revalidation and the final repaired-head full gate remain pending.

## Completion gates and limits

Final repaired-head full quality, independent approval, required PR CI, protected
merge and main verification remain pending.
Collection-clock activation, production operating-calendar approval, downstream
report sending and unresolved account-terms policy remain outside this change.
See [operator guidance](settings-operations.md) for consumer boundaries and rollback.
