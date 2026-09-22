# Outbound WhatsApp operations

[ADR and research](../adr/0027-durable-whatsapp-outbound.md)

## Integration

`enqueueMessage(scope, dependencies, input)` is an internal database-only consumer effect.
The capability must be trusted `outbox.work`; it does not accept caller ownership or phone.
Fields: `source_kind` (`event` or `inbox`), `source_id`, optional `affected_entity_id`, `customer_id`, `purpose` (`updates`,
`requested_assistance`, `consent_disclosure`), and `format` (`text` or `template`). Text
requires a nonempty body of at most 4096 characters; template requires exact registered
name/language and bounded text variables. Disclosure accepts no caller body and uses
fixed server content. Updates require a valid owning booking/parcel event; assistance
and disclosure require a consumed same-customer inbound reference. Unknown fields fail.

The service returns `{id,state,reason_code}`. Exact logical retries preserve that ID, while changed canonical
intent conflicts. Source/customer access is checked before replay. Policy denial persists
a suppressed intent without sensitive rendering for consent/contact denial. Template or
installation failures retain a failed, repairable intent until its deadline. No public enqueue/send endpoint exists.
Call from the owning post-commit consumer, never the booking request transaction. #40
registers initial Booking/Parcel/Route automation and #41 adds bounded Route-delay fanout;
#42 owns delivery challenges, #43 attempt/RTO/completion notifications, #44 history UI,
and #47 conversation decisions.

## States and failure boundary

Queued/retry_wait → dispatching reservation → accepted, retry_wait, failed or uncertain.
Queued work can instead become suppressed. Delivery observations promote accepted to
delivered/read or record failure; delivered/read cannot regress. Expired reservations
become uncertain, never queued. Attempts count reservations; immutable outcome records
are written after the provider response or crash recovery.

Current contact generation, installation/catalog, consent, pending inbound work, service
window and template capability are checked again during reservation. That commit is the
linearization point; revocation afterward cannot retract an already reserved network send.
This short transaction blocks concurrent ingress and consent changes through the installation
lock. HTTP happens afterward without database locks. Lost COMMIT acknowledgment skips HTTP.
Lost acceptance persistence leaves the reservation for uncertain recovery.

Five confirmed 429 rejections exhaust a cycle. Retry delay respects both jittered backoff
and provider Retry-After; a wait over 24 hours fails for review. Permanent credential/template
errors stop immediately. No unbounded or hidden provider retries. Unknown outcomes without
a trusted provider ID cannot be matched by guessing a phone/time/body; an explicit risk-aware
decision is required. Accepted messages with removed rendering cannot be resent by redrive.

## Operator API and recovery: whatsapp-outbound-v1

Paths under `/api/v1/whatsapp/outbound`, selected by `organization_id` and `franchise_id`:

| Request | Result |
| --- | --- |
| GET `/health` | State counts, oldest age, recovery owner and runbook |
| GET base path | Up to 100 safe messages; default 50; scoped opaque cursor |
| GET `/:id` | Current message and newest 100 attempt outcomes; history_truncated |
| POST `/:id/redrive` | Original `{id,version,state:"queued"}` command receipt |

R18 permits scoped org_admin reads and local franchise_admin reads. W44 permits current
local franchise_admin redrive only, with active roots, browser Origin/CSRF and Idempotency-Key.
No org-admin write inheritance, operator/dispatcher/read_only/accountant redrive or new role.
Foreign and unknown IDs both return RESOURCE_NOT_FOUND. Safe DTOs contain opaque message
ID, state/reason/version, attempt counts and times; no phone, text, variables, provider IDs,
keys, ciphertext or raw provider error. API errors use the existing controlled boundary.

Redrive body: `{"expected_version":3,"reason_code":"dependency_repaired"}`. For uncertain
work the explicit reason must instead be `retry_uncertain_confirmed`: the administrator
has investigated and accepts potential duplicate external delivery. Inspect detail and
provider evidence first; never automate this decision. Same actor/scope/key/body replays
the original result; changed intent yields IDEMPOTENCY_CONFLICT. Stale revisions, delivered
work, expired/purged rendering and wrong recovery reasons yield VERSION_CONFLICT.
Redrive retains intent, source and total attempts, resets only the five-attempt cycle, and
appends canonical audit. Current dispatch policy is never bypassed by redrive.

Repair credentials/templates before retrying; resynchronize exact-language metadata if
stale. Investigate uncertain messages using provider-side evidence; do not invent mappings.
If rendering expired, leave the evidence intact and involve the owning business workflow.
Monitor `whatsapp_outbound_attention / MANUAL_REVIEW_REQUIRED` and
`whatsapp_outbound_failed / TEMPORARILY_UNAVAILABLE`. Persistent health remains actionable
after process loss; #70 owns hosted alert transport.

The worker also checks persisted failed/uncertain work on startup and every sixty polling
cycles, so a restart or a failure initially recorded by enqueue does not erase the alert.

## Migration, grants and rollout

Apply `1790874000000-whatsapp-outbound.cjs` with the migration identity. It creates empty
tables and indexes, adds no producer backfill, and extends canonical audit. Existing schema
and source rows are unchanged. Replacing the audit view can briefly lock its dependencies;
measure with representative staging data. Run the populated #38 upgrade and rollback fixture.

In addition to existing #36–#38 and booking/customer read grants:

```sql
GRANT SELECT, INSERT ON shipit.whatsapp_outbound, shipit.whatsapp_outbound_attempts,
  shipit.whatsapp_outbound_redrives TO shipit_api_runtime;
GRANT UPDATE(state,reason_code,version,attempts,cycle_attempts,attempt_id,lease_until,
  available_at,sealed_payload) ON shipit.whatsapp_outbound TO shipit_api_runtime;
GRANT EXECUTE ON FUNCTION shipit.whatsapp_outbound_scope(uuid,timestamptz,boolean),
  shipit.whatsapp_outbound_disclose(uuid,uuid,uuid) TO shipit_api_runtime;
```

Do not grant DELETE/TRUNCATE, identity mutation, direct disclosure writes or table ownership.
`prepareWhatsappOutbound` is the executable synthetic grant reference. Runtime source
enforcement remains scoped parameterized SQL; fixed trusted scheduling functions return
only owner references. The AST gate prohibits importing scheduling into arbitrary modules.

Deploy schema/grants, then compatible code. Existing `WHATSAPP_CONFIG_REF` may explicitly
include `"outbound_enabled":true` only with the signed webhook configuration. Omission
defaults to disabled. The API runtime drains the current five-second provider request on
shutdown. Polling starts on readiness and is bounded to one intent per second per replica.
Enable only in isolated development/staging with reviewed synthetic consumers first.
#40 installs its reviewed subscriptions only after immutable per-policy cutover activation.
Events predating activation are recorded as historical skips, not outbound intents.

Rendering is sealed with the configured versioned key and purged on acceptance/suppression
or the 24-hour dispatch deadline. Keep that key version available for pending work; missing
keys fail closed. The stable fingerprint key still follows #37's rotation restrictions.
The dispatch deadline is not a replacement for #72's legal evidence retention and holds.
Rollback disables outbound processing and reverts compatible code while retaining evidence;
repair schema forward. Never clear reservations or change logical IDs to force replay.

## Verification

Use pinned Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and disposable PostgreSQL 18.6:

```sh
pnpm check:migrations
pnpm db:local quality
```

`apps/api/test/outbound-support.ts` provisions fictional tenants, signed inbound context,
and a synthetic provider. `apps/api/test/database/whatsapp-outbound.test.ts` exercises
accept/timeout, duplicate workers, STOP in backoff, restart, disclosure proof, HTTP and
scope denial. `packages/db/test/integration/whatsapp-outbound.test.ts` proves populated
upgrade rollback/retry. No production database or real customer messaging is used.
Live Meta onboarding and acceptance remain unverified without sandbox credentials.
