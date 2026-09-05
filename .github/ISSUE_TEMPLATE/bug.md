---
name: "Bug report"
about: "Report a focused reproducible defect"
labels: "type: bug"
---

## Expected and Actual Behavior

Who is affected and what happened? Do not include real customer data.

## Reproduction

1.

## Environment / Evidence

Version/commit, demo or production, browser, sanitized errors/screenshots.

## Impact and Scope

Severity, tenant/customer/money/proof impact, regression or existing defect. Sensitive vulnerability details go to private security reporting.

## Acceptance Criteria

- [ ] Specific reproduction now produces the expected outcome.
- [ ] Relevant regression test prevents recurrence.

## Dependencies / Testing / Security

Linked issues, targeted tests, tenant/permission implications and safe failure behavior. Expand into the implementation template for broad/high-risk fixes.

## Definition of Done

- [ ] Scope/acceptance satisfied; relevant tests, typecheck, lint and build pass.
- [ ] Security/privacy and affected tenant isolation verified; docs updated.
- [ ] Latest main → dedicated issue branch → commit/push → linked PR → CI/review → merge.
- [ ] After merge: checkout/pull main, clean branch, next issue from updated main.
