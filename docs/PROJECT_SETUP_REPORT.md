# Project setup verification

Repository: [ShippingCo/ShipIT](https://github.com/ShippingCo/ShipIT). Inspected and configured with administrator access on 2026-09-05. No product features or runtime dependencies were implemented/changed.

Initial setup branch: `chore/project-roadmap-and-engineering-workflow`; [setup PR #1](https://github.com/ShippingCo/ShipIT/pull/1) merged after self-review and passing CI. Initial setup merge: `5358dda90b6d15a1c38bb4ee2bafd9e3f9e50ebf`. Follow-up branch `chore/link-roadmap-issues` replaces draft identifiers with exact GitHub links and records the final audit. Setup did not fabricate an independent reviewer; final main protection requires independent approval for future work.

## Published backlog

82 detailed issues, nine milestones. Two ready, 80 blocked on explicit prerequisites. M8 contains seven post-MVP issues; white-label branding/support access and enterprise identity/service-level reports have separate PR-sized scopes.

| Milestone | Issues | Range | First ready now |
| --- | ---: | --- | --- |
| [M0 — Engineering & Architecture Foundation](https://github.com/ShippingCo/ShipIT/milestone/1) | 8 | #2–#9 | #2, #5 |
| [M1 — SaaS, Database & Franchise Foundation](https://github.com/ShippingCo/ShipIT/milestone/2) | 9 | #10–#18 | None; prerequisites blocked |
| [M2 — Core Courier Operations](https://github.com/ShippingCo/ShipIT/milestone/3) | 16 | #19–#34 | None; prerequisites blocked |
| [M3 — WhatsApp Messaging & Automation](https://github.com/ShippingCo/ShipIT/milestone/4) | 11 | #35–#45 | None; prerequisites blocked |
| [M4 — Customer Self-Service & Assistant](https://github.com/ShippingCo/ShipIT/milestone/5) | 7 | #46–#52 | None; prerequisites blocked |
| [M5 — Courier Integrations & Pricing](https://github.com/ShippingCo/ShipIT/milestone/6) | 8 | #53–#60 | None; prerequisites blocked |
| [M6 — Reporting, Compliance & Operations](https://github.com/ShippingCo/ShipIT/milestone/7) | 7 | #61–#67 | None; prerequisites blocked |
| [M7 — Production Readiness & Pilot](https://github.com/ShippingCo/ShipIT/milestone/8) | 9 | #68–#76 | None; prerequisites blocked |
| [M8 — Commercial SaaS & Scale](https://github.com/ShippingCo/ShipIT/milestone/9) | 7 | #77–#83 | None; prerequisites blocked |

Every published issue body, title, label set and milestone assignment was fetched and compared with the final reviewed draft. Every dependency/blocker reference resolves to a fetched issue. The graph is acyclic, all M0–M7 work contributes to #76 pilot approval, and no M8 issue is a pilot prerequisite. Every implementation issue includes outcome, scope/non-goals, current state, data/API/event contracts, ownership/security, failure/retry rules, tailored checkboxes/scenarios, automated test expectations, rollout/documentation, full DoD and the mandatory 17-step branch/PR/main-pull workflow. Carrier research uses an evidence-focused research format plus the same Git workflow.

## Labels

40 managed labels: 37 new labels and three normalized existing labels. Seven orthogonal triage labels retained; 47 total. No duplicate `bug`, `enhancement` or `documentation` synonyms remain.

- `type: feature`, `type: bug`, `type: architecture`, `type: infrastructure`, `type: security`, `type: documentation`, `type: research`, `type: refactor`, `type: test`.
- `area: frontend`, `area: api`, `area: database`, `area: auth`, `area: tenancy`, `area: organizations`, `area: franchises`, `area: customers`, `area: bookings`, `area: parcels`, `area: pricing`, `area: payments`, `area: lots`, `area: routes`, `area: whatsapp`, `area: automation`, `area: assistant`, `area: integrations`, `area: reporting`, `area: compliance`, `area: observability`, `area: deployment`.
- `priority: P0`, `priority: P1`, `priority: P2`, `priority: P3`.
- `status: blocked`, `status: ready`, `status: in-progress`, `status: review`.
- `risk: high`.

Normalized: bug → type: bug, documentation → type: documentation, enhancement → type: feature. Retained: accessibility, duplicate, good first issue, help wanted, invalid, question, wontfix.

## Repository artifacts and verification

- Four issue templates: implementation, focused bug, research, security/infrastructure; chooser disables blank issues and directs sensitive findings to private reporting.
- PR template covers issue linkage, scope, tests/checks, security/privacy, tenancy, demo, migration/recovery and pre/post-merge DoD.
- CONTRIBUTING, engineering workflow, roadmap, linked issue index, prototype transition, inspection notes and SECURITY document created. README and stale agent/design notes updated.
- CI runs planning validation, all 23 existing frontend tests, workspace typechecks and production build using pinned actions/Node/pnpm, read-only permissions and locked install without lifecycle scripts.
- Existing React act warnings remain. Application lint is absent and explicitly owned by ready [#5](https://github.com/ShippingCo/ShipIT/issues/5); planning validation is not misrepresented as application lint. Product development is gated on the M0 baseline.
- Private vulnerability reporting is enabled. Final main protection policy, applied after setup/link merge: current/up-to-date required CI, PR with one approval, stale approval dismissal, resolved conversations, administrator enforcement, no force pushes or branch deletion. Completed PR branches are automatically deleted.

## Tooling limitation

GitHub Projects API/CLI cannot list/configure an organization board with the current token: `read:project` is missing and project write access is not established. No Project board was created. Milestones and execution labels are fully configured; no fake board URL or status-sync claim is made.

## Risks and decisions

High-risk issues carry `risk: high`, including tenant/session/RBAC isolation, bookings and money/tax, OTP delivery, provider callbacks/queues, external synchronization, private uploads, restore/deletion and ownership transfer. View the [high-risk backlog](https://github.com/ShippingCo/ShipIT/issues?q=is%3Aissue%20label%3A%22risk%3A%20high%22).

Preserve Fastify/raw SQL/node-pg-migrate and useful prototype UX. M0 must ratify remaining cardinality/auth/queue/policy decisions rather than allowing implementers to guess. No carrier API availability, legal certification, tax preset or retention duration is invented. Independent franchises and own-org multi-franchise access are first-class; cross-organization adoption is explicitly post-MVP. No milestone dates are invented.

## Recommended next issue

[#2 — Ratify production architecture, MVP boundaries and decision records](https://github.com/ShippingCo/ShipIT/issues/2). No dependencies. It fixes module ownership, authoritative services and unresolved architecture decisions before implementation. Suggested branch: `issue-2-production-architecture`, created only after `git checkout main` and `git pull origin main`. [#5](https://github.com/ShippingCo/ShipIT/issues/5) is independently ready for CI/lint baseline work.
