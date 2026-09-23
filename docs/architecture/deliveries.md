# Secure deliveries

Issue #42 makes Deliveries the sole proof/attempt authority while Parcels remains the
authoritative lifecycle store. No public Parcel command can select `delivered`. T05/T08
assignment and T06 completion are internal owning-service seams and commit through the
same PostgreSQL transaction as their proof facts.

## Challenge and attempt policy

A physical attempt is scoped by Organization, responsible Franchise, Parcel, recipient
contact version, assignment, delivery agent and immutable attempt number. There are at
most two physical attempts. OTP verification failures are a separate lineage counter.

- A challenge is valid only while `now < expires_at`; issue and replacement validity is
  exactly ten minutes.
- Six decimal digits are generated with Node `crypto.randomInt`. This is the smallest
  documented decision left open by #8: about 20 bits of code space, protected by five
  online guesses, strict expiry and assignment/tenant authorization.
- The fifth wrong proof atomically locks the attempt lineage. No correct proof, resend,
  replacement or staff action can unlock it.
- Ordinary resend reserves the same version/code/expiry. The first reservation starts a
  60-second cooldown. At most three later resend or replacement messages exist in one
  lineage; transport retry of one outbound identity is not another user resend. Queued,
  retrying, dispatching or uncertain provider work blocks a new resend until that same
  logical send is reconciled.
- Replacement is limited to expiry or recorded compromise, atomically supersedes and
  destroys the old verifier/ciphertext, creates a fresh version and ten-minute window,
  and preserves every attempt, failure and resend counter.
  Expiry cleanup may already have destroyed the old verifier and resend ciphertext.
  Replacement authorizes from durable lineage/state metadata and creates fresh material;
  it never requires or restores the expired secret or old outbound payload.
- Consumption, lock, supersession, failed-attempt closure and delivery closure make secret
  material unusable immediately. Expired material is never accepted; operational cleanup
  may null remaining expired ciphertext without changing immutable proof facts.

## Cryptographic boundary

Delivery keys are purpose-separated from authentication and webhook keys. Configuration
resolves an opaque secret reference containing `version`, a 32-byte verifier HMAC key and
a distinct 32-byte encryption key. Hosted environments have no local fallback.

The stored verifier is HMAC-SHA256 over a domain-separated encoding of purpose, schema,
Organization, Franchise, Parcel, attempt, assignment, delivery-recipient reference/contact
generation, challenge version, challenge ID, key version and code. Comparisons use
`timingSafeEqual`. Same-code resend material is
AES-256-GCM with a random 96-bit nonce and the same trusted identity as AAD. PostgreSQL
stores no key or plaintext. Key-version mismatch and AAD transplant fail closed.

Verifier and ciphertext columns are intentionally absent from normal repositories, DTOs,
events, audit, timeline and logs. A narrow secret repository is callable only by the
verification action. The durable WhatsApp payload is independently authenticated and
encrypted under the existing outbound key. Complete-command idempotency remains sensitive
to changed proof input through a separately domain-separated keyed commitment; the ordinary
canonical command fingerprint never hashes the six-digit proof directly, avoiding an
offline-guessable command/support record.

## Commands and APIs

All mutation routes require an authenticated session, current Origin/CSRF checks, one
`Idempotency-Key`, an exact tenant selector, strict body fields and expected Parcel version.

| Endpoint | Authority | Result |
| --- | --- | --- |
| `GET /api/v1/deliveries` | W11/R assignment projection; dispatcher/admin scoped operations view | Active assignment-safe queue |
| `GET /api/v1/deliveries/:parcel_id` | Assigned agent or scoped dispatcher/admin | Safe challenge/send/proof state |
| `GET /api/v1/deliveries/eligible-agents` | Dispatcher F | Minimal active-agent ID/label projection |
| `POST /api/v1/deliveries/:parcel_id/start` | W10 dispatcher F | T05 first assignment, attempt and challenge |
| `POST /api/v1/deliveries/:parcel_id/retry` | W10 dispatcher F | T08 second/final attempt |
| `POST .../resend`, `POST .../replace` | W38 assigned agent | Same-code resend or controlled replacement |
| `POST .../complete` | W11 assigned agent | OTP verification plus atomic T06 |
| `POST .../exception-requests` | W39 assigned agent | Protected-evidence request |
| `POST .../exception-approvals` | W40 responsible franchise_admin F | Independent approval; no delivery |
| `POST .../exception-complete` | W11 requesting assigned agent | Revalidated exceptional proof plus T06 |

Safe state exposes only opaque references, attempt/challenge versions, status, expiry,
cooldown, remaining budgets, safe outbound state/reason, proof method and exception state.
Foreign, sibling, other-agent, reassigned and unknown resources use the same not-found
boundary. Delivery agents do not receive general Parcel, customer or franchise directories.

## Atomic completion and races

One transaction locks attempt/current challenge/Parcel, rechecks assignment/custody/state,
accepts OTP or an approved exception, destroys current secret material, inserts exactly one
immutable proof, closes the attempt, performs Parcel T06, appends the safe timeline/audit,
inserts `delivery.completed`, and commits both delivery and Parcel command receipts. Any
failure rolls all of it back. OTP, approved exception and T07 failure contend on the same
rows; one serialized lifecycle outcome wins.

`delivery.attempt_started` and `delivery.retry_started` contain only `attempt_id`,
`assignment_id`, `challenge_ref`. `delivery.completed` contains only `attempt_id` and
`proof_ref`; there is no redundant `parcel.delivered`. T07 closes the attempt and destroys
its current secret inside the existing failed-attempt transaction.

Proof method is permanently either `otp_verified` or `exceptional`. Exceptional reasons
are exactly `recipient_channel_unavailable`, `provider_unavailable`, and
`challenge_locked_reviewed`. The request requires current recipient presence, a ready
private `parcel_proof` attachment and current assignment. Approval requires a different
actor with current responsible-franchise `franchise_admin` authority and does not deliver.
Completion revalidates all inputs and invalidates the competing proof path.

## WhatsApp operational exception

`delivery_otp` is a narrow reviewed operational exception to #38; it does not alter
optional updates consent and never authorizes marketing or arbitrary free text. A delivery
send row is the only trusted outbound source. It binds attempt, current challenge, current
recipient/contact generation, Parcel, command, kind and resend ordinal before one #39
outbound intent is created. Provider timeout remains the same uncertain logical send.

Only an approved, fresh, credential-revision-matching `AUTHENTICATION` template with one
positional code and one OTP `COPY_CODE` button is supported. Other authentication shapes,
language mismatch and stale/disabled configuration fail closed. Synthetic tests make no
Meta call. The current official Meta template-creation shape is documented, but live
tenant template approval and send qualification remain a production configuration gate;
the adapter does not claim universal authentication-template compatibility. The server-only
delivery-proof catalog must explicitly set `template.meta_send_qualified: true` after that
qualification. Omission/false leaves the attempt committed with safe send reason
`authentication_template_unqualified` and queues no provider work.

## Persistence, rollout and limits

Migration `1791133200000-secure-delivery-proof.cjs` adds command, private immutable
delivery-recipient, attempt, challenge, send-reservation, exception, approval, proof and delivery-audit tables with composite owner
FKs, RESTRICT deletes, closed checks, immutable history and narrow runtime grants. It
narrowly extends Parcel commands/events and #39 source/purpose checks. Apply the migration,
provision delivery grants and resolve `DELIVERY_PROOF_SECRET_REF` before enabling routes.
Rollback disables new routes/workers while retaining rows; schema repair is forward-only.

The delivery recipient is copied once from the Parcel's immutable `recipient_snapshot` at
the first handover. It is never derived from `bookings.customer_id`, which identifies the
sender, and its private phone is available only to the delivery/worker capability. Retry
reuses the same generation; neither safe APIs nor general Parcel/customer lists expose it.

Payment collection is untouched: delivery never changes the Booking obligation. Office
collection proof can reuse these semantics only after its deferred lifecycle/calendar seams
exist; no calendar, third doorstep attempt or fake collection command is introduced. #43,
#44, #45, carrier qualification, hosting and final retention execution remain downstream.
