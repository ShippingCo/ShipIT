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

## Residual canonical timestamp assertion and closing checklist

The third full gate at `a4f845b` again reported only the advance-history API case
after all84 schema cases passed. The unchanged case reproduced immediately in a
representative two-file cohort at the required concurrency2. Its detailed assertion
was expected `2026-10-12T16:39:27.410Z`, actual `2026-10-12T16:39:27.41Z`: the
existing public instant formatter intentionally trims trailing fractional zeros.
This concrete fixture string mismatch is separate from the prior clock-skew probes.
The committed privacy-preserving aggregate reporter remains unchanged.

The fixture now selects database10ms boundaries to guarantee trailing-zero input,
checks canonical normalized ISO equality and checks native PostgreSQL timestamp
equality for the persisted request. Before/equal/timezone-offset/later funding and
all money assertions remain intact. Ageing, advances and cash-attribution files ran
together at concurrency2:8/8 passed in8.690seconds with zero failures/skips/cancellations
or todos and clean teardown. Logs retain both red cohort and repaired cohort results.

Final scope review also identified the missing explicit closing checklist. The view
now derives opening, physical-count, source/coverage, explanation, submission and
approval states from existing server evidence. It distinguishes available source
evidence from human review, prior approval from pending replacement work, and saved
approval from current late-evidence reconciliation. It introduces no persistent
checkbox or new approval policy. Two focused React cases cover submission/stale
transitions and reopened/approved-late states; all10 closing React cases and all
workspace typechecks passed. The governed inventory registers the two new cases.
Prior actual-browser qualification remains valid for its recorded workflow; this
checklist addition is qualified here by controlled React evidence, not a new browser
claim. The first-opening observer restriction remains visible for independent policy
review; this addition does not expand or reinterpret that rule.


## Independent review repair of initial opening evidence

At `1ad012a`, required local quality and all eleven PR174 CI checks passed. Independent
review nevertheless reproduced two P2 acceptance defects: the initial observer monopoly
blocked ordinary shifts, and incorrect initial amount/time had no correction path. The
prior gate success does not qualify the repair. Saved specification section28B supersedes
that earlier ownership restriction; the prior verification record above is historical.

The grouped repair removes that monopoly while retaining counter=submitter. It adds
initial-only append-only opening revisions and optional separate opening approval. A
combined approval still checks both unreviewed observation authors. With two admins,
B can approve A's opening, then A can approve B's ending; final decisions retain the exact
opening approval used. Revised openings require fresh capture and approval, while old
accepted counts, signatures, exports and descendant physical carry remain retained.
Opening/source-only corrections flag provenance changes without inventing money.

Three new real PostgreSQL cases passed together in3.452seconds, zero failures/skips,
with registered resource and container cleanup. They cover admin opening/operator ending,
two-admin cross-review, exact revision and approval binding, counter-laundering denial,
before/after-approval amount/time repair against genuine receipt/expense boundary facts,
stale input conflicts, frozen CSV/history, unchanged source capacity and downstream ending
carry, current admin revocation, explicit sole-admin opening review, competing revisions
and rejection without opening approval. Twelve controlled React/decoder tests passed,
including both new actual-form command paths and stale/pending opening checklist state
while prior accepted closing evidence remains retained. These are controlled transport
checks, not actual-browser evidence. Changed-browser and final full-gate qualification
remain pending at this stage; logs are retained under `.codex/logs/opening-repair-*`.


Final grouped focused checks ran all12 closing PostgreSQL cases in one file, the populated
48→49 upgrade and six migration-runner integration cases: **19/19 passed**,54.990seconds,
with zero failures/skips/cancellations/todos and clean teardown. This includes a first-session
A-opening/B-ending path with exactly two admins, disabled exact opening-review replay,
cross-session opening-ID denial, and the approved predecessor author independently reviewing
a different successor counter. The guard explicitly limits unapproved-opening author checks
to initial sessions; historical predecessor authors add no review ban. Combined approval also
labels its opening review according to that opening's author, separately from any ending
self-review. The existing HTTP departure case verifies independent opening approval alongside
explicit sole-admin ending self approval.

A final eligibility check found the UI used approval eligibility for rejection too. The
server now returns separate rejection eligibility based on the ending counter/submitter;
the decision selector uses that mode. A fourth new PostgreSQL case confirms the opening
author may reject another counter while combined approval remains forbidden and opening
approval remains absent. The four changed repair cases then passed4/4 in4.915seconds with
clean teardown. All13 closing React/decoder tests, six API rule tests and five workspace
typechecks passed. Current role/scope, explicit acknowledgment, exact identity/version,
frozen sources and money assertions were retained; no timeout or assertion was weakened.

Actual Chrome qualification used loopback production React/Fastify and disposable runtime
PostgreSQL, seeded with synthetic sources/actors but no closing sessions. A created the
operator's opening; the operator counted/submitted₹5,000 and B independently approved
₹5,200 expected with₹200 shortage. B reopened and corrected opening amount/time from
₹1,000 to₹2,000, then recaptured the same ending:₹6,200 expected,₹1,200 shortage and
unchanged₹4,200 source-ledger position. A approved the replacement. The original count CSV
was downloaded before correction and again from history afterward: both files were exactly
1,891bytes and byte-identical, retaining original source/count/approval references.

In a separate two-admin drawer, A corrected an initial₹900 to₹1,000 before any count;
B separately approved that opening and counted/submitted₹1,000, then A independently
approved B's ending with B's exact opening-review reference. No third admin was required.
At390×844 the expanded correction form had client/scroll widths380px, readable wrapped
labels and a visible keyboard focus ring on its save button. The draft was not submitted.
The root coordinator stopped both servers, removed the disposable container, closed the
browser tab and restored its viewport; unrelated containers were preserved.

This browser batch did not repeat sole-admin, rejection-selector, race, source-boundary
or downstream-carry cases; those are automated coverage. Final guard/label refinements
were qualified by the focused tests afterward. No screenshots, production activation or
successful final full gate are claimed. Durable local browser notes are the coordinator's
`.codex/verification/issue-145-browser-repairs.md`; required full quality, PR CI and fresh
independent re-review must qualify the new committed head.

Final lint/tenant-query and planning/contract/inventory checks passed, and all48 released
migration files remain unchanged. The final inventory check initially reported the new
rejection regression appended out of its required source order; the reviewed disposition
was reordered to match the inventory and the gate passed. That local failure log is retained.
