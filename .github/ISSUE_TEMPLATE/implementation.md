---
name: "Feature / implementation"
about: "Define a complete, bounded production implementation contract"
labels: "type: feature"
---

No real PII, credentials or sensitive security findings. Tiny bugs should use the bug template.

## User / Engineering Outcome

Describe the concrete result and business/engineering rationale.

## Why This Exists

Describe the concrete result and business/engineering rationale.

## Dependencies and Ordering

Depends on #; blocks #. Name unresolved decisions. Do not mark ready until prerequisites are merged.

## Current State

Reference actual code paths, existing prototype behavior and what intentionally changes.

## Scope

List the independently reviewable work.

## Non-Goals / Out of Scope

Name neighboring issue responsibilities this issue must not absorb.

## Product / Business Rules

Describe the concrete result and business/engineering rationale.

## Domain / Data Model Impact

Entities, organization/franchise keys, relationships, constraints/indexes and forward migration implications.

## API / Event Contract Impact

Validated commands/DTOs/events, versioning and producer/consumer ownership.

## Authorization and Tenant Isolation

Record owner; permitted read/write roles; org-admin boundaries; customer/worker identity; foreign/nested ID denial and safe errors.

## Security / Privacy Constraints

PII, credentials, OTP, money, logs, callbacks/signatures/replay, provider/AI access and rate limits. Never include real secrets or customer records.

## Reliability / Idempotency Requirements

Duplicate/concurrent request identity, transaction boundary, retry limits, uncertain external acceptance and recovery.

## UX / Accessibility Requirements

Existing design system; loading/empty/success/error/validation/disabled/retry; keyboard/focus/labels/mobile.

## Acceptance Criteria

- [ ] Given a specific actor/input, when an action occurs, then an objectively verifiable outcome follows.
- [ ] Include denied access, malformed input, concurrent/retry and failure cases as relevant.

## Testing Scenarios

Concrete happy path, validation, authorization, tenant isolation, failure/retry/provider, regression and accessibility scenarios.

## Automated Test Expectations

Select appropriate unit, real database, API, contract, browser, webhook and worker levels; identify fixtures and assertions.

## Observability / Audit Expectations

Safe action/result/correlation, metrics and audit. No raw PII, OTP or secret logs.

## Migration / Rollout Notes

Compatibility, rollout order, recovery and fictional demo isolation; state not applicable with reason when appropriate.

## Documentation Requirements

Name domain/API/operator docs and reproducible verification commands.

## Definition of Done

- [ ] Agreed scope is fully implemented; no unrelated feature responsibility was absorbed.
- [ ] All acceptance criteria are satisfied with linked evidence.
- [ ] Relevant automated tests are added or updated.
- [ ] Tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes; M0 lint-baseline issue must establish the command before product implementation (never report a missing command as passing).
- [ ] Production build passes.
- [ ] No known regressions are introduced; intentional prototype behavior changes are documented.
- [ ] Security/privacy requirements for this issue are verified.
- [ ] Tenant-isolation behavior is verified when applicable, including sibling franchises and unrelated organizations.
- [ ] Relevant developer/operator documentation is updated.
- [ ] Work was started from the latest main after git checkout main and git pull origin main.
- [ ] A dedicated issue branch was created.
- [ ] No implementation was committed directly to main.
- [ ] Branch was pushed to GitHub.
- [ ] Pull Request was created against main.
- [ ] Pull Request links/closes this issue.
- [ ] Required CI checks pass on the current PR commit.
- [ ] Review feedback is resolved.
- [ ] PR merges cleanly into main only after acceptance criteria and pre-merge DoD gates pass.
- [ ] No unresolved merge conflicts remain.
- [ ] After merge, local main is checked out and pulled.
- [ ] Completed branch is cleaned up when appropriate.
- [ ] Demo/verification scenario is documented and reproducible.

## Demo / Verification Scenario

Number the exact steps a reviewer uses with fictional data, including permitted and denied scopes.

## Mandatory Engineering Workflow

1. Switch to main: `git checkout main` (first preserve unrelated work; never discard it).
2. Pull the latest main BEFORE branching: `git pull origin main`.
3. Create a dedicated issue branch: `git checkout -b issue-<number>-<short-scope>`.
4. Implement only the agreed issue scope.
5. Add/update the relevant automated tests.
6. Run required tests, typecheck, lint and production build; record exact results.
7. Commit with a meaningful message.
8. Push the branch: `git push -u origin <issue-branch>`.
9. Create a Pull Request targeting main.
10. Reference and close/link the issue in the PR, normally `Closes #<number>`.
11. Verify required CI checks on the current PR commit.
12. Review the diff and resolve review feedback before merge.
13. Merge only when acceptance criteria and Definition of Done are satisfied and no conflicts remain.
14. Switch back to main: `git checkout main`.
15. Pull newly merged main: `git pull origin main`.
16. Delete the completed local/remote issue branch when appropriate; never delete another person's active work.
17. Start the next issue from this newly updated main, not the previous feature branch.
