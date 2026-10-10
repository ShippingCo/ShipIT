# ShipIT issue index

Compact planning map only. Read each GitHub issue for full scope, risks, acceptance criteria, tests and workflow. M6 dependencies and status were reconciled on 10 October 2026. Other milestone statuses are initial publication snapshots, not a live board. Stable PLAN identifiers used during drafting are replaced with assigned GitHub numbers after publication.

## M0 — Engineering & Architecture Foundation

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#2](https://github.com/ShippingCo/ShipIT/issues/2) | Ratify production architecture, MVP boundaries and decision records | None | Ready |
| [#3](https://github.com/ShippingCo/ShipIT/issues/3) | Define canonical domain, ownership and authorization contracts | [#2](https://github.com/ShippingCo/ShipIT/issues/2) | Blocked |
| [#4](https://github.com/ShippingCo/ShipIT/issues/4) | Specify versioned API, event and idempotency contracts | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#3](https://github.com/ShippingCo/ShipIT/issues/3) | Blocked |
| [#5](https://github.com/ShippingCo/ShipIT/issues/5) | Add reproducible CI quality gates and lint baseline | None | Ready |
| [#6](https://github.com/ShippingCo/ShipIT/issues/6) | Define environment, secrets and security threat model | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#3](https://github.com/ShippingCo/ShipIT/issues/3) | Blocked |
| [#7](https://github.com/ShippingCo/ShipIT/issues/7) | Map prototype behavior to staged API migration and regression fixtures | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#3](https://github.com/ShippingCo/ShipIT/issues/3) | Blocked |
| [#8](https://github.com/ShippingCo/ShipIT/issues/8) | Define money, tax, delivery proof and privacy policy decisions | [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#6](https://github.com/ShippingCo/ShipIT/issues/6) | Blocked |
| [#9](https://github.com/ShippingCo/ShipIT/issues/9) | Establish API, database and security test harness conventions | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#5](https://github.com/ShippingCo/ShipIT/issues/5), [#6](https://github.com/ShippingCo/ShipIT/issues/6) | Blocked |

## M1 — SaaS, Database & Franchise Foundation

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#10](https://github.com/ShippingCo/ShipIT/issues/10) | Implement PostgreSQL pool, migrations and database health checks | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#5](https://github.com/ShippingCo/ShipIT/issues/5), [#9](https://github.com/ShippingCo/ShipIT/issues/9) | Blocked |
| [#11](https://github.com/ShippingCo/ShipIT/issues/11) | Implement Fastify server boundary and validated runtime configuration | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#9](https://github.com/ShippingCo/ShipIT/issues/9), [#10](https://github.com/ShippingCo/ShipIT/issues/10) | Blocked |
| [#12](https://github.com/ShippingCo/ShipIT/issues/12) | Implement organization and franchise tenancy model | [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#11](https://github.com/ShippingCo/ShipIT/issues/11) | Blocked |
| [#13](https://github.com/ShippingCo/ShipIT/issues/13) | Implement secure operator authentication and session lifecycle | [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#11](https://github.com/ShippingCo/ShipIT/issues/11) | Blocked |
| [#14](https://github.com/ShippingCo/ShipIT/issues/14) | Implement memberships, invitations and role-based authorization | [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#12](https://github.com/ShippingCo/ShipIT/issues/12), [#13](https://github.com/ShippingCo/ShipIT/issues/13) | Blocked |
| [#15](https://github.com/ShippingCo/ShipIT/issues/15) | Enforce tenant-scoped queries and cross-tenant security regression gates | [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#12](https://github.com/ShippingCo/ShipIT/issues/12), [#13](https://github.com/ShippingCo/ShipIT/issues/13), [#14](https://github.com/ShippingCo/ShipIT/issues/14) | Blocked |
| [#16](https://github.com/ShippingCo/ShipIT/issues/16) | Add append-only audit records and safe operational telemetry | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#11](https://github.com/ShippingCo/ShipIT/issues/11), [#14](https://github.com/ShippingCo/ShipIT/issues/14), [#15](https://github.com/ShippingCo/ShipIT/issues/15) | Blocked |
| [#17](https://github.com/ShippingCo/ShipIT/issues/17) | Implement independent-franchise onboarding and scope-aware operator shell | [#12](https://github.com/ShippingCo/ShipIT/issues/12), [#13](https://github.com/ShippingCo/ShipIT/issues/13), [#14](https://github.com/ShippingCo/ShipIT/issues/14), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16) | Blocked |
| [#18](https://github.com/ShippingCo/ShipIT/issues/18) | Add production data-access seam and isolated fictional demo mode | [#7](https://github.com/ShippingCo/ShipIT/issues/7), [#11](https://github.com/ShippingCo/ShipIT/issues/11), [#13](https://github.com/ShippingCo/ShipIT/issues/13), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#17](https://github.com/ShippingCo/ShipIT/issues/17) | Blocked |

## M2 — Core Courier Operations

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#19](https://github.com/ShippingCo/ShipIT/issues/19) | Implement tenant-private customers and repeat-customer lookup | [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16) | Blocked |
| [#20](https://github.com/ShippingCo/ShipIT/issues/20) | Implement versioned rate rules and deterministic freight suggestions | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16) | Blocked |
| [#21](https://github.com/ShippingCo/ShipIT/issues/21) | Implement booked tax snapshots and GST validation | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#20](https://github.com/ShippingCo/ShipIT/issues/20) | Blocked |
| [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Implement atomic booking creation and collision-safe docket allocation | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#19](https://github.com/ShippingCo/ShipIT/issues/19), [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#21](https://github.com/ShippingCo/ShipIT/issues/21) | Blocked |
| [#23](https://github.com/ShippingCo/ShipIT/issues/23) | Add tenant-isolated booking retrieval, search and parcel timeline APIs | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Blocked |
| [#24](https://github.com/ShippingCo/ShipIT/issues/24) | Implement guarded parcel lifecycle and delivery exception commands | [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Blocked |
| [#25](https://github.com/ShippingCo/ShipIT/issues/25) | Implement bounded bulk parcel commands with per-item results | [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#24](https://github.com/ShippingCo/ShipIT/issues/24) | Blocked |
| [#26](https://github.com/ShippingCo/ShipIT/issues/26) | Implement persistent lots and safe parcel membership | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#24](https://github.com/ShippingCo/ShipIT/issues/24) | Blocked |
| [#27](https://github.com/ShippingCo/ShipIT/issues/27) | Implement dispatch routes and deduplicated parcel manifests | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#26](https://github.com/ShippingCo/ShipIT/issues/26) | Blocked |
| [#28](https://github.com/ShippingCo/ShipIT/issues/28) | Implement idempotent route events and authoritative ETA propagation | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#27](https://github.com/ShippingCo/ShipIT/issues/27) | Blocked |
| [#29](https://github.com/ShippingCo/ShipIT/issues/29) | Implement To-Pay ledger and idempotent payment collection | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Blocked |
| [#30](https://github.com/ShippingCo/ShipIT/issues/30) | Implement immutable receipt snapshots and safe receipt retrieval | [#21](https://github.com/ShippingCo/ShipIT/issues/21), [#22](https://github.com/ShippingCo/ShipIT/issues/22), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#29](https://github.com/ShippingCo/ShipIT/issues/29) | Blocked |
| [#31](https://github.com/ShippingCo/ShipIT/issues/31) | Add private parcel attachments with upload validation and retention | [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Blocked |
| [#32](https://github.com/ShippingCo/ShipIT/issues/32) | Implement externally issued e-way record tracking and reminders | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Blocked |
| [#33](https://github.com/ShippingCo/ShipIT/issues/33) | Migrate booking, customer and receipt screens to production APIs | [#18](https://github.com/ShippingCo/ShipIT/issues/18), [#19](https://github.com/ShippingCo/ShipIT/issues/19), [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#21](https://github.com/ShippingCo/ShipIT/issues/21), [#22](https://github.com/ShippingCo/ShipIT/issues/22), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#30](https://github.com/ShippingCo/ShipIT/issues/30), [#31](https://github.com/ShippingCo/ShipIT/issues/31) | Blocked |
| [#34](https://github.com/ShippingCo/ShipIT/issues/34) | Migrate parcel, lot, route and operational dashboard screens to APIs | [#18](https://github.com/ShippingCo/ShipIT/issues/18), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#25](https://github.com/ShippingCo/ShipIT/issues/25), [#26](https://github.com/ShippingCo/ShipIT/issues/26), [#27](https://github.com/ShippingCo/ShipIT/issues/27), [#28](https://github.com/ShippingCo/ShipIT/issues/28), [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#32](https://github.com/ShippingCo/ShipIT/issues/32), [#33](https://github.com/ShippingCo/ShipIT/issues/33) | Blocked |

## M3 — WhatsApp Messaging & Automation

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#35](https://github.com/ShippingCo/ShipIT/issues/35) | Implement transactional outbox relay and durable job execution | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#11](https://github.com/ShippingCo/ShipIT/issues/11), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#22](https://github.com/ShippingCo/ShipIT/issues/22) | Blocked |
| [#36](https://github.com/ShippingCo/ShipIT/issues/36) | Integrate WhatsApp provider configuration and approved template registry | [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#35](https://github.com/ShippingCo/ShipIT/issues/35) | Blocked |
| [#37](https://github.com/ShippingCo/ShipIT/issues/37) | Add signed, idempotent WhatsApp webhook ingestion | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#36](https://github.com/ShippingCo/ShipIT/issues/36) | Blocked |
| [#38](https://github.com/ShippingCo/ShipIT/issues/38) | Implement scoped messaging consent and send-time policy checks | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#36](https://github.com/ShippingCo/ShipIT/issues/36), [#37](https://github.com/ShippingCo/ShipIT/issues/37) | Blocked |
| [#39](https://github.com/ShippingCo/ShipIT/issues/39) | Implement durable outbound WhatsApp queue and delivery reconciliation | [#35](https://github.com/ShippingCo/ShipIT/issues/35), [#36](https://github.com/ShippingCo/ShipIT/issues/36), [#37](https://github.com/ShippingCo/ShipIT/issues/37), [#38](https://github.com/ShippingCo/ShipIT/issues/38) | Blocked |
| [#40](https://github.com/ShippingCo/ShipIT/issues/40) | Implement event-to-notification automation policies | [#4](https://github.com/ShippingCo/ShipIT/issues/4), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#28](https://github.com/ShippingCo/ShipIT/issues/28), [#35](https://github.com/ShippingCo/ShipIT/issues/35), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#39](https://github.com/ShippingCo/ShipIT/issues/39) | Blocked |
| [#41](https://github.com/ShippingCo/ShipIT/issues/41) | Implement route-delay customer notification fanout | [#28](https://github.com/ShippingCo/ShipIT/issues/28), [#39](https://github.com/ShippingCo/ShipIT/issues/39), [#40](https://github.com/ShippingCo/ShipIT/issues/40) | Blocked |
| [#42](https://github.com/ShippingCo/ShipIT/issues/42) | Implement secure delivery challenges and atomic delivery completion | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#39](https://github.com/ShippingCo/ShipIT/issues/39) | Blocked |
| [#43](https://github.com/ShippingCo/ShipIT/issues/43) | Automate delivery attempt, RTO and completion notifications | [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#39](https://github.com/ShippingCo/ShipIT/issues/39), [#40](https://github.com/ShippingCo/ShipIT/issues/40), [#42](https://github.com/ShippingCo/ShipIT/issues/42) | Blocked |
| [#44](https://github.com/ShippingCo/ShipIT/issues/44) | Migrate messaging history and automation feed to provider-backed records | [#18](https://github.com/ShippingCo/ShipIT/issues/18), [#37](https://github.com/ShippingCo/ShipIT/issues/37), [#39](https://github.com/ShippingCo/ShipIT/issues/39), [#40](https://github.com/ShippingCo/ShipIT/issues/40), [#41](https://github.com/ShippingCo/ShipIT/issues/41), [#43](https://github.com/ShippingCo/ShipIT/issues/43) | Blocked |
| [#45](https://github.com/ShippingCo/ShipIT/issues/45) | Verify end-to-end automation durability and messaging failure recovery | [#34](https://github.com/ShippingCo/ShipIT/issues/34), [#41](https://github.com/ShippingCo/ShipIT/issues/41), [#42](https://github.com/ShippingCo/ShipIT/issues/42), [#43](https://github.com/ShippingCo/ShipIT/issues/43), [#44](https://github.com/ShippingCo/ShipIT/issues/44) | Blocked |

## M4 — Customer Self-Service & Assistant

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#46](https://github.com/ShippingCo/ShipIT/issues/46) | Implement verified customer identity and private shipment self-service | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#37](https://github.com/ShippingCo/ShipIT/issues/37), [#38](https://github.com/ShippingCo/ShipIT/issues/38) | Blocked |
| [#47](https://github.com/ShippingCo/ShipIT/issues/47) | Implement deterministic conversation routing and trusted operational tools | [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#28](https://github.com/ShippingCo/ShipIT/issues/28), [#30](https://github.com/ShippingCo/ShipIT/issues/30), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#42](https://github.com/ShippingCo/ShipIT/issues/42), [#46](https://github.com/ShippingCo/ShipIT/issues/46) | Blocked |
| [#48](https://github.com/ShippingCo/ShipIT/issues/48) | Add shipment quotes and configurable heavy-shipment routing | [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#46](https://github.com/ShippingCo/ShipIT/issues/46), [#47](https://github.com/ShippingCo/ShipIT/issues/47) | Blocked |
| [#49](https://github.com/ShippingCo/ShipIT/issues/49) | Implement pickup requests and staff acceptance workflow | [#17](https://github.com/ShippingCo/ShipIT/issues/17), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#46](https://github.com/ShippingCo/ShipIT/issues/46), [#48](https://github.com/ShippingCo/ShipIT/issues/48) | Blocked |
| [#50](https://github.com/ShippingCo/ShipIT/issues/50) | Implement human escalation queue and safe staff handoff | [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#39](https://github.com/ShippingCo/ShipIT/issues/39), [#46](https://github.com/ShippingCo/ShipIT/issues/46), [#47](https://github.com/ShippingCo/ShipIT/issues/47) | Blocked |
| [#51](https://github.com/ShippingCo/ShipIT/issues/51) | Add optional multilingual intent interpretation with deterministic safeguards | [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#47](https://github.com/ShippingCo/ShipIT/issues/47), [#48](https://github.com/ShippingCo/ShipIT/issues/48), [#50](https://github.com/ShippingCo/ShipIT/issues/50) | Blocked |
| [#52](https://github.com/ShippingCo/ShipIT/issues/52) | Add assistant outcome metrics and self-service regression evidence | [#45](https://github.com/ShippingCo/ShipIT/issues/45), [#47](https://github.com/ShippingCo/ShipIT/issues/47), [#48](https://github.com/ShippingCo/ShipIT/issues/48), [#49](https://github.com/ShippingCo/ShipIT/issues/49), [#50](https://github.com/ShippingCo/ShipIT/issues/50), [#51](https://github.com/ShippingCo/ShipIT/issues/51) | Blocked |

## M5 — Courier Integrations & Pricing

Issue #53's [carrier contract](architecture/carrier-contract.md) defines independent
manual/file/API capabilities, stable courier/service/destination identity and separate
selling-rate versus estimated/actual-cost provenance. See its
[verification record](architecture/issue-53-verification.md) for local implementation status;
the historical planning labels below are not a live readiness check.

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#53](https://github.com/ShippingCo/ShipIT/issues/53) | Add carrier adapter contract and capability model | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#4](https://github.com/ShippingCo/ShipIT/issues/4) | Blocked |
| [#54](https://github.com/ShippingCo/ShipIT/issues/54) | Implement manual carrier workflow and normalized reference mapping | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#53](https://github.com/ShippingCo/ShipIT/issues/53) | Blocked |
| [#55](https://github.com/ShippingCo/ShipIT/issues/55) | Implement validated CSV shipment and tracking imports | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#35](https://github.com/ShippingCo/ShipIT/issues/35), [#53](https://github.com/ShippingCo/ShipIT/issues/53), [#54](https://github.com/ShippingCo/ShipIT/issues/54) | Blocked |
| [#56](https://github.com/ShippingCo/ShipIT/issues/56) | Research Akash Ganga integration access and recommend an adapter strategy | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#53](https://github.com/ShippingCo/ShipIT/issues/53) | Blocked |
| [#57](https://github.com/ShippingCo/ShipIT/issues/57) | Research Maruti integration access and recommend an adapter strategy | [#2](https://github.com/ShippingCo/ShipIT/issues/2), [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#53](https://github.com/ShippingCo/ShipIT/issues/53) | Blocked |
| [#58](https://github.com/ShippingCo/ShipIT/issues/58) | Implement idempotent tracking ingestion and carrier reconciliation | [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#35](https://github.com/ShippingCo/ShipIT/issues/35), [#53](https://github.com/ShippingCo/ShipIT/issues/53), [#54](https://github.com/ShippingCo/ShipIT/issues/54), [#55](https://github.com/ShippingCo/ShipIT/issues/55) | Blocked |
| [#59](https://github.com/ShippingCo/ShipIT/issues/59) | Implement carrier rate-card imports and service/location normalization | [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#53](https://github.com/ShippingCo/ShipIT/issues/53), [#55](https://github.com/ShippingCo/ShipIT/issues/55) | Blocked |
| [#60](https://github.com/ShippingCo/ShipIT/issues/60) | Deliver the first verified carrier integration and health runbook | [#53](https://github.com/ShippingCo/ShipIT/issues/53), [#56](https://github.com/ShippingCo/ShipIT/issues/56), [#57](https://github.com/ShippingCo/ShipIT/issues/57), [#58](https://github.com/ShippingCo/ShipIT/issues/58), [#59](https://github.com/ShippingCo/ShipIT/issues/59) | Blocked |

## M6 — Reporting, Compliance & Operations

All 21 M6 issues are listed here with their combined prerequisites.

The closed #61 reporting framework is documented in the
[report guide](architecture/reporting.md) and its
[verification record](architecture/issue-61-verification.md): scoped booking
snapshots, separate financial measures, source versions, unknown evidence, Kolkata
cutoffs, limits and runtime grants. Downstream consumers retain their own scope.

| Issue | Implementation scope | Prerequisites | Status (2026-10-10) |
| --- | --- | --- | --- |
| [#61](https://github.com/ShippingCo/ShipIT/issues/61) | Implement scoped reporting queries and safe CSV exports | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#21](https://github.com/ShippingCo/ShipIT/issues/21), [#23](https://github.com/ShippingCo/ShipIT/issues/23), [#29](https://github.com/ShippingCo/ShipIT/issues/29) | Closed |
| [#62](https://github.com/ShippingCo/ShipIT/issues/62) | Implement sales register and GST summary reports | [#21](https://github.com/ShippingCo/ShipIT/issues/21), [#30](https://github.com/ShippingCo/ShipIT/issues/30), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#142](https://github.com/ShippingCo/ShipIT/issues/142) | Blocked |
| [#63](https://github.com/ShippingCo/ShipIT/issues/63) | Implement To-Pay ageing and collection reconciliation reports | [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#142](https://github.com/ShippingCo/ShipIT/issues/142) | Blocked |
| [#64](https://github.com/ShippingCo/ShipIT/issues/64) | Implement destination, delivery and route performance reports | [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#27](https://github.com/ShippingCo/ShipIT/issues/27), [#28](https://github.com/ShippingCo/ShipIT/issues/28), [#42](https://github.com/ShippingCo/ShipIT/issues/42), [#61](https://github.com/ShippingCo/ShipIT/issues/61) | Ready |
| [#65](https://github.com/ShippingCo/ShipIT/issues/65) | Implement messaging and assistant effectiveness reports | [#44](https://github.com/ShippingCo/ShipIT/issues/44), [#52](https://github.com/ShippingCo/ShipIT/issues/52), [#61](https://github.com/ShippingCo/ShipIT/issues/61) | Ready |
| [#66](https://github.com/ShippingCo/ShipIT/issues/66) | Implement versioned franchise settings and organization reporting scope | [#14](https://github.com/ShippingCo/ShipIT/issues/14), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#17](https://github.com/ShippingCo/ShipIT/issues/17), [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#21](https://github.com/ShippingCo/ShipIT/issues/21), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Blocked |
| [#67](https://github.com/ShippingCo/ShipIT/issues/67) | Verify report reconciliation, compliance provenance and audit drill-through | [#32](https://github.com/ShippingCo/ShipIT/issues/32), [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#63](https://github.com/ShippingCo/ShipIT/issues/63), [#64](https://github.com/ShippingCo/ShipIT/issues/64), [#65](https://github.com/ShippingCo/ShipIT/issues/65), [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#145](https://github.com/ShippingCo/ShipIT/issues/145), [#146](https://github.com/ShippingCo/ShipIT/issues/146), [#147](https://github.com/ShippingCo/ShipIT/issues/147), [#148](https://github.com/ShippingCo/ShipIT/issues/148), [#149](https://github.com/ShippingCo/ShipIT/issues/149), [#150](https://github.com/ShippingCo/ShipIT/issues/150) | Blocked |
| [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Ratify financial operations, account billing and reconciliation contracts | [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#14](https://github.com/ShippingCo/ShipIT/issues/14), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#19](https://github.com/ShippingCo/ShipIT/issues/19), [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#21](https://github.com/ShippingCo/ShipIT/issues/21), [#22](https://github.com/ShippingCo/ShipIT/issues/22), [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#30](https://github.com/ShippingCo/ShipIT/issues/30), [#42](https://github.com/ShippingCo/ShipIT/issues/42) | Ready |
| [#138](https://github.com/ShippingCo/ShipIT/issues/138) | Extend payment recording with methods, receiving accounts and allocation evidence | [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#33](https://github.com/ShippingCo/ShipIT/issues/33), [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Blocked |
| [#139](https://github.com/ShippingCo/ShipIT/issues/139) | Implement approved discounts, cancellations, refunds and financial adjustment audit | [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#22](https://github.com/ShippingCo/ShipIT/issues/22), [#29](https://github.com/ShippingCo/ShipIT/issues/29), [#30](https://github.com/ShippingCo/ShipIT/issues/30), [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Blocked |
| [#140](https://github.com/ShippingCo/ShipIT/issues/140) | Implement expense records, cashbook movements and acknowledged cash transfers | [#137](https://github.com/ShippingCo/ShipIT/issues/137), [#138](https://github.com/ShippingCo/ShipIT/issues/138) | Blocked |
| [#141](https://github.com/ShippingCo/ShipIT/issues/141) | Implement monthly customer accounts, negotiated rates and credit controls | [#19](https://github.com/ShippingCo/ShipIT/issues/19), [#20](https://github.com/ShippingCo/ShipIT/issues/20), [#22](https://github.com/ShippingCo/ShipIT/issues/22), [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Blocked |
| [#142](https://github.com/ShippingCo/ShipIT/issues/142) | Implement monthly account bills, statements and customer payment allocation | [#30](https://github.com/ShippingCo/ShipIT/issues/30), [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#141](https://github.com/ShippingCo/ShipIT/issues/141) | Blocked |
| [#143](https://github.com/ShippingCo/ShipIT/issues/143) | Implement temporary delivery-agent onboarding and parcel handover receipts | [#14](https://github.com/ShippingCo/ShipIT/issues/14), [#24](https://github.com/ShippingCo/ShipIT/issues/24), [#27](https://github.com/ShippingCo/ShipIT/issues/27), [#42](https://github.com/ShippingCo/ShipIT/issues/42), [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Blocked |
| [#144](https://github.com/ShippingCo/ShipIT/issues/144) | Implement delivery-agent cash, COD, fees and end-of-day settlement | [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#140](https://github.com/ShippingCo/ShipIT/issues/140), [#143](https://github.com/ShippingCo/ShipIT/issues/143) | Blocked |
| [#145](https://github.com/ShippingCo/ShipIT/issues/145) | Implement daily cash counting, closing approval and discrepancy accountability | [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#140](https://github.com/ShippingCo/ShipIT/issues/140), [#144](https://github.com/ShippingCo/ShipIT/issues/144) | Blocked |
| [#146](https://github.com/ShippingCo/ShipIT/issues/146) | Implement bank and payment statement reconciliation with exception review | [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#139](https://github.com/ShippingCo/ShipIT/issues/139) | Blocked |
| [#147](https://github.com/ShippingCo/ShipIT/issues/147) | Implement shipment cost capture and revenue contribution analysis | [#59](https://github.com/ShippingCo/ShipIT/issues/59), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#137](https://github.com/ShippingCo/ShipIT/issues/137), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#140](https://github.com/ShippingCo/ShipIT/issues/140), [#144](https://github.com/ShippingCo/ShipIT/issues/144) | Blocked |
| [#148](https://github.com/ShippingCo/ShipIT/issues/148) | Implement owner daily sales dashboard and comparable business metrics | [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#63](https://github.com/ShippingCo/ShipIT/issues/63), [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#142](https://github.com/ShippingCo/ShipIT/issues/142) | Blocked |
| [#149](https://github.com/ShippingCo/ShipIT/issues/149) | Implement scheduled owner summaries and overdue operational alerts | [#35](https://github.com/ShippingCo/ShipIT/issues/35), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#39](https://github.com/ShippingCo/ShipIT/issues/39), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#63](https://github.com/ShippingCo/ShipIT/issues/63), [#64](https://github.com/ShippingCo/ShipIT/issues/64), [#65](https://github.com/ShippingCo/ShipIT/issues/65), [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#145](https://github.com/ShippingCo/ShipIT/issues/145), [#146](https://github.com/ShippingCo/ShipIT/issues/146), [#147](https://github.com/ShippingCo/ShipIT/issues/147), [#148](https://github.com/ShippingCo/ShipIT/issues/148) | Blocked |
| [#150](https://github.com/ShippingCo/ShipIT/issues/150) | Implement accountant invoice register and versioned accounting exports | [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#63](https://github.com/ShippingCo/ShipIT/issues/63), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#140](https://github.com/ShippingCo/ShipIT/issues/140), [#142](https://github.com/ShippingCo/ShipIT/issues/142), [#144](https://github.com/ShippingCo/ShipIT/issues/144), [#146](https://github.com/ShippingCo/ShipIT/issues/146) | Blocked |

### M6 execution order — 10 October 2026

#61 is closed. All prerequisites outside M6 are closed in GitHub; merged producer
contracts must still be checked before implementation. Issue numbers do not set
execution order. #137–#150 are part of M6, not later milestones. The full declared
96-issue prerequisite graph has no cycles or missing references; M6 has no M7/M8
ancestors. No prerequisite or approved acceptance scope is removed by this cleanup.

| Stage | Issues | Execution rule |
| --- | --- | --- |
| 1 | [#137](https://github.com/ShippingCo/ShipIT/issues/137), [#64](https://github.com/ShippingCo/ShipIT/issues/64), [#65](https://github.com/ShippingCo/ShipIT/issues/65) | Ready to start after normal contract review. |
| 2 | [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#139](https://github.com/ShippingCo/ShipIT/issues/139), [#141](https://github.com/ShippingCo/ShipIT/issues/141), [#143](https://github.com/ShippingCo/ShipIT/issues/143), [#66](https://github.com/ShippingCo/ShipIT/issues/66) | Start each issue after its own listed prerequisites are merged; stages are guidance, not extra dependencies. |
| 3 | [#140](https://github.com/ShippingCo/ShipIT/issues/140), [#142](https://github.com/ShippingCo/ShipIT/issues/142), [#146](https://github.com/ShippingCo/ShipIT/issues/146) | Start each issue after its own listed prerequisites are merged; stages are guidance, not extra dependencies. |
| 4 | [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#63](https://github.com/ShippingCo/ShipIT/issues/63), [#144](https://github.com/ShippingCo/ShipIT/issues/144) | Start each issue after its own listed prerequisites are merged; stages are guidance, not extra dependencies. |
| 5 | [#145](https://github.com/ShippingCo/ShipIT/issues/145), [#147](https://github.com/ShippingCo/ShipIT/issues/147), [#148](https://github.com/ShippingCo/ShipIT/issues/148), [#150](https://github.com/ShippingCo/ShipIT/issues/150) | Start each issue after its own listed prerequisites are merged; stages are guidance, not extra dependencies. |
| 6 | [#149](https://github.com/ShippingCo/ShipIT/issues/149) | Start each issue after its own listed prerequisites are merged; stages are guidance, not extra dependencies. |
| 7 | [#67](https://github.com/ShippingCo/ShipIT/issues/67) | Start each issue after its own listed prerequisites are merged; stages are guidance, not extra dependencies. |

Readiness is a dated snapshot, not permission to skip acceptance, CI or review.
Only #64, #65 and #137 are ready; the other 17 open M6 issues remain blocked.
The stale blocked label on closed #61 is removed. Non-status labels are preserved.
#65 explicitly lists #149 as downstream work, matching #149's prerequisites.

[PR #161](https://github.com/ShippingCo/ShipIT/pull/161) delivered #61.
The merged prerequisite PRs for #64/#65 are
[#107](https://github.com/ShippingCo/ShipIT/pull/107),
[#110](https://github.com/ShippingCo/ShipIT/pull/110),
[#111](https://github.com/ShippingCo/ShipIT/pull/111),
[#126](https://github.com/ShippingCo/ShipIT/pull/126),
[#128](https://github.com/ShippingCo/ShipIT/pull/128),
[#151](https://github.com/ShippingCo/ShipIT/pull/151) and #161.

#62 and #63 stay open and blocked. [PR #162](https://github.com/ShippingCo/ShipIT/pull/162)
and [PR #163](https://github.com/ShippingCo/ShipIT/pull/163) delivered partial work;
reuse it without treating #139/#142 or #138/#139/#142, respectively, as complete.
#137 ratifies finance policy before the remaining producer work. The finance modules
remain required for #67 and the #76 pilot release gate.

## M7 — Production Readiness & Pilot

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#68](https://github.com/ShippingCo/ShipIT/issues/68) | Provision isolated staging and production deployment pipelines | [#5](https://github.com/ShippingCo/ShipIT/issues/5), [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#11](https://github.com/ShippingCo/ShipIT/issues/11), [#18](https://github.com/ShippingCo/ShipIT/issues/18), [#35](https://github.com/ShippingCo/ShipIT/issues/35) | Blocked |
| [#69](https://github.com/ShippingCo/ShipIT/issues/69) | Implement backup policy and prove database and object restore | [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#10](https://github.com/ShippingCo/ShipIT/issues/10), [#31](https://github.com/ShippingCo/ShipIT/issues/31), [#68](https://github.com/ShippingCo/ShipIT/issues/68) | Blocked |
| [#70](https://github.com/ShippingCo/ShipIT/issues/70) | Add production monitoring, structured errors and actionable alerts | [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#35](https://github.com/ShippingCo/ShipIT/issues/35), [#39](https://github.com/ShippingCo/ShipIT/issues/39), [#58](https://github.com/ShippingCo/ShipIT/issues/58), [#68](https://github.com/ShippingCo/ShipIT/issues/68) | Blocked |
| [#71](https://github.com/ShippingCo/ShipIT/issues/71) | Audit authorization, tenant isolation and application abuse controls | [#15](https://github.com/ShippingCo/ShipIT/issues/15), [#31](https://github.com/ShippingCo/ShipIT/issues/31), [#42](https://github.com/ShippingCo/ShipIT/issues/42), [#44](https://github.com/ShippingCo/ShipIT/issues/44), [#46](https://github.com/ShippingCo/ShipIT/issues/46), [#60](https://github.com/ShippingCo/ShipIT/issues/60), [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#68](https://github.com/ShippingCo/ShipIT/issues/68) | Blocked |
| [#72](https://github.com/ShippingCo/ShipIT/issues/72) | Implement customer privacy lifecycle, retention and deletion workflows | [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#8](https://github.com/ShippingCo/ShipIT/issues/8), [#16](https://github.com/ShippingCo/ShipIT/issues/16), [#31](https://github.com/ShippingCo/ShipIT/issues/31), [#38](https://github.com/ShippingCo/ShipIT/issues/38), [#44](https://github.com/ShippingCo/ShipIT/issues/44), [#46](https://github.com/ShippingCo/ShipIT/issues/46), [#69](https://github.com/ShippingCo/ShipIT/issues/69) | Blocked |
| [#73](https://github.com/ShippingCo/ShipIT/issues/73) | Audit secrets, dependencies and software supply-chain controls | [#5](https://github.com/ShippingCo/ShipIT/issues/5), [#6](https://github.com/ShippingCo/ShipIT/issues/6), [#36](https://github.com/ShippingCo/ShipIT/issues/36), [#60](https://github.com/ShippingCo/ShipIT/issues/60), [#68](https://github.com/ShippingCo/ShipIT/issues/68) | Blocked |
| [#74](https://github.com/ShippingCo/ShipIT/issues/74) | Run load, concurrency and failure-recovery qualification | [#45](https://github.com/ShippingCo/ShipIT/issues/45), [#60](https://github.com/ShippingCo/ShipIT/issues/60), [#67](https://github.com/ShippingCo/ShipIT/issues/67), [#68](https://github.com/ShippingCo/ShipIT/issues/68), [#69](https://github.com/ShippingCo/ShipIT/issues/69), [#70](https://github.com/ShippingCo/ShipIT/issues/70) | Blocked |
| [#75](https://github.com/ShippingCo/ShipIT/issues/75) | Prepare pilot onboarding, operator runbooks and fictional demo environment | [#17](https://github.com/ShippingCo/ShipIT/issues/17), [#34](https://github.com/ShippingCo/ShipIT/issues/34), [#44](https://github.com/ShippingCo/ShipIT/issues/44), [#49](https://github.com/ShippingCo/ShipIT/issues/49), [#50](https://github.com/ShippingCo/ShipIT/issues/50), [#60](https://github.com/ShippingCo/ShipIT/issues/60), [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#68](https://github.com/ShippingCo/ShipIT/issues/68), [#70](https://github.com/ShippingCo/ShipIT/issues/70), [#72](https://github.com/ShippingCo/ShipIT/issues/72) | Blocked |
| [#76](https://github.com/ShippingCo/ShipIT/issues/76) | Approve pilot release readiness and establish feedback triage | [#45](https://github.com/ShippingCo/ShipIT/issues/45), [#52](https://github.com/ShippingCo/ShipIT/issues/52), [#60](https://github.com/ShippingCo/ShipIT/issues/60), [#67](https://github.com/ShippingCo/ShipIT/issues/67), [#69](https://github.com/ShippingCo/ShipIT/issues/69), [#70](https://github.com/ShippingCo/ShipIT/issues/70), [#71](https://github.com/ShippingCo/ShipIT/issues/71), [#72](https://github.com/ShippingCo/ShipIT/issues/72), [#73](https://github.com/ShippingCo/ShipIT/issues/73), [#74](https://github.com/ShippingCo/ShipIT/issues/74), [#75](https://github.com/ShippingCo/ShipIT/issues/75) | Blocked |

## M8 — Commercial SaaS & Scale

| Issue | Implementation scope | Prerequisites | Initial status |
| --- | --- | --- | --- |
| [#77](https://github.com/ShippingCo/ShipIT/issues/77) | Define commercial plans, entitlements and usage metering | [#76](https://github.com/ShippingCo/ShipIT/issues/76) | Blocked |
| [#78](https://github.com/ShippingCo/ShipIT/issues/78) | Implement SaaS subscriptions, billing webhooks and trial lifecycle | [#77](https://github.com/ShippingCo/ShipIT/issues/77) | Blocked |
| [#79](https://github.com/ShippingCo/ShipIT/issues/79) | Implement controlled franchise adoption and large-organization onboarding | [#3](https://github.com/ShippingCo/ShipIT/issues/3), [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#72](https://github.com/ShippingCo/ShipIT/issues/72), [#76](https://github.com/ShippingCo/ShipIT/issues/76) | Blocked |
| [#80](https://github.com/ShippingCo/ShipIT/issues/80) | Implement time-limited, approved and audited support access | [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#72](https://github.com/ShippingCo/ShipIT/issues/72), [#76](https://github.com/ShippingCo/ShipIT/issues/76) | Blocked |
| [#81](https://github.com/ShippingCo/ShipIT/issues/81) | Implement enterprise SSO and identity provisioning controls | [#70](https://github.com/ShippingCo/ShipIT/issues/70), [#76](https://github.com/ShippingCo/ShipIT/issues/76), [#77](https://github.com/ShippingCo/ShipIT/issues/77), [#79](https://github.com/ShippingCo/ShipIT/issues/79) | Blocked |
| [#82](https://github.com/ShippingCo/ShipIT/issues/82) | Implement bounded white-label branding and verified domain mapping | [#66](https://github.com/ShippingCo/ShipIT/issues/66), [#76](https://github.com/ShippingCo/ShipIT/issues/76) | Blocked |
| [#83](https://github.com/ShippingCo/ShipIT/issues/83) | Implement enterprise service-level reporting and operational commitments | [#70](https://github.com/ShippingCo/ShipIT/issues/70), [#76](https://github.com/ShippingCo/ShipIT/issues/76), [#77](https://github.com/ShippingCo/ShipIT/issues/77), [#79](https://github.com/ShippingCo/ShipIT/issues/79) | Blocked |

<!-- finance-plan:2026-10-03 -->
## Approved financial-management expansion — 2026-10-03

The approved expansion adds 14 M6 issues to the original 82, for **96** total.
All **21 M6 issues** and their combined dependencies are consolidated in the M6
table above. Read the [module map](FINANCIAL_MANAGEMENT_PLAN.md) and live issue
acceptance criteria for scope; no issue is renumbered, split, closed or reduced here.

### Additional prerequisites for existing issues

These M7 edges are added to the original M7 prerequisite lists above. M6 additions are already included in its combined table.
They are completion gates for the expanded scope; original infrastructure/framework
work may start as its original contracts permit. Status labels are not proof of readiness.

| Existing issue | Added prerequisites |
| --- | --- |
| Extra prerequisites for #69 | [#142](https://github.com/ShippingCo/ShipIT/issues/142), [#145](https://github.com/ShippingCo/ShipIT/issues/145), [#146](https://github.com/ShippingCo/ShipIT/issues/146), [#149](https://github.com/ShippingCo/ShipIT/issues/149), [#150](https://github.com/ShippingCo/ShipIT/issues/150) |
| Extra prerequisites for #70 | [#145](https://github.com/ShippingCo/ShipIT/issues/145), [#146](https://github.com/ShippingCo/ShipIT/issues/146), [#149](https://github.com/ShippingCo/ShipIT/issues/149) |
| Extra prerequisites for #71 | [#142](https://github.com/ShippingCo/ShipIT/issues/142), [#144](https://github.com/ShippingCo/ShipIT/issues/144), [#145](https://github.com/ShippingCo/ShipIT/issues/145), [#146](https://github.com/ShippingCo/ShipIT/issues/146), [#149](https://github.com/ShippingCo/ShipIT/issues/149), [#150](https://github.com/ShippingCo/ShipIT/issues/150) |
| Extra prerequisites for #72 | [#142](https://github.com/ShippingCo/ShipIT/issues/142), [#146](https://github.com/ShippingCo/ShipIT/issues/146), [#149](https://github.com/ShippingCo/ShipIT/issues/149), [#150](https://github.com/ShippingCo/ShipIT/issues/150) |
| Extra prerequisites for #75 | [#67](https://github.com/ShippingCo/ShipIT/issues/67) |

Existing issues #53, #59, #61–#64, #66–#67, #69–#72 and #74–#76 contain labelled
additions preserving the original scope and acceptance criteria. M6 dependency
guidance is consolidated above and in each live issue. All new issues
feed the #76 pilot gate; no M8 commercial issue is a prerequisite for this expansion.

## Issue #62 local implementation note (2026-10-04)

The sales/GST implementation and necessary bounded financial producers are
documented in [reporting](architecture/reporting.md),
[ADR 0045](adr/0045-sales-and-financial-evidence.md) and the
[verification record](architecture/issue-62-verification.md).
Combined prerequisites remain #21, #30, #61, #139 and #142. The local producer
subset supports reductions, actual refunds and account statements without duplicate
sales; it does not close the wider credit/allocation workflows in #137-#142.
The M6 status snapshot above is dated 10 October; review and dependency closure
must be verified before claiming the GitHub issue complete.

## Issue #63 original reporting scope (2026-10-04)

Local To-Pay ageing consumes existing booking obligations, collection/reversal
entries and #62's financial changes. See [the report guide](architecture/reporting.md#to-pay-ageing-and-collection-reconciliation-63).
The original report scope can be reviewed separately; expanded #63 remains
blocked on monthly terms/debtor accounts, combined allocations and advances
from #137/#138/#141/#142. This does not close those issues or claim all of #63.
