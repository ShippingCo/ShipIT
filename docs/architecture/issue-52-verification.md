# Issue #52 working and verification record

## Recovered context and base

Read repository workflow/quality/architecture and final summaries from “Implement
issue #51” and “Research Milestone 4”. Historical model recommendations were proposals;
the approved Groq configuration is preserved. Issue #52 is open in actual milestone 5
(M4), with no comments. Named prerequisites #45/#47/#48/#49/#50/#51 are closed;
their PRs #130/#132/#133/#134/#135/#136 are merged. PR #136 records seven passing
CI checks on 7098916. Current clean main was pulled and verified at 8f7ed3b;
work is on `issue-52-assistant-outcomes`. No commit, push, PR or deployment authorized.
Roadmap labels/index are historical and still say blocked; no tracker mutation made.

## Steps 1–6: requirements and approach

Reuse scoped immutable turns, tool provenance, support events and outbound/inference
receipts. Add only four bounded turn columns and an ownership/time index (migration
36). No duplicated identities, transcripts or secrets. Define tool success separately
from delivery, clarification, thanks, handoff, failure and observed abandonment.
Read API uses existing support permission and fixed privacy-limited weekly counts.
No new screen: existing staff/self-service journeys receive regression evidence;
reporting UI belongs to #65. ADR 0037 records research and tradeoffs.

Use pinned Windows `node_modules/.cache/issue35/run.ps1` (Node 22.23.2, pnpm
10.34.5, Python 3.12.14). Automated providers are fake; never call live Groq/Meta.
Focused static/API tests precede PostgreSQL and final quality. Old migration-count
fixtures advance by exactly one; synthetic repair files follow the new migration.

## Acceptance mapping

| Requirement | Implementation / evidence | Status |
| --- | --- | --- |
| Duplicate turns do not inflate counts | Inbox primary key, transactional evidence, duplicate/concurrent/restart fixture | Verified locally |
| Tool failures are not resolutions | Tool result classification incl. missing ETA/delay and failed resend | Verified locally |
| Thanks separate | Exact English/Hindi signal; no calls-saved field | Verified locally |
| Handoff/reopen traceable without bodies | Existing support event UUID, case, actor and controlled reason | Verified locally |
| Every intent English/Hindi | Versioned fictional corpus and persisted journey | Verified locally |
| Cross-tenant/injection block release | Normal mandatory suites include denials and injected instructions | Verified locally |
| Counts reconcile with sources | SQL projection, independent source grouping assertion | Verified locally |
| Restart/reload preserves outcome | Fresh pool/worker and repeated read checks | Verified locally |
| B/C/role/nested/count isolation | Scope authorization, no raw ID/filter API, issued-capability negative cases | Verified locally |
| Malformed/stale/dependency safe | Validation, existing savepoint fallback, focused regressions | Verified locally |
| Privacy inspected | Bounded fields, small-cohort suppression, log/response sentinel checks | Verified locally |

## Executed verification and final code state

Verified locally on `issue-52-assistant-outcomes`, based on main `8f7ed3b`.
All prerequisite merge SHAs were also checked as Git ancestors. No issue #52 source
edits followed the final focused rerun. No commit, push, PR or production action performed.
Unrelated untracked `apps/web/ui-review.html`, `apps/web/ui-review.tsx` and `artifacts/`
appeared in the shared workspace near delivery. They were left untouched, are outside
this change set, and are not covered by this verification claim. Do not stage them
as part of issue #52.

- `pnpm db:local quality` completed with exit 0: **34 tooling/security**, **22 testkit**,
  **12 DB unit**, **590 API**, **189 web**, **3 private object-store**, **67 schema/DB**
  and **390 API database** tests passed. Database groups had zero failures, skips,
  cancellations or TODOs. Planning, lint, all five workspace typechecks and API/web
  production builds passed. Both disposable service containers were removed.
- Review during that broad run refined missing-receipt failure reasons and separated
  pending inference reservations from provider failures. Final-state verification
  therefore combines the broad run with **6/6 focused real-PostgreSQL tests**, **23/23
  focused API evaluation tests**, final lint and the build that ran after those edits.
  The final focused database container was removed successfully. This is not presented
  as one frozen-state aggregate covering the later edits.
- `pnpm check:migrations`: **35 released migrations unchanged**, one forward addition.
  Final diff whitespace and planning/link checks passed.
- **12/12 focused support/pickup UI tests** passed. Added keyboard Escape, accessible
  dialog name/description and focus-restoration coverage; registered exactly that test
  in the required prototype regression inventory.
- Browser at **390x844** used the existing fictional API fixture: keyboard entry/claim,
  visible blocked reply, Escape and restored trigger focus. It exercised the production
  UI with mocked transport, not a live provider or database-backed browser session.
  Real HTTP injection/database tests separately exercised persisted service behavior.
  Screenshot: `node_modules/.cache/issue52-mobile.png`. Temporary browser/server stopped.
- Existing React act warnings and expected negative S3 streaming warnings remained
  visible; neither caused a failure or was suppressed.

### Failures investigated before the successful results

The first typecheck caught a provider fixture using `reason_code` instead of `reason`.
The first focused DB run exposed a CTE rejected by the scoped-query boundary; wrapping
it in a normal SELECT preserved the existing guard. Consent fixture ordering was
isolated so STOP did not revoke later independent test needs. A later assertion used
an administrator helper that intentionally redacts SQLSTATE; it now tests the owner
connection and specifically verifies 23514. No permission, assertion or timeout was
weakened. The final six-case run verifies all corrections together.

The first full quality attempt stopped at the UI inventory/document drift gate.
Registering the one added accessibility test corrected it; the next full run passed.
Docker initially hit the same stale Windows IPC sockets recorded in #51. Both
transient directories were preserved under `.issue52-recovery` names and Docker
restarted; no images, containers, volumes or settings were reset.

### Reproduce and inspect

Use the pinned toolchain, then `pnpm db:local quality` and `pnpm check:migrations`.
The automatically discovered `apps/api/test/database/assistant-outcomes.test.ts`
contains six independent fictional fixtures: bilingual tools/replay/restart; human
handoff/reopen/transport failure; role and A/B/C isolation; clarification expiry and
pending inference; populated migration; five-conversation weekly reconciliation.
`apps/api/test/integration/assistant-outcomes.test.ts` covers all supported English/Hindi
intents, prompt injection, small-cohort/complementary suppression and date validation.
Existing conversation regression explicitly verifies stale/dependency failure evidence.

Ignored local logs: `node_modules/.cache/issue52-quality-final.log`,
`issue52-db-delivery.log`, `issue52-unit-delivery.log`, `issue52-lint-final.log`.
[Definitions, rollout and manual example](assistant-outcomes.md),
[research decisions](../adr/0037-assistant-outcome-evidence.md),
[PR draft](issue-52-pr-draft.md).

All eleven issue acceptance criteria are verified within these controlled local
checks. Live Meta/Groq delivery or language-quality qualification, remote CI,
independent review and production deployment were not performed. There is no new
metrics UI; #65 owns that screen. Abandonment and success retain the explicitly
limited meanings in the contract, not causal call-avoidance claims.
