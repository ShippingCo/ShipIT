# ShippingCo

A customer-connection layer for small and mid-size Indian courier businesses. The
operator books a parcel once at the counter; every WhatsApp update the customer
receives after that — booking confirmation, dispatch, delay, out-for-delivery, OTP,
delivery — is sent automatically, and routine customer questions are answered without
anyone at the shop having to reply.

The default web entry now uses the Fastify/PostgreSQL API for verified operator login,
independent-franchise onboarding, invitations and a scope-aware workspace. New Booking now
composes franchise-private customers, server pricing/tax, atomic bookings, payment collections,
private attachments and optional immutable receipt printing. Receipts discovers saved bookings
through the production Parcel read API. [Counter verification and synthetic walkthrough](docs/architecture/issue-33-verification.md) documents that cutover. The production Dashboard, Packages, Lots, Routes, To-Pay and E-way screens now use the same scoped API architecture; see [Issue #34 verification](docs/architecture/issue-34-verification.md).

## Who it is designed for

The operator is an SME or SMB courier owner in India who may not read English fluently
and is usually serving a customer while using the app. That is the single constraint
that shapes the interface:

- Figures are led by an **icon and a number**; words are the third channel, never the
  only one.
- **No abstract charts.** Axes, legends and trend lines all have to be read, so quantity
  is shown as counted icons or as chunky bars with the number printed beside them.
- **Colour is rationed** to the two places it carries real meaning — whether anything
  needs the operator right now, and how old the uncollected money is. Colour lives in
  outlines, never in fills.
- Labels sit at a **15px floor** on primary screens, headline figures at 40px+.

`docs/DESIGN_BRIEF.md` sets this out in full.

## Layout

A pnpm workspace.

```
apps/
  web/        the React app — operator console and the simulated customer WhatsApp view
  api/        Fastify identity, tenancy, membership, audit, onboarding and customer API
packages/
  shared/     public DTOs, browser-safe constants and pure non-secret functions
  db/         Postgres pool and SQL migrations
docs/         design brief and working notes
```

`apps/api`, `packages/shared` and `packages/db` now implement the production infrastructure, identity, tenancy, membership and audit foundations.

The stack is React/Vite, Fastify and raw SQL over pg, migrated with node-pg-migrate.

## Running it

Requires Node **22.23.2**, [pnpm](https://pnpm.io) **10.34.5** and Python **3.12.14** for quality checks. See [quality setup and verification](docs/QUALITY_CHECKS.md).

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev          # production operator entry; API required at http://localhost:3000
VITE_DATA_MODE=demo pnpm dev  # isolated fictional prototype
```

```bash
pnpm build        # single-file bundle into apps/web/dist/
pnpm preview      # serve the built bundle
pnpm test         # prototype and lint regression tests
pnpm lint         # source and tooling correctness checks
pnpm quality      # complete local quality gate
pnpm typecheck    # every workspace package
```

The build retains a single-file web bundle. Production must be served over HTTP(S)
with same-origin API proxying; the explicit demo bundle can run without a backend.

## How the web app is put together

- **React 18 + Vite, in TypeScript.** Strict mode is on except `noImplicitAny`, which
  stays off while the last untyped component props are annotated — see
  `apps/web/tsconfig.json`.
- **`src/data/types.ts` is the domain model.** Parcels, lots, routes, the money, the
  WhatsApp conversation. Everything else is written against it. It is migration evidence
  for the production model. Only browser-safe DTOs and pure non-secret functions belong
  in `packages/shared`; whole records and OTP fields do not move there.
- **Two component layers that coexist.** `src/components/m3/` is a hand-written Material
  Design 3 set — the app's own vocabulary. `src/components/ui/` holds shadcn/21st.dev
  components, unmodified from the registry so they can be regenerated.
  `src/styles/tailwind.css` bridges the two by mapping every shadcn design token onto
  the M3 token it corresponds to, so an imported component inherits this app's palette
  instead of introducing a second one.
- **Tailwind runs with preflight disabled.** `src/styles/base.css` already carries a full
  reset and Tailwind's would override it. The one part of preflight that shadcn
  genuinely needs — border defaults — is reproduced by hand in `tailwind.css`.
- **Production operator entry** uses `src/operator/` for cookie/CSRF requests,
  permitted context, onboarding and scope invalidation. The existing prototype store is
  loaded only by the explicit demo composition; production operational pages use server authority.

## Data, privacy and security

- Production identity, organization, franchise and membership state comes from PostgreSQL.
  No failed production operation falls back to browser JSON.
- Session cookies are HttpOnly. OTPs and invitation secrets are never persisted by the
  operator UI. Counter drafts remain in memory. Only opaque uncertain-command recovery references are retained
  in session storage; no counter contact/body/file data is persisted. Onboarding retains its separately approved intent.
- The demo seed is fictional and stays in its separate composition. It cannot send real
  customer messages or create production bookings.
- `VITE_DATA_MODE=demo` explicitly selects a fictional build. Server credentials and auth
  keys remain server-only; do not put them into Vite variables.
- Dependencies and install scripts require review; see the engineering workflow.

## Status

The operator entry is API-backed; the following description applies to the explicit demo.
A prototype, not a production system. `localStorage` is the only persistence, so
clearing site data resets everything; the app offers a "restore demo data" action in
Settings for exactly that reason.

## Production roadmap and contribution workflow

**Prototype v0 — completed before production milestones.** The implementation-ready
production plan lives in [docs/ROADMAP.md](docs/ROADMAP.md) and the linked
[GitHub issue index](docs/ISSUE_INDEX.md). M0–M7 lead to a safe first-franchise pilot;
M8 is post-MVP commercialization. Start from [CONTRIBUTING.md](CONTRIBUTING.md)
and follow the dedicated issue branch → reviewed PR → merge → pull-main workflow.
See [prototype migration](docs/PROTOTYPE_TO_PRODUCTION.md) for preserved behavior
and intentional security changes.

Production architecture: [overview and ownership](docs/architecture/README.md),
[runtime diagrams](docs/architecture/runtime-sequences.md), [ADRs](docs/adr/README.md),
[pilot/commercial gates](docs/architecture/pilot-boundaries.md), and
[open decisions](docs/architecture/open-decisions.md). The linked owning contracts distinguish
implemented infrastructure/operator entry from future operational services.

## Production data access and fictional demo

[Issue #18 architecture](docs/architecture/production-data-access.md) documents the typed API client, purpose-specific operator data source, safe errors, immutable mutation intent and scope cache lifetime. Same-origin API routing remains the default; optional `VITE_API_BASE_URL` is a canonical public origin without authentication/path/query. Unknown public configuration fails startup. Demo is selected only by `VITE_DATA_MODE=demo`, has no API base, and starts a new explicit fictional storage namespace without importing legacy browser JSON.

Both builds are checked separately; production build inspection rejects demo modules and known secret/demo markers. [Verification and synthetic walkthrough](docs/architecture/issue-18-verification.md) includes the full PostgreSQL gate and controlled isolation failure drill.

The [Customer backend](docs/architecture/customers.md) provides franchise-private contact persistence,
bounded repeat lookup, optimistic edits, idempotent commands and immutable safe audit.
[Verification](docs/architecture/issue-19-verification.md) covers real PostgreSQL isolation.
The #33 production counter consumes these APIs; #22 owns immutable booking snapshots.

The [Pricing backend](docs/architecture/pricing.md) persists and publishes tenant-scoped
rate versions and returns deterministic freight/packing proposals with exact paise/gram
representations, finite expiry and audited overrides. [Verification](docs/architecture/issue-20-verification.md)
covers PostgreSQL concurrency and immutable evidence. The #33 counter composes this contract
with #21 tax and #22 confirmed booking snapshots; React does not calculate commercial authority.

The [E-way backend](docs/architecture/eway.md) tracks externally issued references, source
validity, separately labelled estimates and immutable corrections, with scoped prospective
check reminders. Declared goods value is an explicit nullable INR-paise declaration, never
derived from freight or payable. No government filing, verification or legal preset is added.
[Verification](docs/architecture/issue-32-verification.md) records the database/API evidence;
the production E-way Bills screen renders those server states and keeps estimates visibly distinct from official validity.

The [Booking backend](docs/architecture/bookings.md) now confirms operator-authorized
Customer/pricing/tax snapshots, creates initial Parcels with permanent global dockets,
and atomically retains the uncollected obligation, replay result, audit and producer events.
[Verification](docs/architecture/issue-22-verification.md) covers real PostgreSQL races and
rollback. Production booking UI, collections, issued receipts and event processing remain
with their downstream issues.

The [durable outbox worker](docs/architecture/outbox.md) relays committed events into leased jobs with atomic consumer receipts, bounded retries, quarantine and audited recovery. Its registry starts empty until downstream business consumers are implemented. [Verification](docs/architecture/issue-35-verification.md) covers real PostgreSQL crash recovery and tenant isolation.

The [WhatsApp provider registry](docs/architecture/whatsapp.md) validates registered identities, rotates secret references and retains approved-template metadata. Customer consent and durable sends remain downstream; configuration alone does not enable customer sends.

[Signed WhatsApp callbacks](docs/architecture/whatsapp-webhooks.md) persist a tenant-bound inbox before acknowledgement, quarantine unknown identities, and process delivery observations durably. [Consent evidence and current policy checks](docs/architecture/messaging-consent.md) now consume that inbox; actual outbound sending remains with #39.
