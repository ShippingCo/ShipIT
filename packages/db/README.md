# @shippingco/db

The Postgres layer: connection pool, query helper, and migrations. No ORM.

```
src/
  pool.ts    a single pg.Pool built from DATABASE_URL, shared by the whole process
  query.ts   a thin typed wrapper — parameterised queries only, never string building
  types.ts   row types, generated from or kept in step with the migrations
migrations/  node-pg-migrate migrations, plain SQL, applied in filename order
```

**Why raw SQL.** The schema models real courier operations — parcels moving through
statuses, lots, routes, payment ageing — and the queries that matter are the awkward
ones. Plain SQL that can be read in review, run in `psql`, and reasoned about against an
`EXPLAIN` is worth more here than a query builder's convenience. The cost is that row
types are maintained by hand rather than inferred, which is the trade we chose.

**Two rules, both about safety.** Every query is parameterised — no value is ever
concatenated into SQL, which is where injection comes from. And migrations only ever go
forward: a mistake is corrected by a new migration, never by editing one that has
already been applied to a database somewhere.

Empty until the schema is agreed.
