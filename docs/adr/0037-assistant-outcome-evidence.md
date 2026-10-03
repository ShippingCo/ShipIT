# ADR 0037: Reconcile assistant metrics from durable source outcomes

Status: accepted for issue #52 implementation; production rollout requires normal review.

## Context and decision

The prototype counts replies in mutable browser statistics. Production already has
deduplicated immutable turn receipts, tool provenance, support events and outbound
state. Extend turn receipts with bounded evidence instead of adding another broker,
analytics SDK, mutable counter or transcript database. Query indexed scoped sources
for the M6 contract. Existing support permission R22 covers this restricted read.

Unknown/old evidence remains unmeasured. Safe replies about missing facts are not
successful tools. Gratitude, handoff, staff resolution and message transport are
different signals. A 15-minute clarification timeout is an observed gap, never proof
of customer intent. Full definitions and compatibility are in the owning contract.

## Research applied

- [AWS Builders' Library: safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  explains caller identity and atomic state/idempotency recording. Our existing inbox
  UUID and transaction already supply that boundary; metrics reuse it.
- [OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)
  supports minimizing telemetry at collection. Closed categories, existing UUID
  references and no transcript copying fit this product. No new telemetry dependency.
- [OpenTelemetry metrics specification](https://opentelemetry.io/docs/specs/otel/metrics/sdk/)
  describes cardinality and attribute control. Our public API has fixed categories,
  no phone/docket labels and no customer filters.
- [PostgreSQL 18 view privileges](https://www.postgresql.org/docs/18/sql-createview.html)
  show the importance of caller permissions. We keep the existing issued capability
  and explicit parameterized tenant predicates rather than an owner-privileged view.

Five-conversation suppression, fixed UTC weeks and the abandonment definition are
engineering judgments, not guarantees made by these sources. At pilot scale indexed
source aggregation is simpler to reconcile than an asynchronous materialization.
Queries remain under existing transaction/statement limits; scale-driven reporting
changes belong to #65. No cohort filter, dashboard, billing or causal calls-saved
claim is added. Groq configuration from ADR 0036 remains unchanged.
