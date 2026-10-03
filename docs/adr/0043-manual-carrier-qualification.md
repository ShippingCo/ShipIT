# ADR 0043: Qualify one manual carrier path

Date: 2026-10-03. Status: implementation decision for #60; not a production launch approval.

## Context and decision

M5's final issue permits manual, file or authorized live API qualification. Merged
[#56 research](../integrations/akash-ganga-research.md) and
[#57 research](../integrations/maruti-research.md) establish no verified machine interface.
Choose Akash Ganga, manual observations and external docket mapping, owned by the
pilot franchise admin. The repeatable fixture is fictional; no actual carrier shipment,
contract, API access or field-pilot result is claimed.

Reuse #53/#54's adapter and immutable evidence, #58's review and domain transition,
and #59's separate rate semantics. Add `file_import:false` at installation creation
and enforce it before parsing imports/rates. Existing generic installations retain
`true`; omission preserves their API semantics and old idempotency fingerprints.
This flag is immutable with its installation. It is a local permission to use generic
files, not proof that a carrier supplies them. No new network adapter or LLM work.

Expose one scoped read endpoint for manual signals. Read source actor IDs without
joining identity/contact tables. Count unresolved nonduplicate manual records against
durable decisions, not the paginated queue. Unknown/future source time has no age;
receipt age never substitutes for source age. Counts identify work, not availability.
The health endpoint says API `not_applicable`; manual-only reconciliation says
`manual_only`, preserving the generic checkpoint response for existing consumers.

## Research to decisions

| Problem / primary source | Choice, assumptions, benefit and cost | Verification |
| --- | --- | --- |
| Lost response can repeat a mutation: [AWS Builders' Library, safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | Adopt existing scoped key + fingerprint + atomic receipt; no new queue. Assumes the client retains its original key/body. Restart recovery remains a database lookup; correction is a separate intent. | Fault after COMMIT, identical replay, concurrent resolution, event/decision counts |
| A manual workflow must show actionable issues: [Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/) | Adapt to one small franchise: source age, oldest open receipt, unresolved/unmapped counts and an owner/runbook. No invented API uptime or automated paging threshold. Adds two scoped SQL reads; avoids a monitoring service. | Empty, unknown/future time, elapsed time, resolved count, B/C denial and safe payload tests |
| Preserve existing installations during rollout: [PostgreSQL 18 table changes](https://www.postgresql.org/docs/18/ddl-alter.html) | Adopt additive constant-default boolean, no table rewrite/backfill job. Existing append-only trigger preserves configuration. One partial index supports latest manual evidence. Requires schema before code; old code cannot enforce the new restriction. | Populated 40-migration upgrade, no-op rerun, immutable flag and preserved identities |

These sources support the principles; path choice, immutable configuration and metric
semantics are repository-specific engineering judgments. The pilot is small enough
for an indexed on-demand aggregate; no claim of measured large-scale performance.
The existing query deadline bounds work. Material growth warrants measurements and
a separately reviewed projection, not speculative counters now.

## Alternatives and boundaries

- Defer live adapters, credentials, polling, webhooks, API retry/backoff and circuit
  breakers until authorized documentation and test access exist.
- Defer carrier file qualification until an authorized repeatable source and schema
  exist. Generic file tests remain regressions, not evidence of AGC export support.
- Do not add a new UI: this service/API qualification uses the issue's explicit
  service-only allowance. The runbook documents how API consumers show source and errors.
- Do not rewrite old observations or reassign reserved dockets. Reject incorrect
  evidence, correct the reference with expected version, append corrected evidence.
- Do not add notification policies: carrier transit retains the existing
  `unsupported_source_cause` skip; delivery/payment/proof remain their owning domains.

See the [runbook](../architecture/carrier-pilot.md) for rollout restrictions and
[acceptance evidence](../architecture/issue-60-verification.md).
