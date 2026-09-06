# @shippingco/shared

Public DTOs, browser-safe enums/constants and pure non-secret functions that web and
API may share. Currently empty; this document defines its planned import boundary.

```text
src/
  types/       public request/response DTOs, not database rows
  constants/   browser-safe closed sets
  rules/       deterministic presentation/calculation helpers without secrets or I/O
```

- No runtime dependencies or assumptions about DOM, Node, environment or localStorage.
- Public DTOs differ from internal persistence/event records. Do not export whole
  prototype Booking records containing OTP or internal data.
- No OTP generation/verification, keyed verifier, resend payload, credentials or
  authorization dependent on current membership/server state. Purity alone is not safety.
- Formatting a docket is potentially shareable; allocating a unique docket belongs to
  the server transaction. Showing a transition is not authorizing it. The server validates
  price, state, ownership and permissions against authoritative records on every command.
- Internal worker event types remain server-side unless a specifically public,
  minimized contract is approved under #4.

The prototype evidence is `apps/web/src/data/store.ts`, not historical `.js` paths.
See [ADR 0003](../../docs/adr/0003-server-authority-and-tenant-enforcement.md),
[ownership/trust](../../docs/architecture/system-context.md), and
[prototype transition map](../../docs/PROTOTYPE_TO_PRODUCTION.md).
