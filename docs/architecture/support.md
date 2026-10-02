# Human support — Issue #50

A customer sends HUMAN or HELP, or asks an unrecognized question. The system saves
one case and acknowledges it with truthful staffing expectations. Further messages
join that conversation without duplicate cases/automatic answers. Staff open **Human
support** at `/business/support`, select a case, claim or assign it, reply, add private
notes and resolve. Reopen requires a controlled reason and no other active case.
After resolution the next recognized question uses the ordinary trusted tools.

## Access and API

R22: org admin may read its explicit franchise scope; franchise admin/operator read
their own locations. W28: franchise admin/operator mutate locally. Only the current
owner replies/notes/resolves; any local operator can assign to an active local operator
or franchise admin. Read-only, dispatcher, customers and foreign locations cannot read
cases/notes. No public case or arbitrary-recipient messaging endpoint exists.

All routes require the session and explicit `organization_id`/`franchise_id` query:

- `GET /api/v1/support[&after=<uuid>]`: bounded 50-case list, `next` cursor.
- `GET /api/v1/support/:id`: summary, validated parcel reference, 20 safe conversation
  outcomes, latest 50 immutable staff history entries and up to 100 eligible staff IDs.
- `POST /api/v1/support/:id/commands`: CSRF and `Idempotency-Key` required.
  Body: `action`, `expected_version`; assign adds `assigned_staff_id`; respond/note
  adds `text` (1–2000 characters); resolve/reopen adds `reason` from `customer_request`,
  `needs_followup`, `answered`, `operational_review`, `incorrect_resolution`.

Same actor/scope/key/body returns prior summary; changed body returns
`IDEMPOTENCY_CONFLICT`. Stale state/competing claim/pending-send handoff returns
`VERSION_CONFLICT`; refresh before a new action. Unknown/foreign references return
the same `RESOURCE_NOT_FOUND`. The browser preserves failed drafts and reuses the
same intent for uncertain network retries. Internal notes never enqueue messages.
Private text is encrypted; only permitted detail reads decrypt it. Raw inbound text,
OTP, full addresses and bearer grants are not copied into the case context or audit.

## Messaging and recovery

Staff responses are case-bound and delivered by the existing outbound worker. Service
window expiry is visible as `failed/customer_window_closed`, including when it expires
between saving and dispatch. STOP, inactive installation/owner, changed case owner or
revoked staff membership suppress delivery. Consent processing pending defers it.
Do not duplicate uncertain sends. A franchise administrator reviews the existing
Automation & Messages recovery path, reconciles provider acceptance and redrives only
under its established policy. Failed/blocked text stays private in history; no guessed
template is sent. Pending/uncertain sends prevent resolve/reassign until reconciled.
Older failed sends cannot be revived after an ownership change or reopen.

## Configuration and rollout

1. Apply migration 34, `1791651600000-human-handoff.cjs`, with the migration role.
   It preserves existing conversations and creates no implicit cases or parcel grants.
2. Apply [runtime grants](../../packages/db/README.md#issue-50-runtime-privileges).
   Conversation workers need the case read/lock grants even before enabling creation.
3. Deploy compatible API/conversation/outbound workers. Retain earlier webhook,
   `outbound_enabled`, `customer_access_enabled`, `conversation_enabled` settings.
4. Add `support_enabled: true` to the server-only WhatsApp catalog. Optional hours:

```json
{"support_hours":[{"franchise_id":"00000000-0000-4000-8000-000000000001","timezone":"Asia/Kolkata","weekdays":[1,2,3,4,5,6],"start_minute":540,"end_minute":1080,"staffed":true}]}
```

Use the actual bound franchise ID and actual staffed hours. Sunday is 0. Start is
inclusive, end exclusive. End must be later on the same day; missing configuration
means unknown availability, never a two-hour promise. `staffed:false` means unavailable.
No production setting is changed by this implementation.

Disable `support_enabled` to stop new cases and writes. Existing active cases still
pause the bot; queued staff replies suppress while disabled. Keep compatible workers
and resolve/reconcile active cases before reverting to pre-#50 code, which cannot
honor durable ownership. Remove new catalog keys before running an older strict parser.
Repair applied schema forward; retain audit and encrypted history. Retention/deletion
policy rollout stays with #72. Language interpretation and outcome metrics stay #51/#52.

## Fictional verification

Run the pinned toolchain and disposable test PostgreSQL. `pnpm test:api`,
`pnpm test:web`, `pnpm db:local test:db`, migration check and build include this work.
`apps/api/test/database/support.test.ts` starts the real API with signed synthetic
callbacks, runtime DB roles and a fake provider. Send HELP twice, race staff claims,
save a private note, reply in/outside the service window, STOP, resolve and reopen.
Inspect saved state/history, outbound state and A/B/C denial assertions. The UI tests
cover selection, focus return, claim, notes, reply recovery, reasons and read errors.
Use fictional users only. Live Meta templates/provider delivery require separate
staging qualification; local tests do not establish that qualification.
