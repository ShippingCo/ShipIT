# Milestone 2 verification — Core Courier Operations

Verification date: 20 September 2026. All test identities and examples are synthetic.

## Issue closure state

GitHub Milestone `M2 — Core Courier Operations` contains Issues #19–#34. At this review point,
#19–#33 are merged and CLOSED. #34 is implemented by PR #118 and remains OPEN pending
independent final review and merge. The milestone is therefore **15/16 closed**, not complete;
neither Issue #34 nor the milestone was manually closed.

## Completion matrix

| Issue | Capability | Persistence / API evidence | Authorization evidence | Production UI | Tests | Owning docs | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #19 | Tenant-private Customers | `customers` table, command/audit receipts and scoped Customer API | R20/W26; only local franchise admin/operator write; foreign detail/search is 404-equivalent | #33 lookup/create/edit | `apps/api/test/database/customers.test.ts`, `packages/db/test/integration/customers.test.ts` | `customers.md`, `issue-19-verification.md` | Merged / closed |
| #20 | Versioned pricing | Persistent cards/rules, immutable published versions and quote API | R21/W27; privileged override and publication are explicit, with no org-admin inheritance | #33 quote and controlled override | `apps/api/test/database/pricing.test.ts`, `packages/db/test/integration/pricing.test.ts` | `pricing.md`, `issue-20-verification.md` | Merged / closed |
| #21 | Tax/GST evidence | Persistent tax intents/calculations and immutable confirmed snapshots | Role ceiling, creator binding and local-administrator jurisdiction resolution | #33 tax evidence and calculation | `apps/api/test/database/tax.test.ts`, `packages/db/test/integration/tax.test.ts` | `money-tax-proof-privacy-contract.md`, `issue-21-verification.md` | Merged / closed |
| #22 | Atomic Booking and dockets | One transaction persists Booking, permanent docket(s), Parcel(s), commercial snapshots, obligation and events | Booking remains operator-owned; nested Customer/pricing/tax scope is reauthorized | #33 counter Booking flow | `apps/api/test/database/bookings.test.ts`, `packages/db/test/integration/bookings.test.ts` | `bookings.md`, `issue-22-verification.md` | Merged / closed |
| #23 | Parcel reads and timeline | Scoped list/detail/exact-docket/timeline APIs over durable Booking/Parcel facts | Foreign/unknown selectors are indistinguishable; assignment limits delivery-agent reads | #34 Packages list/detail/timeline/search | `apps/api/test/database/bookings.test.ts` read cases | `issue-23-verification.md` | Merged / closed |
| #24 | Guarded Parcel lifecycle | Versioned commands append lifecycle history/audit atomically | Command-specific role matrix; no generic status write or browser delivery bypass | #34 guarded Package actions | `apps/api/test/database/parcel-lifecycle.test.ts` | `parcel-lifecycle.md`, `issue-24-verification.md` | Merged / closed |
| #25 | Bounded bulk Parcel commands | Durable outer/item receipts execute bounded commands sequentially | Each item reuses the exact single-command role/scope guard | #34 partial-result controller and deliberate failed-item retry | `apps/api/test/database/parcel-bulk.test.ts`, `packages/db/test/integration/parcel-bulk.test.ts`, `apps/web/src/test/parcel-bulk.test.tsx` | `parcel-bulk.md`, `issue-25-verification.md` | Merged / closed |
| #26 | Persistent Lots | Durable Lots and immutable membership history; exact add/move/remove APIs | R08/W04 plus dispatcher-only post-dispatch correction; foreign nested IDs stay hidden | #34 create/rename/archive/membership workflow | `apps/api/test/database/lots.test.ts`, `packages/db/test/integration/lots.test.ts` | `lots.md`, ADR 0016, `issue-26-verification.md` | Merged / closed |
| #27 | Routes and frozen manifests | Durable planning Routes, source provenance and retained immutable manifest snapshots | R09/W05/W06 and all-role matrix; foreign manifests match unknown | #34 planning, source attach/detach, finalize/archive and history inspection | `apps/api/test/database/routes.test.ts`, `packages/db/test/integration/routes.test.ts` | `routes.md`, ADR 0017, `issue-27-verification.md` | Merged / closed |
| #28 | Route events and ETA | Atomic departure/delay/arrival records and server-owned persisted ETA | W18 permits admin/operator/dispatcher events; dispatched-Parcel departure effects additionally require dispatcher/T04 | #34 event forms and latest server ETA; arrival never means delivery | `apps/api/test/database/route-events.test.ts`, `packages/db/test/integration/route-events.test.ts` | `route-events.md`, ADR 0018, `issue-28-verification.md` | Merged / closed |
| #29 | To-Pay ledger | Booking obligation plus append-only collections/reversals and current projection | Collection is franchise-admin only; accountant has finance reads, not collection; org-admin does not inherit | #33 optional counter collection; #34 fresh operational projection/collection | `apps/api/test/database/payments.test.ts`, `packages/db/test/integration/payments.test.ts` | `payments.md`, `issue-29-verification.md` | Merged / closed |
| #30 | Immutable receipts | Issued Booking/payment-entry artifacts persist independently of mutable source settings | R13 role matrix with private caching and tenant-safe identifiers | #33 discovery/view/print from issued DTO only | `apps/api/test/database/receipts.test.ts`, `packages/db/test/integration/receipts.test.ts` | `receipts.md`, ADR 0020, `issue-30-verification.md` | Merged / closed |
| #31 | Private attachments | Private object lifecycle plus durable metadata, command and audit rows | R14/W22, purpose/assignment limits, short-lived scoped download grants | #33 post-Booking upload workflow | `apps/api/test/database/attachments.test.ts`, `packages/db/test/integration/attachments.test.ts`, `apps/web/src/test/attachments.test.tsx` | `attachments.md`, `issue-31-verification.md` | Merged / closed |
| #32 | External e-way tracking | Durable current record, immutable revisions, reminders and explicit policy-labelled estimates | R15/W23; accountant receives restricted projection; foreign chains/counts are hidden | #34 reminders/current/history/capture/correction/estimate | `apps/api/test/database/eway.test.ts`, `packages/db/test/integration/eway.test.ts` | `eway.md`, ADR 0022, `issue-32-verification.md` | Merged / closed |
| #33 | Production counter UI | Scoped adapters compose existing Customer/pricing/tax/Booking/payment/receipt/attachment APIs | UI role gates are ceilings only; scope tickets fence reads and immutable commands | Customer/Booking/receipt production UI | `apps/web/src/test/counter.test.tsx` plus `counter-workflow.test.ts` | `production-data-access.md`, `issue-33-verification.md` | Merged / closed |
| #34 | Production operational UI | Scoped adapters compose Parcel/Lot/Route/payment/e-way APIs; no local operational store | Role-aware controls plus server authority, exact command identity and scope disposal | Dashboard, Packages, Lots, Routes and e-way production UI | `apps/web/src/test/operations.test.tsx`, `parcel-bulk.test.tsx`, owning DB suites | `production-data-access.md`, `issue-34-verification.md` | PR #118 open / pending merge |

## Cross-domain outcome

The delivered M2 authority chain is:

```text
authenticated operator → permitted franchise → Customer → pricing + tax
→ atomic Booking + permanent docket → Parcel → check-in → Lot grouping
→ Route planning → frozen manifest → dispatch → Route departure / in-transit
→ absolute Route delay / authoritative ETA → currently contracted exception / RTO commands
```

The Booking also owns the parallel To-Pay ledger, immutable receipts, private attachment
metadata/content grants and external e-way record history. The architecture remains:

```text
React → scoped production data access → Fastify domain services
      → capability-scoped raw SQL / PostgreSQL
```

Each write uses the owning domain's version, idempotency receipt, audit/event and transaction
rules. The browser displays returned projections; it does not become the system of record.

Trusted OTP/delivery proof, WhatsApp automation and customer messaging are M3. Customer tools
are M4, carrier integrations and pricing imports are M5, reporting is M6, production
deployment/pilot readiness is M7 and commercial SaaS work is M8. Reports, a full customer
portal, carrier/provider verification and deployment are not M2 completion defects and were
not implemented during this audit.

## Tenancy and authorization audit

The real PostgreSQL/Fastify suites create same-organization sibling franchises A/B and an
unrelated organization/franchise C where the domain needs them. Evidence is domain-specific,
not a mocked global claim:

| Domain | Foreign and nested-ID evidence |
| --- | --- |
| Customer | `customers.test.ts`: same phone across A1/A2/B1; foreign detail, search, replay and snapshots remain private |
| Booking / Parcel | `bookings.test.ts`: foreign Customer inputs, Parcel UUID/docket/status/date queries and cursors return scoped projections only |
| Lot / membership | `lots.test.ts`: real A/B/C Lots, memberships, reverse-scope and nested mutation denial |
| Route / manifest | `routes.test.ts`: sibling/unrelated Routes, sources and current/historical manifests are indistinguishable from unknown |
| Payment | `payments.test.ts`: foreign Bookings, nested collections, references, current projections and replay |
| Receipt | `receipts.test.ts`: foreign Booking/payment/receipt/correction identifiers |
| Attachment | `attachments.test.ts`: A1/A2/B1 Booking→Parcel→attachment chains, metadata, bytes, replay and composite ownership |
| E-way | `eway.test.ts`: A1/A2/B1 Booking chains, record/history/reminder counts and replay |

Representative all-role suites cover `org_admin`, `franchise_admin`, `operator`, `dispatcher`,
`delivery_agent`, `accountant` and `read_only`. In particular: read-only cannot mutate;
accountant and org-admin cannot collect payment; dispatcher receives no Customer write grant;
delivery-agent Parcel/attachment access remains assignment-specific; accountant e-way DTOs
exclude vehicle, distance, actor and reason; and a W18 Route departure cannot bypass the
dispatcher/T04 guard when dispatched Parcels would transition.

## Browser authority and scope audit

Production `App.tsx` selects `operator/OperatorApp` at build time. The fictional `DemoApp`,
`AppContext` and `data/store.ts` are reachable only from explicit demo composition.
`scripts/web-isolation.mjs` examines the rendered production module graph and forbidden output
markers, so an API error cannot activate demo data. Searches for `queueMsg`, `confirmDelivered`,
`revealOTP`, `EWAY_THRESHOLD`, `ewayValidDays` and local status/ETA mutation find them only in
the fictional demo tree. Production Routes reads `eta.revised_at` and absolute delay from the
server; Packages has no OTP reveal/resend/comparison or generic delivered action.

`ScopeController` generation changes abort and remount private resources. Existing
`data-access.test.ts`, `operator.test.tsx`, `parcel-bulk.test.tsx` and Issue #34 tests establish
A→B late-response suppression, a fresh read on B→A, and refusal to replay an immutable
mutation intent under changed user/franchise authority.

## Persistence, errors and concurrency

Representative restart evidence is executable: Customer, pricing/tax evidence, Booking/docket
and Parcel reads, lifecycle history, Lot/membership, Route/manifest, Route ETA/events, payment
ledger, receipt, attachment metadata and e-way records are all reread through fresh services
and/or pools in their owning database suites. Browser remount tests independently reread
Parcel/ledger/Route ETA projections rather than retaining local success.

The owning suites exercise `VERSION_CONFLICT`, `PARCEL_STATE_CONFLICT`, `LOT_STATE_CONFLICT`,
`LOT_MEMBERSHIP_CONFLICT`, `LOT_DESTINATION_MISMATCH`, `LOT_ACTIVE_ROUTE`,
`ROUTE_STATE_CONFLICT`, `ROUTE_MANIFEST_CONFLICT`, `PAYMENT_OVER_COLLECTION`,
`EWAY_ESTIMATE_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`,
`RESOURCE_NOT_FOUND`, `ACTION_FORBIDDEN` and `TEMPORARILY_UNAVAILABLE`. Transactions roll
back partial effects; known conflicts require a refresh and deliberate new command. Uncertain
dispatched mutations retain the exact operation/path/body/key/scope for reconciliation or an
explicit same-intent retry. The browser never converts these outcomes into local success.

## Quality record

The release-candidate run used Node 22.23.2, pnpm 10.34.5 and Python 3.12.14.
`pnpm db:local quality` passed 26 quality tests, 22 testkit tests, 12 DB unit tests,
419 API tests, 155 web tests, 3 object-store tests, 58 PostgreSQL DB tests and 234
PostgreSQL DB/API tests: **929 total**, with zero failed, skipped, cancelled or todo. The
production build transformed 101 modules. The isolated fictional demo build separately
transformed 1,929 modules. `pnpm check:migrations` confirmed all 21 released migrations are
unchanged, and `git diff --check` passed.

`verify:gates` is not independently required for this cleanup because PR #118 changes neither
quality/gate machinery nor production/demo isolation enforcement. The production isolation
test remains part of the normal quality run, and the isolated demo build is run separately.
