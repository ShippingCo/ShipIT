# PR title

Implement reviewed, idempotent carrier tracking reconciliation

## Description

Closes #58.

Carrier observations now enter a durable scoped review queue. A repeated file/poll
event cannot produce a second transition. Current approved movement reports use
the existing Parcel T04 service and atomic outbox; delivery, payment and historical
charges keep their existing authority. Conflicts, unknown time/status and stale
reports remain explicit and reviewable.

Adds immutable tracking records, reviewed decisions, resumable page checkpoints,
safe outage freshness, scoped APIs and an additive backfill migration. Applying
movement requires both W26 franchise-admin and W09 dispatcher grants. Manual/CSV
workflows reuse the boundary; live adapter transport, pricing and health alerting
remain #59/#60/#70. No new UI, provider, package, secret or LLM change.

Validation: the broad quality run passed planning, lint, five typechecks, 35
tooling/security, 22 testkit, 12 DB unit, 641 API, 189 web and three object-storage
tests. It stopped at two migration fixtures whose synthetic repair dates preceded
the new migration. Those fixture dates were corrected; all six isolated cases then
passed. The complete database rerun passed 70 schema tests, then reported eight
application upgrade fixtures with stale migration counts. All eight were corrected
and passed targeted reruns (10 tests total). Final reconciliation/migration tests
passed all 8 scenarios, including contradictory claims across carrier installations.
Final lint, five typechecks, planning, migration history and API/production web builds
passed. This combines broad runs and targeted reruns; neither failed aggregate is
claimed as passing. No live-provider or new-commit CI result is claimed.
See [the exact verification record](issue-58-verification.md).

Rollout: pause old producers, apply the additive migration and SELECT/INSERT grants,
then start the new version. Retain all evidence on rollback; forward catch-up is
needed if old producers run again. See [the operating guide](carrier-reconciliation.md).

## Suggested commit

`feat(carriers): reconcile tracking evidence with guarded parcel transitions`
