# Signed operational WhatsApp webhooks

[ADR 0025](../adr/0025-signed-whatsapp-inbox.md) · [Verification](issue-37-verification.md)

## Enablement and configuration

Apply migration `1790701200000-whatsapp-webhook-inbox.cjs` before enabling the optional
`webhook` property in the existing WHATSAPP_CONFIG_REF secret-manager catalog:

```json
{
  "graph_version": "v24.0",
  "bindings": [],
  "webhook": {
    "app_secret": "<Meta app secret, 32–256 letters/digits/underscore/hyphen>",
    "verify_token": "<independently generated 32–256 character token>",
    "waba_ids": ["100001"],
    "encryption_key": "<dedicated 32-byte key encoded as 64 lowercase hex characters>",
    "fingerprint_key": "<different stable 32-byte HMAC key as 64 lowercase hex characters>",
    "key_version": "v1"
  }
}
```

Place real catalog bindings from [installation onboarding](whatsapp.md) in `bindings`.
The example IDs are fictional; placeholders are intentionally not valid secrets.
Verify WABA assignments to the signing app before provisioning the allowlist. A callback
must match both that allowlist and the connected installation's immutable WABA/phone.
Different apps need isolated deployment/configuration boundaries; a single endpoint
configuration authenticates one app. Do not accept arbitrary secrets or tenant mappings
from a caller. Omitting `webhook` keeps ingress and its polling loop disabled.

Use separate secrets for verification, signing, payload encryption and fingerprints. The operator APIs
never return them. Developer-only LOCAL_WHATSAPP_JSON uses the same nested configuration;
hosted environments still require a managed resolver. Environment files are not auto-loaded.
Do not place these values in Vite configuration or a shell command that logs them.

Configure Meta's business callback URL as `https://<API host>/webhooks/whatsapp`, subscribe
to the messages field and perform the GET challenge. This is distinct from the existing
authentication transport callback. Preserve exact request bytes through the proxy; this
endpoint accepts uncompressed UTF-8 application/json, including charset=utf-8.
Meta sandbox provisioning, actual subscriptions and live delivery must be verified in
staging. Local signed fixtures do not certify provider onboarding.

Retain encryption keys under their immutable version while owned inbox records need
them. `openInboxPayload` rejects a different version or swapped identity. The current
reader accepts one explicitly selected version: a future authorized consumer must
select the stored version from a managed key catalog. Do not overwrite a key under the
same version or discard old keys during rotation. No decryption endpoint is exposed.
Keep the fingerprint key stable for the deduplication ledger's lifetime; encryption and
signing rotation do not change duplicate identity. Fingerprints are HMACs, not plain
hashes that could reveal short text through guessing. Fingerprint-key replacement needs
a reviewed ledger/key migration; do not silently rotate it as an access token.

## HTTP behavior

| Request | Result |
| --- | --- |
| GET `/webhooks/whatsapp` | Exact subscribe mode, verify token and numeric challenge; plain challenge only, no session cookie |
| POST `/webhooks/whatsapp` | Verify X-Hub-Signature-256 against original bytes, normalize all items, commit inbox/quarantine, then 200 `{received:true}` |
| Invalid signature/duplicate signature header | 403 before parsing or database access |
| Invalid UTF-8/JSON/depth/event shape or more than 100 items | Controlled 400; no partial batch |
| More than 256 KiB | 413 |
| Unsupported media/content encoding | 415 |
| Persistence/commit uncertainty | 503 TEMPORARILY_UNAVAILABLE, Retry-After: 5; provider retries original callback |
| Valid unknown identity or conflicting event reuse | 200 only after digest-only quarantine commits; no payload, tenant guessing or overwrite |

All responses are no-store. Logs contain only safe route/request/result/duration data.
New quarantine emits `whatsapp_webhook_quarantined / MANUAL_REVIEW_REQUIRED` without
identity or content. Database failures never become a false received acknowledgement.
The existing per-process HTTP limit of 120/minute applies; size/batch limits are not a
production capacity promise. Size traffic and ingress controls during #74 qualification.

The logical status key includes message ID and status, so read and delivered callbacks
for one message are separate facts. A changed timestamp or retained payload under the
same key is a conflict. Byte encoding, unrelated provider metadata and batch order are
not identity. Retrying identical input preserves the original encrypted payload and receipt.

## Stored data and downstream contract

`whatsapp_inbox` owns source metadata, encrypted normalized payload, original fingerprint,
processing state and attempts. AES-GCM AAD includes key version, WABA, phone and event key.
The worker never decrypts content. Completed inbound rows preserve sender/type/text and
optional context/reply ID for #38; unsupported media/types remain quarantined. The raw
callback, display names, media references/URLs, billing data and free-form errors are discarded.

`whatsapp_delivery_observations` is scoped by installation and provider message ID.
Progress uses 0/1/2/3 for none/sent/delivered/read, plus independent failure evidence and
maximum provider timestamp. It cannot regress on reordered callbacks. It does not
assert an outbound attempt exists: #39 must join through its trusted installation and
provider message mapping. Never join by phone alone or mutate parcels from callbacks.
#38 must independently deduplicate consent consumption; completed means ingestion
processing completed, not consent granted or a customer reply sent.

Each polling turn handles at most 20 due rows and waits one second. SKIP LOCKED coordinates
replicas. A row lock, projection, attempt evidence and completion share one transaction;
crashes roll back the effect and release the row for replay. Retry waits are 2/4/8/16 seconds,
then the fifth failed attempt quarantines. Source fingerprints, attempts and quarantine
evidence are immutable. No network call occurs while the job holds a database lock.

## Runtime grants and rollout

Replace the illustrative role with the deployed restricted runtime role:

```sql
GRANT SELECT ON shipit.whatsapp_inbox, shipit.whatsapp_inbox_attempts,
  shipit.whatsapp_delivery_observations TO shipit_api_runtime;
GRANT EXECUTE ON FUNCTION shipit.whatsapp_receive(jsonb,text[],uuid),
  shipit.whatsapp_inbox_next(), shipit.whatsapp_inbox_process(uuid,uuid,uuid)
  TO shipit_api_runtime;
```

Retain #36 membership/installation grants. Do not grant direct inbox/history/projection
DML, table ownership, or global quarantine SELECT to the API role. Migrate schema first,
deploy compatible code/grants, configure/verify Meta, then enable the catalog property.
The code starts its worker only when that property exists. Rollback by removing it and
deploying compatible code; preserve source evidence and repair schema forward.

No old records need backfill. Apply/rollback/retry tests preserve populated #36 tables
and audit. Metadata remains protected despite minimization; use the existing
[field/class retention contract](money-tax-proof-privacy-contract.md#field-and-class-retention).
#72 owns approved expiration, holds and key/data deletion. No arbitrary global retention
period or raw-body archive is introduced here.

## Runbook: whatsapp-inbox-v1

R29 administrators can GET `/api/v1/whatsapp/inbox/health` and
`/api/v1/whatsapp/inbox/:id`, with explicit organization_id and franchise_id selectors.
Health returns counts/oldest age by state, recovery owner and runbook. Detail returns
only ID, kind, state, attempts, controlled reason and processing times. The same live
permissions as installation reads apply. Foreign IDs and unknown IDs both return 404;
read_only and other unapproved roles receive 403. No contact, provider message ID,
ciphertext or payload appears in these responses.

1. For 503 ingress, restore database/service availability and let the provider replay
   the original callback. Do not synthesize a different logical ID to avoid deduplication.
2. For retry_wait, inspect safe job reason/age and dependency health. The worker retries
   automatically. A process restart retains attempts and original source identity.
3. For installation_disabled, coordinate with the franchise administrator and deployment
   operator; inspect the actual installation/root lifecycle. Do not assign another tenant.
4. For attempts_exhausted or unsupported_payload, stop the owning processor if necessary,
   repair the cause and prepare a reviewed forward recovery migration with original
   identity and preserved attempt evidence. Terminal rows cannot be reset through API
   or runtime SQL. A generic redrive endpoint is not implemented by #37.
5. Global quarantine is deployment-operator evidence only. Use a privileged, reviewed
   diagnostic to inspect counts by reason and age; do not expose global counts to tenant
   APIs. Correct app/WABA/installation configuration. No original body is retained for
   unknown identities, so do not pretend it can be replayed from a digest.
6. A conflict requires investigation of the original versus incoming fingerprint;
   the first accepted fact is unchanged. Never automatically overwrite it.

Persistent quarantine remains visible in database evidence and tenant health across a
restart. Hosted alert delivery is #70; the API emits safe new-quarantine/process-failure
signals. No external alert, customer message, assistant response or parcel command is sent.
