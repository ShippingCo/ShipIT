# ShipIT production roadmap

**Prototype v0 — completed before production milestones.** The working prototype is an asset, not a backlog item to rebuild from scratch. M0–M7 form the pilot-ready MVP path; M8 is **POST-MVP / FUTURE COMMERCIALIZATION**.

At inspection commit `54934846d812226a2a4b6c3b39fdb25003763617`, React/TypeScript/Vite contains the operator and simulated customer experiences. `apps/web/src/data/store.ts` owns localStorage and most business behavior. `apps/api`, `packages/db` and `packages/shared` are scaffolds: no real authentication, SQL schema, SaaS tenancy, production WhatsApp or carrier connection. README/package names use ShippingCo; this plan calls the product ShipIT without a runtime rebrand.

The production destination is React → ShipIT API → domain services + PostgreSQL transaction → trusted domain event/outbox → automation/jobs → WhatsApp or carrier adapters. The domain service owns the transaction; this is not a requirement to put business rules after persistence in the request sequence.

## Milestones

[GitHub milestones](https://github.com/ShippingCo/ShipIT/milestones) contain the full objectives, entry/exit gates, risks, review demo and mandatory workflow. No speculative due dates are set.

| Milestone | Planned issues | Objective |
| --- | ---: | --- |
| M0 — Engineering & Architecture Foundation | 8 | Freeze architecture, terminology, MVP boundaries, engineering checks and migration contracts before backend feature work. |
| M1 — SaaS, Database & Franchise Foundation | 9 | Establish PostgreSQL, authenticated identity, organizations/franchises, scoped membership and secure backend foundations before real operational PII. |
| M2 — Core Courier Operations | 16 | Persist and expose the proven counter, parcel, lot, route, pricing and payment workflows through authoritative APIs while retaining useful UX. |
| M3 — WhatsApp Messaging & Automation | 11 | Replace simulated notifications with durable events, policy-aware WhatsApp delivery and secure final-mile proof. |
| M4 — Customer Self-Service & Assistant | 7 | Let verified customers resolve routine shipment needs through trusted tools and obtain accountable human support. |
| M5 — Courier Integrations & Pricing | 8 | Provide carrier-agnostic manual/file/live integration paths and reviewed rate imports without depending on any carrier API being available. |
| M6 — Reporting, Compliance & Operations | 21 | Make financial, operational, messaging and compliance reports reconcile to persistent authoritative records. |
| M7 — Production Readiness & Pilot | 9 | Qualify and operate a first real franchise pilot with tested recovery, monitoring, privacy lifecycle and release evidence. |
| M8 — Commercial SaaS & Scale | 7 | POST-MVP / FUTURE COMMERCIALIZATION: enable paid SaaS and controlled larger-organization deployment after pilot learning. |

## Backlog and start order

[Issue index](ISSUE_INDEX.md) contains the compact linked map; the full acceptance/security/test/DoD contracts live in [GitHub issues](https://github.com/ShippingCo/ShipIT/issues). Do not implement from an issue title alone.

Initial ready work: [#2](https://github.com/ShippingCo/ShipIT/issues/2) **Ratify production architecture, MVP boundaries and decision records** and [#5](https://github.com/ShippingCo/ShipIT/issues/5) **Add reproducible CI quality gates and lint baseline**. Architecture is the recommended first issue; it has no prerequisite and establishes the decisions other domains require. CI/lint can proceed independently. All other issues initially wait on explicit prerequisites, including M8's pilot gate.

## Dependency structure

M0 contracts → M1 persistence/identity/tenancy → M2 authoritative courier operations → M3 durable messages/delivery proof → M4 customer tools. M5 research branches from M0 and its adapters branch from the relevant M1/M2/M3 services. M6 reporting begins when each authoritative data source exists. M7 hosting/recovery/monitoring can start when service boundaries exist, but release approval depends on all required pilot exit evidence. M8 follows pilot approval.

The draft DAG was checked for cycles, missing references, duplicate titles and misplaced commercial prerequisites. Every M0–M7 issue contributes to the pilot release gate; no M8 issue is an ancestor of that gate. Issue number order is not a substitute for dependency checks.

## Scope boundaries

- Standalone franchise: onboard its own organization and franchise without an enrolled national parent. A parent may also manage multiple authorized locations. Adoption across organizations is a controlled post-MVP ownership migration.
- Server controls private access, pricing, money, status and delivery proof. Frontend filters and customer-typed phone/docket values are never authorization.
- Booked tax and receipts are snapshots; payment collections use a separate append-only ledger. E-way data tracks externally issued records; ShipIT does not claim government issuance/filing.
- AI interprets language through constrained optional routing; trusted tools own facts, prices, ETA, OTP and payments.
- Carrier contract supports manual/file/API capabilities. Akash Ganga/Maruti research must produce dated findings, including unavailable/unverified access and fallback. The first carrier deliverable must state honestly whether it uses a live API or file/manual path.
- Demo may remain on fictional data, explicitly isolated from production identity, storage and outbound messaging. Never silently import old localStorage.
- Subscriptions, enterprise billing, white labeling and expanded corporate deployment belong to M8 and cannot delay the initial pilot.

## Engineering execution

Follow [CONTRIBUTING](../CONTRIBUTING.md) and the [mandatory workflow](ENGINEERING_WORKFLOW.md): latest main → issue branch → scoped work/tests/checks → push → linked PR → CI/review → merge → checkout/pull main → clean branch → next issue. Product security is implemented in each relevant issue; M7 hardens and verifies it.

See [prototype transition](PROTOTYPE_TO_PRODUCTION.md) and [inspection/reference findings](REPOSITORY_INSPECTION.md). GitHub issue bodies are authoritative if an indexed title/dependency is later refined; update the index when roadmap boundaries change.

<!-- finance-plan:2026-10-03 -->
## Approved financial-management expansion — 2026-10-03

The milestone table includes the approved expansion; the initial-ready discussion
above is a historical publication snapshot. The current approved plan contains **96 issues**: the original
82 plus [#137–#150](https://github.com/ShippingCo/ShipIT/milestone/7), all assigned to M6.
M6 therefore has **21 issues**, replacing the initial count of seven for current planning.
No existing milestone is removed or renumbered; M4's #46–#52 scope is unchanged.

See the [10-module map and ordering](FINANCIAL_MANAGEMENT_PLAN.md) and the
[combined M6 dependency index](ISSUE_INDEX.md#m6--reporting-compliance--operations).

- M5 retains every carrier integration task and adds selling-rate versus courier-cost
  provenance to #53/#59. No live bank connection is required for the first finance release.
- M6 retains sales/GST, ageing, delivery-performance, messaging and settings work, and
  adds payment evidence/reconciliation, cashbook/closing, monthly customer accounts,
  agent custody/settlement, adjustment audit, costs/contribution, owner dashboard,
  scheduled summaries and accountant exports.
- M7 retains every readiness gate and extends restore, monitoring, permissions/privacy,
  concurrency/recovery, runbooks and pilot review to the new financial sources.

Build #137's financial contracts first, then the source workflows, then their dependent
reports. #61's common reporting layer can begin on its existing prerequisites. Expanded
#67 reconciles a complete shop day and monthly cycle before the #76 release decision.

The old M8 enterprise-billing boundary means ShipIT SaaS subscription/commercial billing.
The newly approved M6 account billing is a courier shop billing its regular shipping
customers; it does not introduce enterprise SSO, corporate deployment or an analytics warehouse.
Bank reconciliation starts with manual review and supported statement files. Government
filing, automatic payroll deductions and unverified live bank integrations remain outside scope.

## M6 execution correction — 10 October 2026

Use the [current dependency map](ISSUE_INDEX.md) and
[M6 execution order](ISSUE_INDEX.md#m6-execution-order--10-october-2026).
#61 is closed; #64, #65 and #137 are ready. #62/#63 retain merged partial work but
remain blocked on the expanded financial producers. Higher issue numbers #137–#150
are M6 work, not M7/M8 prerequisites. Combined dependency lists replace the split
original/additive lists for M6 without dropping scope or adding new dependency edges.
