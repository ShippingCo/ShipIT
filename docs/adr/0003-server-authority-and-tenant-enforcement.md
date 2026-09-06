# ADR 0003: Server authority and tenant isolation

Status: proposed for acceptance by the issue #2 reviewed PR. Date: 2026-09-06.

## Context

The prototype stores one Business, unrestricted browser records and plaintext OTP fields.
Issue #3 requires explicit organization/franchise/action scope; #7/#18 require a separate
fictional demo adapter. These cannot be implemented by adding frontend filters.

## Decision

Server-side owning services approve state transitions; PostgreSQL is authoritative
persistence. Treat browser DTOs, typed customer phone/docket input, callback bodies and
LLM output as untrusted input. Authentication proves identity; current membership and
resource ownership determine permitted actions. Recheck authority within commands and
all scoped reads, including referenced child records and background work.

An independent franchise creates its own organization. Customer data stays O/F private;
carrier identity and physical custody do not grant customer-directory access. `org_admin`
receives only declared own-organization cross-franchise permissions; ordinary franchise
staff are denied sibling data; every role is denied unrelated organizations. `read_only`
cannot mutate. Configuration/destructive actions require explicit scoped administrative
grant. Deny unspecified permissions until #3's matrix is ratified (D02).

[Tenancy scenarios and sensitive-data mapping](../architecture/system-context.md) are
part of this decision. They apply to counts, exports, attachments, jobs, logs and provider
installations, not just main screens. #15 supplies tested database defense in depth;
#6/#13 define identity/secret/session mechanics without selecting a library here.

Public DTOs are not DB entities. Shared may expose non-secret types/enums and pure
presentation/calculation helpers; never credentials, OTP plaintext/verifier, private
rows/events or authorization dependent on server state. A function being pure does not
make its secret input or output browser-safe. Sensitive price/proof decisions are
revalidated by the server against current persisted facts.

Production requests never fall back to localStorage mutations. Demo reset/import/persona
selection remains confined to fictional mode. Delivery requires one atomic server
verify-and-complete operation; no staff reveal or generic delivered write. Payment remains
an independent ledger action. WhatsApp calls originate in the server adapter boundary.
LLMs can assist language interpretation but cannot authorize or execute sensitive domain
changes, supply invented prices or turn customer text into operational truth.

## Consequences and revisiting

The existing UX can remain while #7/#18 replace authority. Some demo behaviors must change
intentionally; the [transition map](../PROTOTYPE_TO_PRODUCTION.md) records them. Explicit
scope/DTO mapping adds implementation and negative-test work but is a release prerequisite.
No offline-write product or cross-organization sharing is accepted. Such a future feature
requires its own authority, reconciliation and privacy contract, not weakening this ADR.
