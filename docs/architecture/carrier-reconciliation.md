# Carrier tracking reconciliation

[#58](https://github.com/ShippingCo/ShipIT/issues/58) builds on
[manual evidence](manual-carriers.md), [CSV imports](carrier-csv-imports.md) and
[the adapter contract](carrier-contract.md). See [ADR 0041](../adr/0041-carrier-reconciliation.md).

For example, a shop records a carrier's “moving” report. It appears in the review
queue. Staff with both franchise-admin and dispatcher grants can apply it if the
parcel is dispatched and the report is current. The parcel becomes in transit and
publishes one normal event. Importing or polling the same carrier event again cannot
repeat that transition. “Delivered” remains a claim; complete delivery through the
existing proof workflow.

This is the issue's API/service workflow. No new screen, live network adapter,
provider credential, signature verifier or browser integration is claimed. Existing
manual/file paths feed the projection automatically. CSV's original dry-run rules
still reject malformed/unknown/stale rows before ingestion; their saved row errors
remain visible in the import report. Accepted observations enter this queue.

## API and permissions

Use normal authenticated session cookies and explicit `organization_id` and
`franchise_id` selectors. Mutations also need CSRF and one `Idempotency-Key`.

| Method/path | Contract |
| --- | --- |
| GET `/api/v1/carriers/installations/:id/reconciliation` | R19 staff/org-admin scoped read; bounded `limit` 1–100 and signed `cursor`. Returns items, page and freshness. Agents cannot browse the queue. |
| POST `/api/v1/carriers/reconciliation/:id/resolve` | W26 own-franchise admin. `apply` additionally checks explicit W09 dispatcher authority in that franchise. Returns immutable decision ID, record ID, decision and event ID (null for rejection). |

Resolve body:

```json
{"decision":"apply","reason_code":"verified_movement","expected_version":1,"expected_parcel_version":3}
```

Alternatively use `decision:"reject"` with `incorrect_report`, `superseded` or
`insufficient_evidence`. The case version starts at 1 and becomes 2 on resolution.
The Parcel version is always checked, including rejection. Resolution records
actor, source reference, expected versions, reason, time and request correlation.
Queue entries include decision reason/time, original status code, mapped claim,
source ID/reference, external docket, source/receive times and explicit time reason.

Queue reasons: `ready`, `duplicate`, `source_conflict`, `reference_conflict`, `missing`,
`invalid`, `unknown_timezone`, `unsupported_status`, `future_time`, `stale`,
`proof_required`, `state_conflict`. Reasons are evaluated against current state on
read and again on apply. Resolved records remain visible with their decision.
There is no inference from receive time to unknown occurrence time.

Foreign and unknown nested IDs return the same 404. Unauthorized roles return 403;
malformed bodies return 422; stale versions/unsafe transitions or changed intent
return 409; dependency failures return the ordinary safe 503. No raw SQL/provider
error, customer address, OTP, token or credential is returned. Exact same-key/body
retry reauthorizes and returns the committed decision. After a conflict, reload and
deliberately submit a new intent; never change the body under the old key.

## Normalized adapter port and freshness

`ingestTrackingPage` is server-only. It accepts an existing `carriers.write`
transaction capability and a bounded validated page: `id` (durable receipt UUID),
`installation_id`, `expected_version` (checkpoint revision), `cursor`, `state`
(`success`, `unavailable`, `auth_failed`), `channel` (`poll`, `webhook`) and at most
20 observations. Each observation supplies `parcel_id`, `reference_id`,
`external_docket`, stable carrier `source_id`, `status_code`, mapped `status` or null,
and explicit known/unknown `occurred_at`, matching manual validation.

The caller must establish authorized provider/receipt provenance before the port.
It cannot pass arbitrary tenant, actor, receive-time, credential or URL fields.
Installation/reference/parcel joins are checked again. No installation's advertised
network capability is enabled by calling this persistence port. Worker credential
composition and webhook transport belong to a verified adapter under #60.

The same source ID across file/poll/webhook resolves to one canonical observation;
different bodies under it are quarantined. Manual IDs use a separate namespace.
Equal-time contradictory statuses for the same parcel block approval even across
different installations. Reject the incorrect report before applying valid evidence.
Preserve provider identities across channels; a provider without stable comparable
IDs needs an explicitly qualified identity strategy, not a guessed body hash.

Persist each page and cursor in one transaction. Retry a lost response with the same
receipt/body; changed reuse conflicts. Competing checkpoint versions have one winner.
Failed polls contain no observations and retain the cursor. Webhooks also retain it.
An interrupted transaction can be replayed in full without losing progress.

`freshness` contains `last_source_at`, `last_received_at`, `checked_at`, `as_of`,
`checkpoint_version`, `state` and `last_known:true`. Manual/file-only installations
show `not_connected`, never a healthy API badge. Outage/auth failure retains the
last-known observation. These are timestamps, not an invented freshness SLA. #60/#70
own health policy, alert thresholds and operational monitoring.

## Database and rollout

Apply `1792083600000-carrier-reconciliation.cjs` with the established migration
process. It adds append-only `carrier_tracking_records`, `carrier_tracking_decisions`
and `carrier_tracking_checkpoints`; existing records are projected without changing
historical observations, charges, payment, proof or Parcel state. Historical source
collisions are conservatively quarantined. Scope/installation/source and parcel/time
indexes support identity lookup, bounded queue reads and ordering checks. Unique
decisions and atomic outbox writes prevent duplicate effects. Existing organization
serialization is retained; this is not a claim of high-volume multi-carrier throughput.
Keep these minimal evidence fields under the existing evidence-retention policy;
this issue introduces no new retention schedule or raw provider-body store.

In the deployment's existing role-management process, grant SELECT/INSERT on those
three tables to the existing runtime role. The established Parcel/Route/event grants
are also required for approved T04. Do not grant UPDATE, DELETE, TRUNCATE or DDL.
`prepareCarriers()` handles these grants for disposable test roles.

Pause old producers, migrate/backfill, apply grants, then start this version. No new
environment variable, dependency or secret. Compatible code rollback retains tables;
pause reconciliation and perform a forward catch-up before re-enabling after old
producers have run. Do not edit released migrations or attempt destructive rollback.

## Reproduce with fictional data

Use the pinned toolchain and disposable PostgreSQL described in
[quality checks](../QUALITY_CHECKS.md):

```sh
pnpm --filter @shippingco/api test test/integration/carrier-reconciliation.test.ts
pnpm db:local test:db
pnpm db:local quality
pnpm check:migrations
```

`apps/api/test/database/carrier-reconciliation.test.ts` books a synthetic parcel,
links a carrier docket, checks in and dispatches through real services, imports and
polls the same event, resolves it through authenticated HTTP, then inspects one
Parcel transition/outbox event and reloads via a fresh service/pool. It also tests
out-of-order reports, concurrent resolution/checkpoints, foreign scopes, outage,
rollback, lost COMMIT, proof/financial protection and permission revocation.
The schema test upgrades populated old evidence and injects migration failure.
Provider calls are synthetic; this is real PostgreSQL/API evidence, not live-carrier
or browser evidence. [Verification record](issue-58-verification.md).
