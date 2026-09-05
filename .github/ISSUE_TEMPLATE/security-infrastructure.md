---
name: "Security / infrastructure task"
about: "Plan public-safe hardening or infrastructure work"
labels: "type: infrastructure"
---

Do not report an exploitable vulnerability here; use private security reporting.

## Engineering Outcome / Why

## Dependencies and Current State

## Scope / Non-Goals

## Architecture / Data / API Impact

## Threats, Tenant Boundaries and Least Privilege

Identify affected assets, organization/franchise/environment ownership, privileged roles and denied paths. No secrets/PII.

## Failure, Retry and Recovery

Define idempotency, timeout, rollback/restore and owner.

## Acceptance Criteria

- [ ] Concrete safe behavior and failure conditions are specified.
- [ ] Relevant negative authorization/environment isolation test is included.

## Tests / Observability / Evidence

Commands, safe logs, metrics, alerts, failure drill and reviewer demonstration.

## Rollout and Documentation

## Definition of Done

- [ ] Acceptance/security/privacy/isolation verified; relevant tests, typecheck, lint and build pass.
- [ ] Runbooks/docs updated; no known regression; evidence reproducible.
- [ ] Latest main → dedicated branch → commit/push → linked PR → current CI/review → clean merge.
- [ ] After merge checkout/pull main, clean branch, next issue from updated main.

Use the full implementation template for substantive system implementation; this compact form must be expanded when boundaries/risks need more detail.
