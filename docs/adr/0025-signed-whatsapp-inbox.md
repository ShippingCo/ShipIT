# ADR 0025: Signed operational WhatsApp inbox

Status: implemented for issue #37 review. Date: 2026-09-20.

## Context and recovered decisions

The implementation task “Solve issue #36” was retrieved, including its implementation progress,
database fixes and verification results. It emphasized explicit identity binding,
live authority, short transactions, immutable evidence, forward migrations and honest
reporting of incomplete checks. The #36 source and design agree with those decisions.
Its full quality run failed unchanged web waits and its full database rerun timed out;
those historical failures are not represented as passing here.

GitHub confirms #35 merged through PR #119 and #36 through PR #120. The clean local
checkout initially remained on #36. After checking out/pulling main, #37 branched from
`42097f064eeef17d392d8b7f3fd520f2d7a913c5`. That merge's tree equals #36's implementation
commit `3e4439b`; no intervening code needs reconciliation. All issues #1–#36 are closed;
#37–#83 remain open. #37 has no discussion comments or additional cross-linked changes.
Its #4/#15/#36 prerequisites are available. No GitHub status label was changed.

## Decision and alternatives

Use an encapsulated Fastify raw-buffer parser and Node's HMAC-SHA256/timingSafeEqual.
Verify the exact bytes before UTF-8 decoding or strict JSON parsing. No SDK or parser
dependency is required. Reject compressed content instead of silently changing signed
bytes. Reject duplicate signature headers and duplicate verification parameters.
The existing 256 KiB request ceiling, depth 64 and explicit maximum 100 logical items
bound work; all items validate before any database write. Batches commit atomically.

`/webhooks/whatsapp` is separate from #13's `/auth/whatsapp/webhook`. GET only echoes a
bounded challenge after independent verification-token validation. Neither callback
proves operator identity, establishes a browser session, or authorizes shipment access.
No browser selector or session contributes tenancy to ingress.

The secret-manager configuration includes the app signing secret, a distinct verify
token, an explicit WABA allowlist, a dedicated payload encryption key/version and a
separate stable HMAC fingerprint key (to prevent offline guesses of short message text).
The allowlist is provisioned against the app's asset assignments; it is not learned
from callbacks. A fixed database function resolves the signed WABA + phone identity
against #36's immutable installation. Phone/WABA mismatches never select a tenant.
Signed unknown/app-mismatched identities retain only digest evidence in global
quarantine, with no private payload or invented owner. Disabled known installations
retain correctly owned evidence but the worker quarantines it before dispatch.

Logical identity is installation plus `inbound:<message_id>` or
`status:<message_id>:<status>`. A message ID alone would incorrectly discard delivery
and read transitions. The normalized fingerprint includes timestamp and retained
semantic fields; reordering/rebatching or JSON encoding changes do not create another
event. Different semantics under the same key preserve the original and quarantine
the conflict. Returning 200 after durable quarantine avoids an endless provider retry
of the same conflict. Failure to persist any part returns 503, including unknown
identities; a lost COMMIT response also returns 503 and replay resolves it.

Store only validated source metadata plus AES-256-GCM-encrypted contact/content.
Authentication binds the encryption key version, WABA, phone and logical event key.
No raw callback, contact display name, provider error prose, media URL or billing
metadata persists. Unsupported message shapes retain a minimized encrypted identity
and an explicit quarantine reason. Text, button and supported interactive reply text
are preserved for #38's deterministic consent processing. No consent is inferred here.
The existing field/class retention policy remains authoritative; this ADR introduces
no global deletion period. #72 owns approved lifecycle/hold processing.

## Durable jobs and ordering

The inbox row is the durable job. #35's `domain_events` and generic worker currently
accept courier aggregates and enforce their producer-command relationships. Widening
those contracts just to carry external callbacks would risk existing producers.
An inbox-specific selector and database-only processor avoid that change. This is not
a second general workflow framework: only inbound preparation and delivery observation
are implemented, with no arbitrary handlers or network effects.

Select one due row with FOR UPDATE SKIP LOCKED and retain its lock through projection,
attempt evidence and completion. The transaction has a 25-second deadline. Crash or
connection loss rolls everything back, making the job eligible again; a committed
completion prevents replay. Separate leases/acknowledgements add no benefit for these
short, exclusively database effects. If a future handler requires network I/O, it must
use an owned durable intent/lease protocol rather than extending this transaction.

A PostgreSQL exception subtransaction rolls back partial projection changes while
retaining a controlled failure result. Retry waits are 2, 4, 8 and 16 seconds, with
quarantine on the fifth attempt. Connection outages roll back the whole transaction
and do not manufacture a successful attempt. Oldest-due ordering and a 20-job poll cap
bound each API process turn. This is not a throughput/fairness SLO; #74 owns load qualification.
Shutdown stops new jobs and drains the current bounded transaction.

Delivery progress is a monotone maximum: 0 (none), 1 (sent), 2 (delivered), 3 (read).
Failure is independent evidence and cannot erase observed delivery/read. Last provider
time is also monotone. An unknown outbound message ID is retained under its installation
for #39 to reconcile; it never causes a guessed parcel update. Completed inbound rows
are available for an independently deduplicated #38 consumer, not proof of a reply.

## Research that influenced the implementation

- [Meta's hosted webhook SDK documentation](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
  confirms app-secret verification of X-Hub-Signature-256. Its older SDK is evidence for
  the protocol, not a dependency or a current support guarantee. The direct Graph webhook
  documentation was inaccessible during this session.
- [Meta's status object reference](https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object)
  identifies message ID, status, recipient and timestamp. The implementation supports
  sent/delivered/read/failed; other status values are explicit unsupported evidence.
- [Fastify's buffer parser and encapsulation contract](https://fastify.dev/docs/v5.0.x/Reference/ContentTypeParser/)
  supports keeping raw parsing local to the webhook plugin without changing normal JSON APIs.
- [Stripe's webhook engineering guidance](https://docs.stripe.com/webhooks)
  supports exact-body verification, durable duplicate handling, asynchronous work and
  avoiding arrival-order assumptions. Its protocol and retry promises are not attributed to Meta.
- [AWS Builders' Library: making retries safe](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  motivates stable intent identity, atomic persistence and distinguishing conflicting reuse.

## Compatibility, security and verification

Migration 24 is additive. Existing producer tables, auth callbacks, provider sends and
released migrations remain unchanged. New functions use a fixed search_path and have
no PUBLIC execution grant. Runtime receives safe reads and narrow function execution,
with no inbox/history/projection writes or global quarantine read. The AST gate allows
only the two exact global ingress/scheduler queries in the trusted adapter; normal
private queries still require both organization and franchise predicates. Inbox worker
capabilities require the dedicated trusted service identity and cannot come from membership.

R29 protects minimized inbox health/detail, with live scope checks on every request.
No new role or mutation permission is introduced. Deployment operators own global
quarantine investigation; terminal evidence requires reviewed forward repair, not a
browser reset or silent reassignment. Full application redrive remains a future owning
operations change; #37 does not expose a universal retry button.

See [operations](../architecture/whatsapp-webhooks.md) and
[verification](../architecture/issue-37-verification.md) for acceptance evidence and limits.
