# Issue #145 implementation verification

Date: 2026-10-12. Base: `ddfe64ec5388df4c2c13d11640b205d1267fd865`, with #144
merged. Branch: `issue-145-cash-closing`. Node 22.23.2, pnpm 10.34.5 and Python
3.12.14. No production deployment, real data, provider calls or external sends.

## Focused qualification

The real PostgreSQL 18.6 batch ran all nine API closing cases in one file under the
existing 180-second per-file guard, plus the populated upgrade and six migration
integration cases: **16 passed, zero failed/skipped/cancelled/todo**, 54.214 seconds.
The disposable registry and container were cleaned. Evidence sources are genuine
receipt, approved expense and acknowledged handover producers, never substituted
source views or precomputed report totals. Cases cover:

- Opening + receipt − expense, shortage retention, exact accepted physical carry,
  no source-capacity mutation, native cutoff and equal-boundary behavior.
- Immutable count/submission/review/reopen, sole-admin acknowledgment, current admin
  revocation, counter/submitter binding and departed-observer recovery; HTTP CSRF.
- Late prior-window evidence, source-only and changed-carry corrections, stale review
  conflicts and immutable descendants with linked dependency notices.
- Concurrent open/count/review/reopen, direct runtime forgery denial, rollback,
  lost committed response and exact replay after write disablement.
- Historical pending/partial handovers unaffected by future acknowledgments; each
  actual movement has one sender outflow and recipient inflow.
- 101-row retained paging, private frozen exports and ownership/revocation; 5,001
  genuine receipts fail the storage bound atomically without a truncated count.
- Real populated migration 48→49 retains prior source rows exactly, introduces empty
  closing tables with no implicit runtime grants and then migrates as a no-op.

Five API schema tests passed. Eight controlled-transport React tests cover arithmetic
and ownership decoding, exact uncertain retry/navigation, sole-admin labeling, actual
successor form submission, download navigation, administrator recovery and finance
read-only forms. These mocked transport tests are not database or browser evidence.
Workspace typechecks and lint passed. Migration history verified all 48 released files
unchanged. The governed prototype inventory explicitly registers the eight reviewed
regressions and bounded listener/object-URL effects without weakening a gate.

Earlier local failures are retained under `.codex/logs`: a missing test resource registry,
a migration composite-FK mismatch, the expected generic migration count, two unused
locals and the new governed inventory entries. Their repaired focused checks passed;
these failures are not presented as successful runs. Final full quality, independent
review, PR CI and merged-main gates are owned by the release coordinator and remain
separate from this focused evidence.

## Actual browser qualification

A bounded loopback fixture used production React/Vite, Fastify and isolated runtime
PostgreSQL with fictional source records. Codex IAB and Chrome exercised the actual
UI/API; no mocked fetch was used for these checks.

An independent administrator approved the operator's ₹5,000 physical count against
₹1,000 opening + ₹5,000 receipt − ₹800 expense = ₹5,200 expected. The ₹200 shortage,
both retained sources and separate ₹4,200 source-ledger position remained visible.
Keyboard Return submitted the review; the focused button had a visible blue 2px
outline. At 390×844, document width was 380px with no horizontal overflow.

The operator opened a successor, counted/submitted ₹5,000 with zero new turnover
and zero current variance. Its opening referenced the exact approved predecessor;
the old ₹200 shortage remained separate. Operator controls excluded review, reopen
and export. The administrator reopened the original session to version 5 while
preserving its original accepted submission, count and independent review/reason.
The browser did not approve that replacement; the PostgreSQL cases cover replacement
approval and dependency propagation. Sole-admin behavior was tested in PostgreSQL
and controlled React transport, not claimed as an actual browser journey.

Chrome downloaded the closing CSV. The actual file contained header + physical count
+ receipt/expense rows, correct opening/count/expected/cutoff/approval references and
formula-safe negative variance. CUA's download-event wait timed out even on the successful
file; filesystem bytes confirmed the result. No saved screenshot artifact is claimed.

Browser testing found two defects, repaired and then reverified: open version zero
incorrectly used update-only intent metadata; and the download read temporarily
activated the mutation navigation guard, blocking its own blob anchor. The API body
retains expected version zero, synchronous intent failures are visible, and scoped
read downloads no longer acquire the mutation navigation lock. Both fixes now have
controlled form/event regressions. Fixture database and servers were cleanly stopped;
temporary tabs were closed and viewport restored.

Owner operation and role rules are in [financial operations](financial-operations.md).
Rollout keeps `CASH_CLOSE_ENABLED` off by default; authorized reads and exact committed
replay remain available when disabled. Apply migration/grants only in an independently
authorized environment. Preserve released schema/history and repair forward.

## Full-gate migration expectation repair

The first full gate at `2934abd` passed 709 API tests, 298 web tests and the three
real object-store cases, then failed 34 schema upgrade cases. Direct attachment
reproduction showed the historical 19→current upgrade applied 30 migrations while
the test still expected 29. This was an omitted expected-count update, not a reason
to weaken the upgrade tests or modify released migrations.

The repair updates 45 unrestricted upgrade expectations across 31 schema and 11 API
files for current total 49. Historical partial installs, isolated test directories,
no-op counts, snapshot equality, rollback assertions and test deadlines are unchanged.
Two synthetic forward-repair filenames now sort strictly after migration 49. The
API upgrade cases were included proactively because the failed schema group prevented
the first full run from reaching the API database group. No production code changed.

The exact 45 affected registered upgrade cases passed together in 54.377 seconds,
with zero failures/skips/cancellations/todos and clean resource/container teardown.
The earlier full gate remains a failed run; release qualification requires a new
complete gate on the repaired commit.

## Agent clock diagnostic and repair

The second full gate at `35d939f` passed709 API tests,298 web tests, three object-store
cases and84 schema cases across36 files, then failed the existing advance-history
and101-row statement-pagination API database cases. Both files passed a direct
five-case diagnostic; a bounded five-pair repetition of the two exact cases also
passed10/10 with paired source/cutoff clock observations. The original aggregate
cause therefore remains unproven; a passing retry was not treated as a repair.

Deliberate100ms host-behind probes reproduced two concrete modes. A host-derived
first advance cutoff preceded the actual native earning recorded time, correctly
returning zero earned fees where the fixture expected4000paise. Separately, the
production statement list rejected its own PostgreSQL-issued next-page cursor as
`VALIDATION_FAILED` because it compared that cutoff to host `Date.now()`. Both
diagnostics retained their original money, history and pagination assertions.

The advance fixture now takes its before/equal/later occurrence boundaries from
database time strictly after native earning chronology, preserving causal rejection
and timezone-equal acceptance. The production cursor compares future cutoffs against
the same owned database clock used to issue them. A real101-row regression forces
the host clock100ms behind the issued cursor, verifies unchanged page2, and separately
rejects a true-future cursor; existing foreign-actor denial remains intact. No source
producer or released migration changed, and no timeout or assertion was weakened.

The repaired two-file PostgreSQL run passed5/5 in8.559seconds with zero
failures/skips/cancellations/todos and clean teardown. API typecheck and whole
lint/tenant-query checks passed. The next complete gate must qualify this repair;
these diagnostics do not establish a successful full run. Local diagnostic logs are
`quality-agent-diagnostic.log`, `quality-agent-clocks.log`, `quality-agent-skew-red.log`
and `quality-agent-clock-repair.log` under `.codex/logs`.
