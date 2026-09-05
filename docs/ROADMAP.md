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
| M6 — Reporting, Compliance & Operations | 7 | Make financial, operational, messaging and compliance reports reconcile to persistent authoritative records. |
| M7 — Production Readiness & Pilot | 9 | Qualify and operate a first real franchise pilot with tested recovery, monitoring, privacy lifecycle and release evidence. |
| M8 — Commercial SaaS & Scale | 5 | POST-MVP / FUTURE COMMERCIALIZATION: enable paid SaaS and controlled larger-organization deployment after pilot learning. |

## Backlog and start order

[Issue index](ISSUE_INDEX.md) contains the compact linked map; the full acceptance/security/test/DoD contracts live in [GitHub issues](https://github.com/ShippingCo/ShipIT/issues). Do not implement from an issue title alone.

Initial ready work: PLAN-01 **Ratify production architecture, MVP boundaries and decision records** and PLAN-04 **Add reproducible CI quality gates and lint baseline**. Architecture is the recommended first issue; it has no prerequisite and establishes the decisions other domains require. CI/lint can proceed independently. All other issues initially wait on explicit prerequisites, including M8's pilot gate.

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
