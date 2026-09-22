# Route-delay customer notifications

[ADR 0029](../adr/0029-route-delay-notification-fanout.md) ·
[Route event authority](route-events.md) · [Notification policies](notification-automation.md) ·
[Outbound lifecycle](whatsapp-outbound.md)

Issue #41 turns a committed `route.delayed` fact into a durable, resumable customer-alert
fanout. It does not calculate ETA, change Route state, call Meta from the source transaction,
or create another provider queue.

## Flow and ownership

1. #28 commits the Route command, absolute delay/ETA state, exact
   `{manifest_id,affected_set_ref}` event and one immutable `route_parcel_effects` row per
   distinct frozen Parcel.
2. `customer-notifications` validates schema v1 and `route-delayed:1`, checks the immutable
   activation cutover and idempotently creates one `route_delay_fanouts` root.
3. The Route-delay worker derives tenant scope from that persisted root and processes at
   most 20 ordered effects per pass, one committed item transaction at a time.
4. Current eligible items use #39's database-only `enqueueMessage`. #39 later rechecks
   consent and performs provider work.

Current Lot membership, current direct Route sources, client Parcel IDs and browser data
never participate. The source event/effect set is the sole membership authority.

## Policy and variables

The server-only WhatsApp catalog binds `route-delayed:1` to an approved template/language
and an ordered subset of:

- `docket`
- `effective_at`
- `revised_eta_at`

`revised_eta_at` is mandatory for `route-delayed:1` and is copied from current trusted
Route-effect state. When absent, its exact value is `unavailable`. A Route-delay template
that cannot represent the trusted ETA or the explicit `unavailable` value must not be
activated.
The message must not include manifest contents, incident notes, evidence, staff, addresses,
phones or unnecessary internal IDs.

## Progress and safe reads

The root states are `pending`, `running`, `completed` and `failed`. Normal per-item policy
blocks still complete processing with `reason_code=items_blocked`; `failed` is reserved for
a root-level terminal recovery decision. Counts mean:

- `completed_count`: a logical outbound intent is queued or was already queued;
- `skipped_count`: skipped or consent-suppressed policy results;
- `failed_count`: blocked configuration/policy results;
- provider accepted/delivered/read/failed/uncertain: separate #39 state.

Authenticated R16 reads:

```text
GET /api/v1/whatsapp/automation/route-delay-fanouts
GET /api/v1/whatsapp/automation/route-delay-fanouts/:id
```

use signed actor/revision-bound pagination and return no phone, address, rendering,
ciphertext, credential or raw event payload. Foreign and unknown root IDs are the same
controlled not-found result.

## Reminder API

```text
POST /api/v1/routes/:route_id/delay-reminders
Idempotency-Key: <opaque client key>

{"original_delay_event_id":"<latest legitimate route.delayed event UUID>"}
```

W19 permits franchise_admin, operator and dispatcher in the owning Franchise. Org admin,
delivery_agent, accountant and read_only are denied. The action is CSRF/Origin protected,
creates `route.delay_reminder.requested`, links to the original fact and has a database-
enforced 60-minute cooldown per original delay. It never advances the Route aggregate.

## Recovery runbook

1. Inspect the safe root projection and #39 outbound health separately.
2. For `pending`/`running`, restart the normal outbox runtime. It resumes after the durable
   cursor and does not recreate completed items.
3. For blocked items, repair the installation/template configuration under its existing
   owning workflow. Do not edit item rows or policy activations.
4. For queued/accepted/uncertain provider state, use #39 diagnostics and controlled redrive;
   do not request another #41 fanout.
5. If a schema correction is required, stop the new worker and deploy a forward migration.
   Never rewrite a released migration or delete evidence.

The worker emits only controlled cycle failure telemetry. Correlation, tenant, source,
Parcel reference, safe reason and counts are sufficient; message bodies and PII are not
logged.

## Deployment

Apply migration 28 and the exact grants in [the database guide](../../packages/db/README.md),
add the versioned catalog binding, activate it, then start the existing outbox runtime. A
policy activation mismatch fails startup. Enabling #41 does not replay pre-cutover delay
events. No live Meta verification is implied by local/CI fake-provider tests.
