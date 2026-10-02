# ADR 0031 — Verified parcel access and private tracking

Status: implemented locally for review; acceptance/merge pending. The user approved
booking-customer plus explicitly verified recipient access on 2026-10-02. The earlier
Milestone 4 conversation proposed this policy but had not approved it.

## Decision

A signed WhatsApp message proves control of the sending channel at the registered
franchise installation. It does not prove that the sender owns every customer record
with that number. Every parcel therefore needs an explicit sender or recipient binding.
No existing customer, contact match, consent record or browser demo receives access by backfill.

Use a recorded local franchise administrator attestation as the initial independent
shipment-relationship proof. Staff must check that relationship separately from the
incoming number/docket and retain the evidence in the franchise's controlled process.
The API records only its UUID reference. It is not an automated identity-verification
provider, proof upload workflow, or delivery OTP verification. False staff attestations
remain a staff trust risk; neither a signature nor an arbitrary UUID validates the
underlying human evidence. Operators cannot create bindings.

Propose W46 `customer.access.manage` for a live own-franchise `franchise_admin` only,
using the existing seven roles and selected-franchise membership transaction. Organization
administrators, custody, assignments and read-only membership do not imply this action.
This is an explicit action-matrix amendment for review, not a reuse of W45 installation
administration or W34 consent override. Customer grants never create staff membership.

One active binding per parcel/relation stores installation, a keyed contact identifier,
version, independent evidence reference and signed inbox reference. Sender bindings also
store the booking's current customer contact generation. Rebinding advances the version
and invalidates old grants. Customer phone changes rotate the existing contact generation
and invalidate sender access. Recipient rebind changes the tracking relationship only;
immutable booking and delivery-proof recipient snapshots remain with their owning domains.
It requires a new signed source and independent attestation, never migration of old grants.
An authorized immediate revoke also advances the version and expires the binding,
recording new revocation evidence without transferring access to another person.

Binding lifetime is 24 hours; signed evidence must be completed and no older than 15
minutes when used; tracking grants last at most 15 minutes and never outlive the binding.
These are explicit implementation policy values proposed for review. Short lifetimes
limit continued access by shared or reassigned numbers, but cannot detect a carrier
recycling a number inside that window. Staff must rebind on a known relationship change;
no claim of universal recycled-number detection is made.

Bindings/commands/grants are additive PostgreSQL records with composite tenant references.
Commands are immutable, fingerprinted, scoped to actor/franchise/key, and committed with
the binding. Parcel locking and expected binding versions give concurrent edits one
winner. Replays reauthorize first and return the original safe outcome. Grant creation
deduplicates by binding/version/inbox, so retries do not prolong access.

An HMAC with a separate purpose produces an opaque 256-bit token from a random grant ID.
Store only its SHA-256 verifier; key reuse is purpose-separated from browser tokens.
The same deployment key supports restart replay; rotating it makes new token derivation
different. Existing bearer grants remain valid until their stored expiry unless their
binding changes. Do not promise instant revocation solely through key rotation.
Replay compares the newly derived token verifier with the persisted verifier and returns
unavailable after a key change, rather than returning an unusable token or extending expiry.

The grant's stored owner selects a narrow trusted transaction. Each read rechecks the
grant, binding version, installation, active roots and sender contact generation before
reading the parcel. Foreign and unknown dockets have the same controlled response.
Return only docket, status, version, a bounded safe timeline and authoritative route
arrival ETA, or explicit unavailable. A route arrival ETA is never a doorstep delivery
promise. No addresses, phone numbers, staff notes, money, evidence, keys or OTPs are returned.
The route estimate is cleared once the parcel starts last-mile delivery or enters
failed/held/terminal work; a skipped latest route effect also clears an earlier estimate.

## Alternatives and research

Automatic phone joins are simpler but collapse shared identities and can disclose a
franchise's private customer relationships. A new customer password system or separate
identity provider adds account recovery and operating cost outside #46. Manual attestation
plus a short-lived grant reuses current trusted ingress and staff authorization, with the
staff trust limitation described above.

[OWASP object-access guidance](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
supports checking each requested object against the caller's permitted set. [OWASP session
guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
supports treating bearer material as sensitive and bounding its lifetime. [AWS Builders'
Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
explains retry identity and why repeated requests must not create repeated effects.
The repository already has transactions and request fingerprints, so the applicable lesson
is to reuse those primitives, not add AWS services or a new queue. [PostgreSQL 18 locking
documentation](https://www.postgresql.org/docs/18/explicit-locking.html) informs the shared
read/exclusive update boundary. Limits, manual verification, API shapes and deployment
choices above are this implementation's engineering decisions, not mandated source values.

## Scope and rollout

Register the HTTP surfaces only with explicit `customer_access_enabled: true` and signed
webhook configuration. Apply the forward migration and narrow runtime privileges first.
Disabled/default configurations retain their existing routes. No production data was
modified. #47 owns conversation routing and grant delivery through the approved messaging
service; this issue exposes its trusted `select`/`track` seam but does not send replies.
Receipts, financial tools, pickup requests, quotes, handoff, language interpretation and
outcome metrics remain with #47–#52. Browser demo code is not promoted into production.
