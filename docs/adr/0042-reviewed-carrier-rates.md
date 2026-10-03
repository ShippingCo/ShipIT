# ADR 0042: Reviewed carrier rate imports

Status: accepted for issue #59 local implementation. Date: 2026-10-03.

## Context and decision

Carrier files use external service/location codes and ambiguous units. A supplier
cost must never become a customer price by accident. Preserve #53's two purposes,
#54 mapping identities, #55 bounded parsing and #20's immutable pricing rules.
Provide authenticated preview/read/approve APIs with no new browser surface.

Each file declares its purpose, unit convention, finite effective interval,
expected lanes and reviewed pricing configuration. Rows use explicit INR currency
and the declared weight/amount units. Exact decimal kg/rupees become integer
grams/paise with no rounding; mismatches fail. Rejected rows cannot be selected
around: correct the input/mapping and review a new candidate. Missing lanes block
approval; visible weight gaps retain Pricing's existing NO_RATE behavior.

An immutable normalization snapshot binds existing scoped mapping-version IDs to
Pricing's service enum and destination key. Unknown codes remain explicit errors.
Aliases may share an identity/meaning; distinct identities cannot collapse silently.
One origin is explicitly assigned to this franchise policy, because Pricing has no
origin selector. Different origin/service pricing needs a separately designed contract.
At approval all mapping versions are rechecked. General imports do not write any
customer-specific agreement; #141 owns that future precedence and must resolve an
applicable negotiated agreement before the general policy. No such resolver is claimed here.

Selling approvals call Pricing inside the same live membership transaction. Purchase
approvals retain immutable estimates independently and never create a Pricing version.
Both retain source file, installation, courier, lane, mapping and effective-version
provenance. Quotes reuse their existing source_ref (`carrier-rate:<import UUID>`),
so old fingerprints and DTOs remain compatible. Full sheets require current local
franchise-admin W26/W27; broad carrier read permission cannot reveal private rates.

## Research to decisions

| Source and concrete problem | Choice, fit, cost and verification |
| --- | --- |
| [AWS Builders’ Library: safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) — lost response can duplicate a published rate | Adopt scoped client keys, changed-intent rejection and atomic receipts. Add file/config uniqueness because this issue explicitly requires duplicate-file identity. Small persisted records; concurrent/replay/fault tests verify effects. |
| [Microsoft: anti-corruption layer](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) — carrier terms and supplier amounts can corrupt local pricing meaning | Adapt as a small in-process translator. Explicit mappings and purpose boundary; reuse Pricing rather than a second quote engine. A mapping snapshot adds review work; unknown/purchase tests verify rejection and separation. No new microservice. |
| [PostgreSQL 18 constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) — cross-owner references and duplicate approvals | Adopt composite foreign keys, unique candidate/approval identities and append-only triggers. Cross-row publication rules use triggers/owning service, not unsupported cross-row CHECK assumptions. Real runtime-role and transaction tests verify. |

Engineering judgment: files are limited to 64 KiB/100 rate rows, appropriate for this
small-franchise bounded policy model. Synchronous atomic publication is simpler than
resumable per-row financial publication and prevents partial policies. Keep the existing
organization lock; no throughput claim or distributed lock service. Direct purchase
approval constraint serializes by installation. Review bulk/queue architecture only
when measured workloads exceed these explicit limits.

Defer API transport/health to #60, actual costs to #147, customer agreements to #141,
tax changes to their owning service, and broad reporting/retention to their roadmap owners.
No new credentials, dependencies or retrying provider calls. Rollout is additive schema
and runtime grants before compatible API code; rollback retains immutable evidence.
