# ADR 0035 — Human support handoff

Status: local implementation for review, #50. Builds on merged #46/#47 and the
existing #38/#39 outbound policy; #49 is in the base but not a named prerequisite.

## Decision

Use PostgreSQL case ownership per installation-bound conversation, not a second
messaging system. HUMAN, HELP, and unresolved intent open one active case. Unknown
intent is evaluated only after pending quote/pickup dialogue and shipment selection.
Repeated messages update the latest signed source and safe conversation receipts,
without a new case or repeated acknowledgment. A unique partial index is the final
duplicate guard. A resolved conversation may create new work; reopening an old case
is rejected if another active case exists.

Case state is open → claimed → resolved, with explicit reopen to open. Claim,
assignment, reply, internal note, resolution and reopen have expected revisions and
scoped command receipts. R22/W28 provide existing actor/scope rules; no support role
is invented. Only the assigned operator can reply/note/resolve. Other local operators
may assign, including recovery from a departed staff member. Organization admin has
read access only unless independently granted a local operational role.

Bot pause is derived from a durable active case. It survives conversation-selection
expiry, RESUME, restart and disabling new case creation. STOP/START are still handled
first. Resolving releases the bot; reopening pauses it. Queued bot answers recheck
ownership at dispatch. Already dispatched provider calls cannot be recalled; the
reservation transaction is the linearization boundary, as with existing messaging.

Private context consists of the validated parcel reference and bounded safe turn
receipts, not raw text or delivery codes. Staff can ask the customer for details in
a case-bound reply. Notes and response text are encrypted with the existing outbound
envelope and separated by immutable event type. Audits expose controlled reason,
actor, resource and correlation only. Four-to-eight-digit standalone sequences and
credential patterns are rejected in staff text to prevent delivery-code pasting;
dedicated delivery-code assistance remains the only supported code path.

Replies reserve existing encrypted outbound intents in the same transaction as the
case revision, event and request receipt. Recipient comes from signed channel data,
never a staff-supplied phone. Dispatch rechecks consent, installation, owner membership,
case ownership term and the 24-hour service window. A reassignment/resolution/reopen
invalidates older unsent replies. No approved handoff template is established, so a
closed window produces a visible blocked (`failed/customer_window_closed`) message.
No provider call occurs in the HTTP transaction. Uncertain sends retain the existing
administrator reconciliation contract; resolve/assign cannot abandon pending sends.

Hours are deployment-owned per franchise, validated IANA timezone/weekdays/local
minute range and staffed flag. They describe availability, not an SLA. Missing hours
or unstaffed configuration explicitly says response time cannot be promised. Same-day
hours are sufficient for this pilot; no holiday calendar, scheduling system, contact
center, language model or metrics platform is added.

## Evidence and alternatives

- [AWS: safe idempotent retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): explicit request identity and atomic receipt/effects fit staff retries after a lost HTTP response.
- [PostgreSQL 18 partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html): active-only uniqueness fits one active case with retained closed history.
- [PostgreSQL 18 locking](https://www.postgresql.org/docs/18/explicit-locking.html): reuse root → installation → case locks; avoid a new distributed lock or event broker.
- Meta documentation request returned 429 during this review. Existing #38/#39/#49
  policy remains the authority; no template approval or live delivery is inferred.

These engineering choices suit Fastify/raw pg/PostgreSQL 18.6 and the current volume.
Queue polling and bounded history are simpler than adding sockets/search infrastructure.
They trade live presence and full transcripts for minimal private data and explicit
refresh. No additional dependencies or paid service are needed.

See [operations](../architecture/support.md) and
[verification](../architecture/issue-50-verification.md).
