# ADR 0038: Carrier capability contract v1

Status: local implementation for review under issue #53. Date: 2026-10-03.

## Decision

Refine [ADR 0005](0005-external-provider-adapter-interfaces.md) with an application-owned,
server-only [typed port](../../apps/api/src/modules/carriers/contract.ts). Keep independent
capabilities for manual observations, tracking files/API/webhooks, selling-rate files/API,
purchase-estimate files/API and external booking. Enabled capabilities require a dated
evidence reference; fixture evidence is explicitly synthetic, never proof of carrier access.
There is no live adapter, installation repository, new endpoint or provider dependency.

Return observations and candidate rates, never domain mutations. Unknown mappings and source
timezones remain explicit. Installation-scoped references and versioned courier/service/location
identities survive display-name changes. Imported purchase rates remain estimates; actual costs
come from #147. Customer selling prices and negotiated rates retain their owning services.

## Research and alternatives

Research checked on 2026-10-03 against TypeScript 5.9.3, Node 22.23.2 and the existing
Fastify/raw-SQL architecture. No SDK or package addition is needed.

| Question / primary source | Lesson used here | Engineering judgment and scope |
| --- | --- | --- |
| [Microsoft translation boundary guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | Translate external models without imposing them on the application | Use ordinary module interfaces, not a separate service; carrier claims cannot become proof/payment commands |
| [Amazon: safe retries with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | A stable caller intent ID and request matching distinguish replay from a new operation | Carry operation ID/fingerprint and retain uncertain acceptance; #60 must verify provider deduplication before retrying external booking |
| [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) | Use allowlists, disable redirects, and consider DNS/address validation | Reference reviewed server endpoint profiles; no caller-provided URL or HTTP implementation in #53 |

A single `supportsApi` flag cannot express file-only rates or tracking without booking.
A provider SDK as the domain contract would leak external statuses and errors. A generic
plugin framework, queue, circuit breaker or financial ledger is unnecessary for this issue.
The small port plus contract fixtures is sufficient at this scale; operational recovery,
network budgets and persistent retries belong to the enabled downstream capability.

## Consequences and limits

TypeScript is a developer contract, not authentication or validation of untrusted input.
The pure scope predicate requires already-authorized server scope; it does not issue grants.
Later adapters must validate data and implement real repository/action checks. The guide
specifies those obligations and the existing matrix takes precedence over older issue prose.

New contract versions require compatible consumers/fixtures before rollout; mapping and
source versions are pinned to historical evidence. No database migration or runtime flag is
introduced. The existing local booking transaction remains independent of carrier I/O.

See the [owning guide](../architecture/carrier-contract.md) and
[verification record](../architecture/issue-53-verification.md).
