# @shippingco/api

The HTTP API for the operator console. **Nothing is implemented yet** — this package
currently holds the agreed folder structure and its TypeScript configuration, so that the
shape of the backend is settled before the schema discussion rather than during it.

## Chosen stack

- **Fastify** — small, fast, first-class TypeScript, and JSON-schema validation built in
  rather than bolted on. A WhatsApp webhook receiver plus a REST API is exactly its
  shape.
- **Raw SQL over `pg`, migrated with `node-pg-migrate`** — no ORM. Migrations contain
  inspectable SQL. Correct applied migrations with new forward migrations rather than
  editing them. The pool and the migrations live in `packages/db`.

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

## Production architecture contract

Read the [architecture index](../../docs/architecture/README.md),
[ownership and trust boundaries](../../docs/architecture/system-context.md), and
[ADRs](../../docs/adr/README.md). Existing module directories are scaffolds; additional
module paths and worker composition are planned conventions, not implemented code.

The prototype rules live in `apps/web/src/data/store.ts`. Server-owned commands and
secret-dependent proof/authorization stay in API modules. Only public DTOs and pure
non-secret functions may move to shared. Read SQL and internal write helpers live in
`queries.ts`; read entry points do not mutate, and only owning services invoke writes
with the caller's transaction. Routes parse HTTP and map responses, not business rules.

Schema, detailed role/state contracts and policy values remain gated by
[the open decision register](../../docs/architecture/open-decisions.md). Issue #2 does
not install Fastify, auth, database dependencies, workers or provider integrations.
