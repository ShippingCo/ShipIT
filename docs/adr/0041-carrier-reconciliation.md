# ADR 0041: Reviewed carrier tracking reconciliation

Status: local implementation for review under #58. Date: 2026-10-03.

## Context and decision

M5's tracker places #58 after #24, #35 and #53–#55, all closed and present in
the implementation base `65dfb2e` (merged #57 / PR #157). Main was pulled before
creating `issue-58-carrier-reconciliation`. There were no local changes or later
commits. Conversations “Implement issue #57” and “Implement issue #53” confirmed
the capability boundary and manual pilot choice. #57 qualifies no live access;
its outstanding independent evidence review does not block local reconciliation.
#59 rates, #60 carrier qualification and #70 alerts remain separate.

Retain immutable manual/file observations. Add a small indexed tracking projection,
immutable decisions and page checkpoints. Backfill historical observations without
changing their evidence or applying transitions. Deduplicate on installation plus
explicit external source identity, independent of file/poll/webhook channel. Compare
source instants numerically, not timestamp strings; do not merge unrelated events
by guessing from similar bodies. A changed identity payload is quarantined. Keep
the original and every channel receipt available for review.

All state application is human-reviewed. Only a current `in_transit_claim` can
apply the existing T04 from `dispatched`. It uses the real saved dispatch Route,
Parcel service, command, transition and domain outbox. Other claims require their
owning domain's evidence (physical intake, manifest, agent assignment, failed
attempt, return approval or delivery proof), so this issue does not invent those
facts. Rejection records a controlled reason; corrections are new evidence.

W26 review requires franchise_admin; applying T04 additionally requires an explicit
dispatcher W09 membership. Both must cover the selected franchise. This is the
intersection of existing grants, not admin inheritance or a new role. R19 governs
the installation queue; assigned agents cannot browse a multi-parcel queue.

## Research to decision

Checked 2026-10-03 against Node 22.23.2, Fastify, raw pg and PostgreSQL 18.6.

| Source-backed practice | Concrete local choice and verification | Decision / cost |
| --- | --- | --- |
| [AWS: retries with explicit intent and atomic effects](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | Receipt IDs and fingerprints for pages; actor-scoped intent keys for decisions. State, decision and outbox share a transaction. Lost-COMMIT and concurrent resolution tests inspect event counts. | Adopt; three small tables, no distributed coordinator. |
| [Microsoft: translate external semantics at the domain boundary](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | Carrier claims stay separate from Parcel states. T04 goes through the owner; delivered claims cannot create proof or payment. | Adapt within the existing module; no extra microservice. |
| [PostgreSQL 18: explicit locks](https://www.postgresql.org/docs/18/explicit-locking.html) | Existing organization/membership lock, then parcel lock and expected versions. Unique identity/decision constraints and deferred ownership/evidence checks protect atomic writes. | Adopt; serializes a shop's commands, consistent with this repository. |
| [Google SRE: simple, symptom-oriented monitoring](https://sre.google/sre-book/monitoring-distributed-systems/) | Our local application of that principle is to expose source/receive/check times and explicit outage/not-connected state while preserving last-known data. | Adapt; alert thresholds and production monitoring remain #60/#70. |

Assumptions: small courier shops, bounded 20-observation pages and 100-row reads,
one database and the established organization lock. These are engineering choices,
not claims that a large company's architecture or scale has been reproduced.
No new dependency, queue, LLM, provider or network transport is needed. Existing #35
outbox consumers receive the single committed Parcel event; no direct WhatsApp send.

## Failure and compatibility

Unknown time/status, future/stale time, equal-time disagreement, corrected references,
source collisions and proof-dependent claims cannot apply. Review repeats current
Parcel/reference checks and rejects stale versions. Duplicate identities never apply
twice. Rejected newer/conflicting evidence no longer blocks another valid report.

The internal normalized-page port requires an authenticated transaction capability;
it is not exposed as a browser/webhook endpoint. A future authorized adapter must
verify its callback signature or bind its poll credentials before calling it. Poll
cursor and observations commit together; callback pages and failed polls preserve
the poll cursor. No arbitrary URL or credential is accepted or stored.

Pause old producers during the additive migration/cutover: older code does not fill
the new projection. Restart with this version after applying the grants. Rollback
retains evidence but pauses reconciliation; forward repair/backfill is required
before re-enabling it after old producers have run. No down migration or production
change is performed by this implementation.
