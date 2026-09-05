# ShipIT issue index

Compact planning map only. Read each GitHub issue for full scope, risks, acceptance criteria, tests and workflow. Initial status is a publication snapshot, not a live board. Stable PLAN identifiers used during drafting are replaced with assigned GitHub numbers after publication.

## M0 — Engineering & Architecture Foundation

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-01 | Ratify production architecture, MVP boundaries and decision records | None | Ready |
| PLAN-02 | Define canonical domain, ownership and authorization contracts | PLAN-01 | Blocked |
| PLAN-03 | Specify versioned API, event and idempotency contracts | PLAN-01, PLAN-02 | Blocked |
| PLAN-04 | Add reproducible CI quality gates and lint baseline | None | Ready |
| PLAN-05 | Define environment, secrets and security threat model | PLAN-01, PLAN-02 | Blocked |
| PLAN-06 | Map prototype behavior to staged API migration and regression fixtures | PLAN-01, PLAN-02 | Blocked |
| PLAN-07 | Define money, tax, delivery proof and privacy policy decisions | PLAN-02, PLAN-05 | Blocked |
| PLAN-08 | Establish API, database and security test harness conventions | PLAN-03, PLAN-04, PLAN-05 | Blocked |

## M1 — SaaS, Database & Franchise Foundation

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-09 | Implement PostgreSQL pool, migrations and database health checks | PLAN-01, PLAN-03, PLAN-04, PLAN-08 | Blocked |
| PLAN-10 | Implement Fastify server boundary and validated runtime configuration | PLAN-03, PLAN-05, PLAN-08, PLAN-09 | Blocked |
| PLAN-11 | Implement organization and franchise tenancy model | PLAN-02, PLAN-09, PLAN-10 | Blocked |
| PLAN-12 | Implement secure operator authentication and session lifecycle | PLAN-05, PLAN-09, PLAN-10 | Blocked |
| PLAN-13 | Implement memberships, invitations and role-based authorization | PLAN-02, PLAN-11, PLAN-12 | Blocked |
| PLAN-14 | Enforce tenant-scoped queries and cross-tenant security regression gates | PLAN-09, PLAN-11, PLAN-12, PLAN-13 | Blocked |
| PLAN-15 | Add append-only audit records and safe operational telemetry | PLAN-03, PLAN-10, PLAN-13, PLAN-14 | Blocked |
| PLAN-16 | Implement independent-franchise onboarding and scope-aware operator shell | PLAN-11, PLAN-12, PLAN-13, PLAN-14, PLAN-15 | Blocked |
| PLAN-17 | Add production data-access seam and isolated fictional demo mode | PLAN-06, PLAN-10, PLAN-12, PLAN-14, PLAN-16 | Blocked |

## M2 — Core Courier Operations

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-18 | Implement tenant-private customers and repeat-customer lookup | PLAN-02, PLAN-09, PLAN-14, PLAN-15 | Blocked |
| PLAN-19 | Implement versioned rate rules and deterministic freight suggestions | PLAN-07, PLAN-09, PLAN-14, PLAN-15 | Blocked |
| PLAN-20 | Implement booked tax snapshots and GST validation | PLAN-07, PLAN-14, PLAN-15, PLAN-19 | Blocked |
| PLAN-21 | Implement atomic booking creation and collision-safe docket allocation | PLAN-03, PLAN-14, PLAN-15, PLAN-18, PLAN-19, PLAN-20 | Blocked |
| PLAN-22 | Add tenant-isolated booking retrieval, search and parcel timeline APIs | PLAN-14, PLAN-21 | Blocked |
| PLAN-23 | Implement guarded parcel lifecycle and delivery exception commands | PLAN-02, PLAN-03, PLAN-14, PLAN-15, PLAN-21 | Blocked |
| PLAN-24 | Implement bounded bulk parcel commands with per-item results | PLAN-22, PLAN-23 | Blocked |
| PLAN-25 | Implement persistent lots and safe parcel membership | PLAN-14, PLAN-15, PLAN-22, PLAN-23 | Blocked |
| PLAN-26 | Implement dispatch routes and deduplicated parcel manifests | PLAN-14, PLAN-15, PLAN-23, PLAN-25 | Blocked |
| PLAN-27 | Implement idempotent route events and authoritative ETA propagation | PLAN-03, PLAN-23, PLAN-26 | Blocked |
| PLAN-28 | Implement To-Pay ledger and idempotent payment collection | PLAN-07, PLAN-14, PLAN-15, PLAN-21 | Blocked |
| PLAN-29 | Implement immutable receipt snapshots and safe receipt retrieval | PLAN-20, PLAN-21, PLAN-22, PLAN-28 | Blocked |
| PLAN-30 | Add private parcel attachments with upload validation and retention | PLAN-05, PLAN-14, PLAN-15, PLAN-21 | Blocked |
| PLAN-31 | Implement externally issued e-way record tracking and reminders | PLAN-07, PLAN-14, PLAN-15, PLAN-21 | Blocked |
| PLAN-32 | Migrate booking, customer and receipt screens to production APIs | PLAN-17, PLAN-18, PLAN-19, PLAN-20, PLAN-21, PLAN-22, PLAN-28, PLAN-29, PLAN-30 | Blocked |
| PLAN-33 | Migrate parcel, lot, route and operational dashboard screens to APIs | PLAN-17, PLAN-22, PLAN-23, PLAN-24, PLAN-25, PLAN-26, PLAN-27, PLAN-28, PLAN-31, PLAN-32 | Blocked |

## M3 — WhatsApp Messaging & Automation

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-34 | Implement transactional outbox relay and durable job execution | PLAN-03, PLAN-09, PLAN-10, PLAN-14, PLAN-15, PLAN-21 | Blocked |
| PLAN-35 | Integrate WhatsApp provider configuration and approved template registry | PLAN-05, PLAN-07, PLAN-14, PLAN-15, PLAN-34 | Blocked |
| PLAN-36 | Add signed, idempotent WhatsApp webhook ingestion | PLAN-03, PLAN-14, PLAN-35 | Blocked |
| PLAN-37 | Implement scoped messaging consent and send-time policy checks | PLAN-07, PLAN-14, PLAN-15, PLAN-35, PLAN-36 | Blocked |
| PLAN-38 | Implement durable outbound WhatsApp queue and delivery reconciliation | PLAN-34, PLAN-35, PLAN-36, PLAN-37 | Blocked |
| PLAN-39 | Implement event-to-notification automation policies | PLAN-03, PLAN-23, PLAN-27, PLAN-34, PLAN-37, PLAN-38 | Blocked |
| PLAN-40 | Implement route-delay customer notification fanout | PLAN-27, PLAN-38, PLAN-39 | Blocked |
| PLAN-41 | Implement secure delivery challenges and atomic delivery completion | PLAN-07, PLAN-23, PLAN-28, PLAN-37, PLAN-38 | Blocked |
| PLAN-42 | Automate delivery attempt, RTO and completion notifications | PLAN-23, PLAN-38, PLAN-39, PLAN-41 | Blocked |
| PLAN-43 | Migrate messaging history and automation feed to provider-backed records | PLAN-17, PLAN-36, PLAN-38, PLAN-39, PLAN-40, PLAN-42 | Blocked |
| PLAN-44 | Verify end-to-end automation durability and messaging failure recovery | PLAN-33, PLAN-40, PLAN-41, PLAN-42, PLAN-43 | Blocked |

## M4 — Customer Self-Service & Assistant

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-45 | Implement verified customer identity and private shipment self-service | PLAN-14, PLAN-22, PLAN-36, PLAN-37 | Blocked |
| PLAN-46 | Implement deterministic conversation routing and trusted operational tools | PLAN-22, PLAN-27, PLAN-29, PLAN-37, PLAN-41, PLAN-45 | Blocked |
| PLAN-47 | Add shipment quotes and configurable heavy-shipment routing | PLAN-19, PLAN-37, PLAN-45, PLAN-46 | Blocked |
| PLAN-48 | Implement pickup requests and staff acceptance workflow | PLAN-16, PLAN-37, PLAN-45, PLAN-47 | Blocked |
| PLAN-49 | Implement human escalation queue and safe staff handoff | PLAN-15, PLAN-37, PLAN-38, PLAN-45, PLAN-46 | Blocked |
| PLAN-50 | Add optional multilingual intent interpretation with deterministic safeguards | PLAN-05, PLAN-46, PLAN-47, PLAN-49 | Blocked |
| PLAN-51 | Add assistant outcome metrics and self-service regression evidence | PLAN-44, PLAN-46, PLAN-47, PLAN-48, PLAN-49, PLAN-50 | Blocked |

## M5 — Courier Integrations & Pricing

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-52 | Add carrier adapter contract and capability model | PLAN-01, PLAN-02, PLAN-03 | Blocked |
| PLAN-53 | Implement manual carrier workflow and normalized reference mapping | PLAN-14, PLAN-15, PLAN-22, PLAN-23, PLAN-52 | Blocked |
| PLAN-54 | Implement validated CSV shipment and tracking imports | PLAN-14, PLAN-15, PLAN-34, PLAN-52, PLAN-53 | Blocked |
| PLAN-55 | Research Akash Ganga integration access and recommend an adapter strategy | PLAN-01, PLAN-05, PLAN-52 | Blocked |
| PLAN-56 | Research Maruti integration access and recommend an adapter strategy | PLAN-01, PLAN-05, PLAN-52 | Blocked |
| PLAN-57 | Implement idempotent tracking ingestion and carrier reconciliation | PLAN-23, PLAN-34, PLAN-52, PLAN-53, PLAN-54 | Blocked |
| PLAN-58 | Implement carrier rate-card imports and service/location normalization | PLAN-19, PLAN-52, PLAN-54 | Blocked |
| PLAN-59 | Deliver the first verified carrier integration and health runbook | PLAN-52, PLAN-55, PLAN-56, PLAN-57, PLAN-58 | Blocked |

## M6 — Reporting, Compliance & Operations

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-60 | Implement scoped reporting queries and safe CSV exports | PLAN-14, PLAN-20, PLAN-22, PLAN-28 | Blocked |
| PLAN-61 | Implement sales register and GST summary reports | PLAN-20, PLAN-29, PLAN-60 | Blocked |
| PLAN-62 | Implement To-Pay ageing and collection reconciliation reports | PLAN-28, PLAN-60 | Blocked |
| PLAN-63 | Implement destination, delivery and route performance reports | PLAN-23, PLAN-26, PLAN-27, PLAN-41, PLAN-60 | Blocked |
| PLAN-64 | Implement messaging and assistant effectiveness reports | PLAN-43, PLAN-51, PLAN-60 | Blocked |
| PLAN-65 | Implement versioned franchise settings and organization reporting scope | PLAN-13, PLAN-15, PLAN-16, PLAN-19, PLAN-20, PLAN-37, PLAN-60 | Blocked |
| PLAN-66 | Verify report reconciliation, compliance provenance and audit drill-through | PLAN-31, PLAN-61, PLAN-62, PLAN-63, PLAN-64, PLAN-65 | Blocked |

## M7 — Production Readiness & Pilot

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-67 | Provision isolated staging and production deployment pipelines | PLAN-04, PLAN-05, PLAN-09, PLAN-10, PLAN-17, PLAN-34 | Blocked |
| PLAN-68 | Implement backup policy and prove database and object restore | PLAN-05, PLAN-09, PLAN-30, PLAN-67 | Blocked |
| PLAN-69 | Add production monitoring, structured errors and actionable alerts | PLAN-15, PLAN-34, PLAN-38, PLAN-57, PLAN-67 | Blocked |
| PLAN-70 | Audit authorization, tenant isolation and application abuse controls | PLAN-14, PLAN-30, PLAN-41, PLAN-43, PLAN-45, PLAN-59, PLAN-65, PLAN-67 | Blocked |
| PLAN-71 | Implement customer privacy lifecycle, retention and deletion workflows | PLAN-05, PLAN-07, PLAN-15, PLAN-30, PLAN-37, PLAN-43, PLAN-45, PLAN-68 | Blocked |
| PLAN-72 | Audit secrets, dependencies and software supply-chain controls | PLAN-04, PLAN-05, PLAN-35, PLAN-59, PLAN-67 | Blocked |
| PLAN-73 | Run load, concurrency and failure-recovery qualification | PLAN-44, PLAN-59, PLAN-66, PLAN-67, PLAN-68, PLAN-69 | Blocked |
| PLAN-74 | Prepare pilot onboarding, operator runbooks and fictional demo environment | PLAN-16, PLAN-33, PLAN-43, PLAN-48, PLAN-49, PLAN-59, PLAN-65, PLAN-67, PLAN-69, PLAN-71 | Blocked |
| PLAN-75 | Approve pilot release readiness and establish feedback triage | PLAN-44, PLAN-51, PLAN-59, PLAN-66, PLAN-68, PLAN-69, PLAN-70, PLAN-71, PLAN-72, PLAN-73, PLAN-74 | Blocked |

## M8 — Commercial SaaS & Scale

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| PLAN-76 | Define commercial plans, entitlements and usage metering | PLAN-75 | Blocked |
| PLAN-77 | Implement SaaS subscriptions, billing webhooks and trial lifecycle | PLAN-76 | Blocked |
| PLAN-78 | Implement controlled franchise adoption and large-organization onboarding | PLAN-02, PLAN-65, PLAN-71, PLAN-75 | Blocked |
| PLAN-79 | Add bounded white-label configuration and audited support access | PLAN-65, PLAN-71, PLAN-75 | Blocked |
| PLAN-80 | Add enterprise access controls and service-level operations | PLAN-69, PLAN-75, PLAN-76, PLAN-78 | Blocked |
