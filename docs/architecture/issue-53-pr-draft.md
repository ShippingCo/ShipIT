# PR draft for issue #53

## Title

Define carrier adapter capabilities and scoped evidence contracts

## Description

Carrier names alone cannot describe manual, file or verified API support. Add a server-only
typed carrier port with independent capabilities, scoped external identities, versioned
status/service/location mappings, provenance and explicit retry/uncertainty outcomes.
Local booking remains independent of carrier availability; observations cannot directly
deliver a parcel or settle payment.

Separate customer-selling rates, estimated purchase costs and references to actual-cost
evidence. Add synthetic manual/file/API contract fixtures, exact paise source totals, scope
denials and negative type checks. Document credentials, endpoint safety, health, timeout,
authorization and later implementation responsibilities in the owning guide and ADR 0038.

No migration, new dependency, configuration key, live adapter, product endpoint or UI.
Manual workflow, imports, reconciliation, carrier access research and financial services
remain with their owning issues. Groq integration is unchanged.

Validation: `pnpm db:local quality` passed: 613 API, 189 web, 67 schema/DB and 390 API DB
tests, plus tooling/unit/storage suites, planning, lint, types and production builds.
Final contract refinements passed 23 focused tests, API typecheck and focused lint; this
combines the broad run with final targeted checks. All 36 released migrations are unchanged.
See [exact acceptance and verification evidence](issue-53-verification.md). Fixtures are
synthetic; this is not live carrier qualification, CI approval or deployment evidence.

Closes #53

## Suggested commit message

`feat(carriers): define scoped adapter capabilities and evidence contracts`
