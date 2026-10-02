# Issue #50 working record

## Recovered context and base (steps 1–3)

- Clean main at `cdbf6d0`; fast-forward pull confirmed current origin. Local branch
  `issue-50-human-handoff`; no commit/push/deployment authorized.
- #48 closed/merged PR #133; #49 closed/merged PR #134. Recovered final summaries
  from “Solve issue #49” and “Research Milestone 4”. Planning recommendations are
  not approvals. #49 is present, but not a prerequisite of #50.
- Actual #50 prerequisites #16/#38/#39/#46/#47 are closed. M4 is milestone 5,
  issues #46–#52; #51 languages and #52 measures remain outside this implementation.
  #50 has no comments. Its blocked label is stale evidence, not a missing dependency.
- Existing conversation row is unique by installation/keyed channel; turns are
  immutable safe receipts. Inbox carries encrypted source content; outbound owns
  retries, uncertainty and dispatch policy. Installation locks coordinate both.
- Existing HUMAN pause expires after 15 minutes and creates no case. Replace only
  when handoff enabled; active cases must survive that expiry and RESUME.
- R22 reads: org admin, franchise admin, operator. W28 writes: franchise admin and
  operator. No invented support role. Assignment must validate active local membership.

## Research/design and acceptance plan (steps 4–6)

Use additive cases, immutable events/private entries, command receipts and a partial
unique active-case index. Open → claimed → resolved; assign preserves ownership,
reopen requires reason and no other active case. Expected revisions reject stale
actions; scoped request keys replay results. State/event/reply reservation commit
together. Case creation and send reservation follow root/installation lock order.

HUMAN/HELP and unknown intent create/update one active case per conversation; repeated
requests update source/context without repeated acknowledgments. Use only validated
shipment bindings and safe turn summaries; never expose raw inbox bodies or codes.
Owner replies are case-bound, encrypted and sent through existing outbound worker;
internal notes never become customer messages. Closed service windows are visibly
blocked; no unqualified template. STOP wins. Resolve releases bot; reopen pauses it.

Configured franchise hours describe availability, never guarantee a response deadline.
Missing staffing/hours produces an explicit unavailable/unknown expectation. Queue UI
includes loading/empty/error/permission states, claim/assign/reply/notes/resolve/reopen,
saved history, revision conflicts and uncertain command retry.

Research: [AWS safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
supports atomic request receipts; [PostgreSQL 18 partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html)
supports active-only uniqueness. These are applicable to the installed raw SQL/pg
stack without new infrastructure. Engineering judgment: serialize through existing
installation locks and use blocked state instead of inventing provider templates.
Meta send-message documentation returned HTTP 429; reuse #38/#39/#49 policy rather
than infer changed rules. No live provider qualification claimed.

Acceptance mapping: duplicates/unknown → signed inbox DB tests; claims/history/reopen
→ transaction/concurrency tests; bot suppression/consent/window → outbound tests;
scope/notes/privacy → A/B/C API+DB tests; persistence/migration → restart/upgrade tests;
staff usability → component and browser flow; malformed/stale/failure → focused negatives.

## Environment and verification (steps 7–8)

Pinned Node 22.23.2/pnpm 10.34.5/Python 3.12.14 via existing ignored
`node_modules/.cache/issue35/run.ps1`. Docker path included there. Database harness
has bounded parallelism for isolated databases, explicit Windows process deadlines;
never run two mutating suites against shared state. Run focused checks before broad
quality; save long logs locally. Prior #49 results are context only.

Implemented: migration 34; `apps/api/src/modules/support`; conversation/outbound
integration; production `/business/support`; focused API/DB/UI tests and operations
guide. New cases are default-off. Existing active cases remain paused even when new
case creation is disabled. No dependency or runtime/test deadline was changed.

### Acceptance evidence

| Acceptance criterion | Local evidence |
| --- | --- |
| Repeated requests → one active case | Signed HELP repetitions, active unique-index rejection, persistent case after selection expiry/restart. |
| Unknown intent without duplicate spam | Unknown messages join active case with no extra acknowledgment; new unknown question after resolution creates one new case. |
| Concurrent claim → one winner | Two staff sessions race revision 1; one success and one rejection. |
| Bot does not conflict | Previously queued answers suppress at dispatch; HUMAN case survives RESUME, expiry and creation kill switch; resolve restores tools. |
| Staff reply outside window | Explicit blocked state at enqueue and expiry rechecked before dispatch; no provider call or invented template. |
| Truthful staffing | Unit tests cover local opening/closing/weekend boundaries, unavailable/unknown hours and invalid configuration. |
| Cases/notes private | A/B/C list/detail/command denial, read-only/anonymous denial, foreign assignee denial; encrypted notes never appear in sends/logs. |
| Resolve/reopen actor and reason | Immutable controlled events, owner-only resolution, explicit reopen reason, no reopen over another active case. |
| Durable happy path | New pool retrieves case; browser refresh reads server state; existing populated conversation survives migration unchanged. |
| Tenant isolation including nested IDs/counts | Foreign case lists empty, detail/mutation denied; nested staff selection rejected. |
| Invalid/stale/failure control | CSRF, ownership fields, revisions, conflicting keys, old-ownership reply redrive, outbound INSERT failure rolling back case/event/receipt. |
| Safe logs/audit/API | Reference-only audit/turn context; encrypted staff text; notes excluded from customer sends; code/credential paste rejected. |

Tests: `apps/api/test/database/support.test.ts`,
`apps/api/test/integration/support.test.ts`, `apps/web/src/test/support.test.tsx`.

### Run record

- Toolchain passed: Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14. Initial sandbox
  Vitest/Docker attempts could not launch; approved Windows execution worked. No
  dependencies were installed and no timeout/runner limit was increased.
- Focused pure rules: **4 passed**. Initial staff UI run: 3 failed/3 passed due to
  missing accessible select names; fixed labels, then **6 passed**.
- Initial real PostgreSQL handoff run: **5 passed**, including successful cleanup.
- Sequential conversation/pickup/handoff/migration regression: **29 passed, 1 failed**
  on the older conversation upgrade's migration count. Corrected that count and other
  old-data upgrade counts for exactly one new migration; preserved all data/rollback
  assertions. The narrowed corrected conversation upgrade passed.
- Added unique-active-case assertion initially expected a raw PostgreSQL code through
  the admin helper, which intentionally sanitizes it. Corrected the test to use the
  real runtime pool and assert `DB_QUERY_FAILED` plus SQLSTATE `23505`; no assertion
  was weakened. Ownership-term/window-expiry and migration tests passed.
- Browser: production hash route with fictional local API responses. Verified keyboard
  claim, private note, blocked reply, resolve, reopen, retained history and dialog close.
  Found/refined focus restoration after queue reload; final browser returned focus to
  the current queue button. Final six component tests passed with that assertion.
  This is real browser UI evidence with synthetic API responses, not a live full-stack
  or Meta send. Screenshot: local ignored `node_modules/.cache/issue50-browser.png`.
- Reviewed inventory delta was exactly six support test declarations; assigned each
  to #50's assistant group. No unrelated inventory was regenerated.
- Full `pnpm db:local quality` passed toolchain, tooling/security tests, planning,
  lint, five package typechecks, **22 testkit + 12 DB unit + 535 API + 188 web + 3
  object-store tests**. It stopped in the schema/DB group on four remaining historical
  WhatsApp upgrade-count assertions; it was **not** an uninterrupted green pipeline.
- One diagnostic name filter matched no registered case; that run provides no evidence.
  The actual isolated consent-upgrade case confirmed `10` applied versus old `9`.
  Corrected the four exact upgrade counts and preserved existing-data/retry checks.
- Final sequential focused handoff + four repaired schema files: **12 passed**, zero
  failed/skipped/cancelled/todo, with successful disposable-container cleanup.
- `pnpm check:migrations`: **33 released files unchanged**. `git diff --check` passed.
- Final lint/tenant-query checks and all five package typechecks passed (exit 0).
  Standalone API/web production build passed (exit 0). Final planning, documentation
  links and prototype inventory checks passed (exit 0).
- Final broad `pnpm db:local test:db` continuation passed **67 schema/DB + 376 API
  database tests**, zero failed/skipped/cancelled/todo (exit 0); disposable-container
  cleanup succeeded. This completes the failed aggregate's remaining stages together
  with the final static/build checks; already-passing broad unit/UI suites were not
  restarted. The final UI focus edit was verified by all six focused UI tests, actual
  browser flow, final lint/typechecks and build.
- All twelve acceptance rows above are **verified locally**. No remaining local
  coverage gap is known for the scoped implementation. Evidence combines the original
  broad run and corrected continuations, not a single uninterrupted quality pass.

Local ignored logs are `node_modules/.cache/issue50-*.log`. No CI run, real Meta
delivery, deployment, commit, push, PR publication or merge is claimed.
