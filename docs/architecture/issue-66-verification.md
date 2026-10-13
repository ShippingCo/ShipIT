# Issue #66 implementation verification

Implementation base: `00c4208c950a0c166ef94687cec0c35d3126dd15`, after #147.
Branch: `issue-66-versioned-settings`. Qualification uses pinned Node 22.23.2,
pnpm 10.34.5 and Python 3.12.14. Final commit, full quality gate, independent
review and CI are pending; this record does not authorize production activation.

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

## Completion gates and limits

Full pinned quality checks, final-head independent review, required PR CI, branch
protection verification, protected merge and main verification remain pending.
Collection-clock activation, production operating-calendar approval, downstream
report sending and unresolved account-terms policy remain outside this change.
See [operator guidance](settings-operations.md) for consumer boundaries and rollback.
