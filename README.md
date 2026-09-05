# ShippingCo

A customer-connection layer for small and mid-size Indian courier businesses. The
operator books a parcel once at the counter; every WhatsApp update the customer
receives after that — booking confirmation, dispatch, delay, out-for-delivery, OTP,
delivery — is sent automatically, and routine customer questions are answered without
anyone at the shop having to reply.

The web app is complete and works end to end today. All of its state lives in the
browser, so the whole product can be demonstrated with no backend and no accounts. A
Postgres-backed API is planned; its folder structure is in place, its schema is not yet
designed.

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
  api/        HTTP API. Structure only; nothing implemented yet (see its README)
packages/
  shared/     domain types, constants and business rules both sides must agree on
  db/         Postgres pool and SQL migrations
docs/         design brief and working notes
```

`apps/api`, `packages/shared` and `packages/db` are scaffolds. They exist so that the
shape of the system is agreed before the schema conversation rather than during it. The
stack is chosen — **Fastify**, and **raw SQL migrated with node-pg-migrate**, no ORM —
but neither dependency is installed yet.

## Running it

Requires Node 20+ and [pnpm](https://pnpm.io) 10+.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

```bash
pnpm build        # single-file bundle into apps/web/dist/
pnpm preview      # serve the built bundle
pnpm test         # 23 tests
pnpm typecheck    # every workspace package
```

The build uses `vite-plugin-singlefile`, so `apps/web/dist/index.html` is the entire
application — one file you can open from disk or drop on any static host. That stops
being the deliverable once there is an API to call, but while the product is a
prototype it is the easiest way to show it to someone.

## How the web app is put together

- **React 18 + Vite, in TypeScript.** Strict mode is on except `noImplicitAny`, which
  stays off while the last untyped component props are annotated — see
  `apps/web/tsconfig.json`.
- **`src/data/types.ts` is the domain model.** Parcels, lots, routes, the money, the
  WhatsApp conversation. Everything else is written against it. It is also the first
  draft of the Postgres schema, and it moves to `packages/shared` when that work starts.
- **Two component layers that coexist.** `src/components/m3/` is a hand-written Material
  Design 3 set — the app's own vocabulary. `src/components/ui/` holds shadcn/21st.dev
  components, unmodified from the registry so they can be regenerated.
  `src/styles/tailwind.css` bridges the two by mapping every shadcn design token onto
  the M3 token it corresponds to, so an imported component inherits this app's palette
  instead of introducing a second one.
- **Tailwind runs with preflight disabled.** `src/styles/base.css` already carries a full
  reset and Tailwind's would override it. The one part of preflight that shadcn
  genuinely needs — border defaults — is reproduced by hand in `tailwind.css`.
- **No backend yet.** `src/data/store.ts` is the whole data layer: an in-memory object
  persisted to `localStorage`, seeded with a realistic demo dataset on first run. It
  fuses three separate concerns — the seed data, the persistence, and the actual
  business rules — and splitting those is the next piece of work.

## Data, privacy and security

- **Nothing leaves the browser.** There is no server, no analytics and no network call
  at runtime; the only external requests are the Google Fonts links in `index.html`.
- **The seed data is fictional.** The names, phone numbers and addresses in
  `apps/web/src/data/store.ts` are invented for the demo and are not real customer
  records.
- **The app reads no environment variables.** `.env` holds only developer-machine
  credentials for pulling UI components (see `.env.example`); it is git-ignored and
  never bundled. Nothing in `dist/` contains a secret.
- **Dependencies are checked before they are installed**, not audited afterwards:
  known advisories against the exact version, publisher and age, whether it runs install
  scripts, and how many packages it brings with it.
- WhatsApp messaging is **simulated locally**. Wiring this to the real WhatsApp Business
  API would mean introducing a server, and message templates, opt-in records and
  customer phone numbers would then become real personal data subject to India's DPDP
  Act. None of that applies to this prototype.

## Status

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
and intentional security changes. Product implementation has not started as part of
this planning setup.
