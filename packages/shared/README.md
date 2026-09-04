# @shippingco/shared

Domain types, constants and business rules that the web app and the API must agree on.

```
src/
  types/       the shape of a booking, lot, route, customer, message
  constants/   parcel statuses, service types, payment modes — the closed sets
  rules/       pure functions: docket numbering, allowed status transitions,
               OTP validation, payment ageing. No I/O, no framework, no DOM.
```

Three constraints keep this package safe to depend on from both sides:

- **No runtime dependencies.** Anything added here is added to the browser bundle *and*
  to the server.
- **No environment assumptions.** Nothing may touch `window`, `document`, `process` or
  `localStorage`.
- **Pure functions only in `rules/`.** They are the definition of correct behaviour and
  have to be testable without a database or a browser.

Currently empty. It fills up when the rules are extracted from
`apps/web/src/data/store.js` as part of the schema work.
