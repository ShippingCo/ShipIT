# Issue #53 working summary and verification

## Recovered context and verified base

2026-10-03: read repository instructions, architecture/ADR 0005, domain/authorization,
API/idempotency/security contracts, roadmap and current finance expansion. Retrieved final
conversation evidence from “Implement issue #52 fully”, “Review milestone 4 finance gaps”
and “Research Milestone 4”. The older OpenAI model suggestion was explicitly a proposal;
the user's approved Groq choices remain unchanged and are irrelevant to this port.

Live GitHub #53 is open in milestone **6**, named **M5 — Courier Integrations & Pricing**,
with no comments. Read the actual milestone description and its eight issues #53–#60,
including the approved finance additions and manual/file exit path. No separate M5 planning
chat appeared in the available list; the finance-planning chat, merged PR #152 and live issues
provide the current decisions. No missing conversation context blocks this work.

Local main was clean and already contained #52 via PR #151 (`5743b80`) and the finance plan
via PR #152 (`13afff16064928376f61956fcd506856fbb89a63`). `git pull --ff-only origin main`
confirmed current main; created `issue-53-carrier-contract`. Prerequisites #2/#3/#4 are closed;
merged architecture commits `256512a`, `d039a48` and `308f247` are present. All seven M4
issues #46–#52 are closed. Historical roadmap status labels still say blocked; no labels
were changed or treated as proof of readiness.

#52 local evidence includes controlled DB/API/UI tests, not live provider qualification.
That limitation, M4 deployment qualification and future finance features are not prerequisites
of this contract. Main CI at initial inspection had five successful quality jobs and a still
running PostgreSQL job; that incomplete aggregate was not called passing.
Subsequent inspection confirmed all seven checks passed on `13afff1`, including the
aggregate gate. These are base-commit checks, not CI for the uncommitted #53 changes.

## Steps 2–6: database, acceptance, research and approach

Reviewed route carrier strings and scoped memberships/manifests, immutable pricing versions,
booking snapshots, global parcel dockets and the booking transaction. No carrier installation
storage exists and #53 explicitly forbids product tables. No schema/query changes, backfill,
production data access or live configuration are needed. #54/#58 own persistence and retries;
current domain/database guards remain authoritative.

Implement only server types/pure helpers, fictional adapter fixtures, compiled negative type
checks and documentation. Independent capabilities, qualified references, versioned mappings,
source/receive times, explicit unknowns, safe failures and rate-purpose/source provenance
are the foundations reused by later issues. No HTTP routes, UI or runtime adapter registration.

[ADR 0038](../adr/0038-carrier-capability-contract.md) records primary research and design
tradeoffs. Avoided a new client, framework, schema and generalized plugin infrastructure.
W26's existing franchise-admin ceiling takes precedence over #54's historical dispatcher prose;
organization-wide configuration remains denied pending a separately reviewed matrix change.

## Acceptance and evidence map

| Acceptance criterion | Implementation and verification | Status |
| --- | --- | --- |
| Manual works with network capabilities false | Manual fixture has only manual observations; unsupported booking and N/A health checks | Verified by local contract tests |
| API unavailable does not block local booking | Port has no booking-service dependency; unchanged real booking transaction and regression suite | Verified locally within contract scope and existing DB regressions |
| Unknown status explicit | Map-based status normalization and unknown timezone fixture; no canonical commands | Verified by local contract tests |
| Separate retryable/permanent/auth/unsupported | Discriminated failure union and recovery cases, plus uncertain timeout | Verified by local contract tests |
| A installation cannot be selected for B without grant | Both installation and authorized scope required; sibling/C/own-org/missing-grant checks | Verified as pure contract examples, not a new auth endpoint |
| No delivery/payment bypass | Observation claim type; no mutation ports; negative compile assertions | Verified by tests/typecheck and existing domain DB regressions |
| Timestamp/provenance/normalized fixtures | Manual/file/API examples retain receipt/source/mapping identity | Verified by local contract tests |
| Decisions/evidence/limitations explicit | Owning guide and ADR separate executable contract from future production paths | Documented |
| Current paths/commands | Pinned toolchain and dedicated refreshed-main branch | Verified locally |
| Manual finance grouping without invented actual cost | Saved source snapshots and distinct unknown/recorded cost evidence; exact source-to-total test | Verified by local contract tests |
| Selling/estimate/actual boundaries and fallback retained | Independent purpose capabilities; no actual-cost rate output; new candidate leaves historical snapshots intact | Verified by local contract tests |
| Scope, money, immutability, safe retries | Scope predicates, readonly evidence, integer units, recovery identity and downstream obligations | Verified within contract scope; no new reads/writes/jobs |

## Execution record

Pinned Windows wrapper: `node_modules/.cache/issue35/run.ps1` (Node 22.23.2,
pnpm 10.34.5, Python 3.12.14). `check:toolchain` passed. Initial focused `pnpm exec
vitest` could not resolve the Windows executable and ran no tests; the established package
`test` script resolved it. No assertions or timeouts changed to work around that environment issue.

- Focused contract tests: 23/23 passed.
- All five workspace typechecks passed, including negative type assertions; final lint passed.
- Final review separated installation operation scope from shipment references so rates/new
  external booking do not require an as-yet unassigned external docket. The 23 focused tests,
  all typechecks and lint passed again after that edit. The broad run had already run its API
  stage, so final evidence combines that broad run with final focused verification.
  Final fixture review checks explicit expected identifiers and manual/file/API provenance
  fields, rather than comparing a fixture factory with itself. The selection predicate also
  accepts installation-only scope. Final focused API typecheck/tests cover that signature.
- The first `db:local quality` attempt was blocked from launching Docker by the sandbox and
  reported setup/cleanup failure. The authorized elevated retry launched disposable test
  services. No production database or credentials were used.
- `pnpm db:local quality` completed with exit 0: **34 tooling/security**, **22 testkit**,
  **12 DB unit**, **613 API**, **189 web**, **3 private object-store**, **67 schema/DB**
  and **390 API database** tests passed. Database groups had zero failures, skips,
  cancellations or TODOs. Planning, lint, workspace types and API/web production builds
  passed. Both disposable containers were removed successfully.
- This is a passing broad run plus final targeted verification, not one frozen-state aggregate:
  the API stage preceded the final scope-signature/fixture refinements. Final 23 contract tests,
  API typecheck and focused lint cover the final source; the broad build also ran after those
  edits. No database, UI or existing runtime code changed, so their broad coverage remains valid.
- `pnpm check:migrations`: all **36 released migrations unchanged**, no additions.
  Final planning/link validation and diff whitespace checks passed.
- Existing React `act(...)` warnings and expected negative S3 streaming warnings remained
  visible; they were not suppressed and did not cause failure. No new test failure occurred.
- Local logs: `node_modules/.cache/issue53-quality.log`, `issue53-focused-final.log`,
  `issue53-api-types-final.log`, `issue53-lint-final.log`, `issue53-lint-targeted.log` and
  `issue53-planning-final.log`. These are ignored local evidence, not repository deliverables.

All original and additive #53 acceptance criteria are verified or documented at the required
contract/fixture level. Production carrier behavior is intentionally unimplemented under this
issue's non-goals. Remote CI for these uncommitted changes, independent review and publishing
remain unperformed; base-main CI success does not substitute for them.

No commit, push, PR publication or deployment is authorized. Live-provider tests are out of
scope and synthetic fixtures are not live access evidence. No feature UI changed, so no new
browser journey is claimed. Contract types do not replace downstream runtime validation,
authentication, scoped persistence, transport hardening or reconciliation.

Final source SHA256 (no source edits after the focused delivery checks):

| File | SHA256 |
| --- | --- |
| `apps/api/src/modules/carriers/contract.ts` | `56de352912b6db8f1fe6eff4d7a4a11d546794e73220d4f21e2b094977ce2df6` |
| `apps/api/test/carrier-fixtures.ts` | `4dd913074ad69a75be4092ecd682a8d934a23cfbbda2dc26d925a7f9f0841a08` |
| `apps/api/test/integration/carrier-contract.test.ts` | `214b9e56f75f15889716ecd270036d0764400dc2c97c271eb805a44f6978b6d0` |

See the [guide and repeatable commands](carrier-contract.md) and [PR draft](issue-53-pr-draft.md).
