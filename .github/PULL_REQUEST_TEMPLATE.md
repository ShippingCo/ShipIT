## Summary

Describe the concrete problem and resulting behavior.

## Linked Issue

Closes #

## What Changed and Why

Explain the bounded changes, source-of-truth ownership and relevant architecture decisions.

## Scope Confirmation

- [ ] Changes implement only the linked issue scope; exceptions/dependent PRs are explained.
- [ ] Every issue acceptance criterion has evidence below or in linked checks.
- [ ] No unrelated prototype redesign or product implementation is included.

## Testing Performed

List exact commands, targeted scenarios, results and known warnings/limitations. Include negative/failure/retry tests where relevant.

## Automated Checks

- [ ] Tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes (if baseline not yet installed, state unavailable and link M0 blocker; never check this as passed).
- [ ] Production build passes.
- [ ] Required CI passes on current PR head.

## Security / Privacy Review

Identify PII, secrets, OTP, money, provider/AI, logging, callback signature/replay and abuse implications. Explain controls and evidence; mark not applicable only with reason.

## Tenant Isolation Review

State organization/franchise ownership, read/write roles, org-admin scope, customer/job identity and foreign-ID/nested-ID/export/cache tests. No frontend-only authorization.

## Screenshots / Demo

Provide reproducible scenario and sanitized evidence; include loading/error/keyboard/mobile states for UI changes. State reason if non-visual.

## Migration Notes

Schema/config/version compatibility, backfill, tenant mapping and demo implications, or reason not applicable. Never edit applied migrations or silently import localStorage.

## Rollback / Failure Considerations

Describe safe rollback/forward recovery, timeout/idempotency and external dependency failure, or reason not applicable.

## Definition of Done

- [ ] Linked issue scope and acceptance criteria are satisfied.
- [ ] Relevant automated tests and docs are updated; no known regressions.
- [ ] Security/privacy and applicable tenant-isolation requirements are verified.
- [ ] Work began from newly pulled main on a dedicated issue branch; no implementation committed directly to main.
- [ ] Branch is pushed; PR links/closes issue; current CI passes.
- [ ] Review feedback is resolved and merge has no conflicts.
- [ ] Demo is documented and reproducible.

After merge (complete afterward, not as a pre-merge claim):

- [ ] Check out main and pull newly merged main.
- [ ] Clean completed local/remote branch when appropriate.
- [ ] Start next issue from updated main.
