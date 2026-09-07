# ADR 0007: Versioned API, events and idempotent commands

Status: submitted for acceptance through the Issue #4 PR; effective on approved merge.
Date: 2026-09-07. Owner: #4 / API and events.

[Architecture](../architecture/README.md) · [Decision register](../architecture/open-decisions.md)

## Evidence and precedence

Issue #2 / PR #85 and Issue #3 / PR #86 are merged and closed. Work begins at current
main `d039a480eadccb47578c82b1d586b4fdf99ce548`. The project owner's approved Issue #4
execution instructions (sections 3A–3S) authorize these contract directions. ADR 0006
and its domain/authorization/T01–T13 contracts override older candidate UI/event names.
ADRs 0001–0005, especially ADR 0004's transaction invariant, remain intact. This is a
numbered refinement of their explicit D04 deferrals, not a replacement architecture.

## Decision

- [API](../architecture/api-contract.md): `/api/v1`, new major for breaking public wire
  changes, natural typed success DTOs; exact safe error envelope and 400 syntax / 422
  semantic-validation split; canonical 401/403/404/409. Cursor lists use items/page,
  next_cursor/has_more, limits 50 default / 100 maximum, deterministic tie-break ordering,
  query/scope compatibility and current authorization. Docket/UTC scalar rules are explicit.
- [Idempotency](../architecture/idempotency-contract.md): Idempotency-Key scoped by current
  actor/registered integration + trusted organization + acting franchise where applicable
  + versioned command identity. Canonical typed normalized intent, not raw JSON order;
  original authorized result on replay, 409 on mismatch, reauthorization before disclosure.
  Uncertain timeouts retry same key/body. Ordinary evidence lasts at least 24 hours from
  commit, longer where required; expired uncertainty requires authoritative reconciliation.
- [Events](../architecture/event-contract.md): 17 justified immutable facts, an exact
  internal reference-oriented envelope, stable factual event_type + integer schema_version,
  common correlation/causation/command references, and producers/consumers/committed-state
  invariants. Delivery facts use the Parcel's authoritative revision with coordinated
  owning services. No new lifecycle edge, finance policy or proof authority is introduced.
- Schema compatibility and supported-reader rollout, event/effect dedupe, explicit per-
  consumer stale/gap policies, poison quarantine and preserved redrive identity are required.
  Business + audit + original result + outbox commit together; provider I/O is after commit.
  Unknown provider acceptance requires reconciliation, never universal exactly-once claims.

D04 is ready for contractual resolution **on acceptance/merge**, not on local file creation.
D05 remains OPEN: #35/#39/#40 own actual lease/retry/fairness/poison/redrive/dedupe mechanics.
#9/#22/#23/#24/#28/#29 finish endpoint-specific schemas and reconciliation mechanisms;
#6/#13/#72 own auth/privacy/security; #8/#21/#29/#42/#66 retain financial/proof/calendar
policy gates. No downstream product issue is marked implemented.

## Alternatives, consequences and rollout

Raw-byte fingerprints reject equivalent JSON and are rejected. Universal data wrappers add
no useful resource meaning. Offset pagination cannot satisfy the selected cursor contract.
Timestamp ordering cannot detect aggregate staleness/gaps. Generic command-like event names
confuse authority; use the canonical #3 facts. Long-lived keys cannot substitute for resource
identity, and a database lease cannot eliminate external acknowledgement ambiguity.

Consumers and endpoint authors now have a reviewable shared rulebook at the cost of explicit
schema, version, replay-authorization and reconciliation obligations. See [tabletops](../architecture/api-event-scenarios.md)
and [acceptance evidence](../architecture/api-event-verification.md). Synthetic models cannot
prove production concurrency, cryptography, transaction isolation or provider behavior.

This PR has no runtime/data migration or deploy. Reverting documents/tools changes no product
state. Future implementations roll out compatible readers before producers, retain outstanding
replay normalizers and use reviewed forward-only changes; incompatible accepted contract
changes need a reviewed ADR amendment with migration/recovery evidence.
