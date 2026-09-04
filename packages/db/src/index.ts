/*
  Postgres access for ShippingCo.

  This package owns three things and nothing else: the connection pool, a small typed
  query helper, and the migrations. It exists separately from apps/api so that running a
  migration does not require booting a web server — migrations run from a developer
  machine, from CI and eventually from a deploy job, none of which should load Fastify.

  Empty until the schema is agreed. `pg` and `node-pg-migrate` are not installed yet;
  both will be checked for advisories and supply-chain signals first.
*/

export {};
