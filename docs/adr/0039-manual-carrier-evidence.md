# ADR 0039: Durable manual carrier evidence

Status: local implementation for review under #54. Date: 2026-10-03.

## Decision and reasoning

Extend [ADR 0038](0038-carrier-capability-contract.md) with a small raw-SQL evidence store
and authenticated API. Reuse W26 for own-franchise admin setup/mapping/observation commands,
R19 for scoped reads and the existing transaction/membership locks. Do not widen dispatcher
or organization-admin write authority. An installation has one explicit franchise grant;
organization-wide sharing needs its own reviewed policy.

Keep service/location mappings and parcel reference versions immutable. Reserve historical
installation+docket identities so corrections cannot redirect old observations. Pin normalized
IDs and mapping versions to each reference. The manual adapter returns the existing v1
observation contract; shared ingestion saves it as pending review. No observation writes
Parcel status, proof, money, pricing or messages. #58 owns reconciliation and application.

No queue is needed because #54 performs no asynchronous domain effect. Command receipts
and their evidence commit atomically, and the audit view projects safe metadata. The existing
organization lock is sufficient for this shop-scale workload; no new distributed lock service.
This deliberately serializes same-organization commands, consistent with existing modules.

## Research checked against installed technology

Checked 2026-10-03, Node 22.23.2, TypeScript 5.9.3, PostgreSQL 18.6 and existing Fastify/pg.

| Primary source | Source-backed lesson | Application here (engineering judgment) |
| --- | --- | --- |
| [Amazon Builders' Library: safe idempotent retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | Caller intent IDs distinguish retries; intent recording and effects need an atomic transaction | Reuse scoped command receipts/fingerprints; reauthorize before replay; test lost COMMIT acknowledgement |
| [Microsoft: translation boundary](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | External models should not impose their semantics on the internal domain | Keep carrier claims separate from ShipIT lifecycle/proof/payment; reuse one module, not another service |
| [PostgreSQL 18.6 constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) | Multi-column uniqueness and foreign keys enforce relational identity | Installation+docket uniqueness, composite ownership chains, append-only revisions and deferred evidence checks |

Overwriting parcel status would violate proof/payment policy. Reusing route display strings
as courier identity would merge unrelated installations. Generic provider infrastructure,
network clients, CSV parsing, rate publication and automatic reconciliation are unnecessary
for #54. No new dependencies, infrastructure, configuration or LLM behavior are introduced.

## Consequences

Local booking stays independent of carrier availability. API consumers can review explicit
unknown values and retry uncertain responses safely. A corrected docket remains reserved;
reassignment is a later, explicit policy decision. No operator screen is claimed: this issue's
service-only contract is documented with reproducible real API fixtures. No existing UI changes
means browser/accessibility regression additions are not applicable here.

See [the guide](../architecture/manual-carriers.md) for exact contracts, permissions, rollout
and deferred work, and [verification](../architecture/issue-54-verification.md) for evidence.
