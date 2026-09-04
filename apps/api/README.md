# @shippingco/api

The HTTP API for the operator console. **Nothing is implemented yet** — this package
currently holds the agreed folder structure and its TypeScript configuration, so that the
shape of the backend is settled before the schema discussion rather than during it.

## Chosen stack

- **Fastify** — small, fast, first-class TypeScript, and JSON-schema validation built in
  rather than bolted on. A WhatsApp webhook receiver plus a REST API is exactly its
  shape.
- **Raw SQL over `pg`, migrated with `node-pg-migrate`** — no ORM. Migrations are plain
  SQL files you can read, review and edit, which matters for a schema that has to model
  real courier operations. The pool and the migrations live in `packages/db`.

Neither dependency is installed yet. Each will be checked for advisories and
supply-chain signals before it is added.

## Layout

```
src/
  index.ts        boot only: read env, build the server, listen, handle signals
  server.ts       buildServer() — returns a configured instance, starts nothing.
                  Keeping this separate is what makes the API testable without a port.
  env.ts          parse and validate process.env once, at startup, and fail loudly.
                  Nothing else in the codebase reads process.env directly.
  plugins/        cross-cutting Fastify plugins — db pool, auth, error handler,
                  request id. Registered by server.ts, used by every module.
  modules/        one folder per area of the business, each self-contained:
    bookings/       routes.ts    HTTP surface and its JSON schemas
    parcels/        service.ts   business rules; no knowledge of HTTP
    lots/           queries.ts   SQL, and nothing but SQL
    routes/
    customers/
    messaging/    WhatsApp send + inbound webhook
    health/       liveness and readiness
```

The seam here is the **domain**, not the layer. With raw SQL there is no ORM boundary to
organise around, so everything about bookings — the route, its schema, its SQL — sits in
one folder. Features arrive by domain, so the code is filed by domain.

## What has to be decided before any of this is written

The schema. The rules currently live in `apps/web/src/data/store.js`, which fuses three
separate things together: the seed dataset, `localStorage` persistence, and the actual
business logic (docket numbering, status transitions, OTP verification, payment ageing).
Splitting that is the next conversation — the rules move to `packages/shared`, the
persistence is replaced by SQL here, and the web app gets a thin client.
