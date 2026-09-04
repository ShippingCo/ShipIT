/*
  The single import surface of @shippingco/shared.

  This package holds what the browser and the server must agree on: the shape of a
  booking, the set of parcel statuses, the rules for numbering a docket or ageing an
  unpaid amount. It is consumed as TypeScript source rather than as a build artefact —
  Vite and the API both compile it — so it must stay free of runtime dependencies and
  free of anything that assumes a DOM or a Node process.

  It is empty on purpose. Its contents come out of the schema discussion: today those
  rules live in apps/web/src/data/store.js mixed together with localStorage persistence,
  and pulling them apart is a deliberate step, not a copy-paste.
*/

export {};
