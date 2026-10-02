# Trusted customer conversations — Issue #47

Customers can ask a verified franchise channel for tracking, ETA, delay, booked charges,
an issued receipt summary or delivery-code resend. The fixed router consumes completed,
signed inbound messages after consent processing. Customer text never selects an endpoint,
SQL statement, organization, staff role or recipient phone. There is no public tool API.

## Identity, state and authoritative facts

Reuse [#46 verification](customer-access.md). A phone match or consent alone grants no
shipment access. Every selected docket is rechecked against current installation-bound
relationship proof. Multiple permitted shipments require an exact docket; the next
docket-only reply resumes the pending question. An explicit denied docket clears the
old selection. Conversation selection expires after 15 minutes.

Tracking, ETA and delay use the current Parcel/Route projection. Missing facts remain
unavailable; elapsed time never implies delivery. Charges use the saved Booking obligation
and committed ledger. Receipt assistance reads an already issued immutable Booking receipt
summary; it does not issue a new document or return a download URL. Finance is restricted
to the verified booking sender. Recipient proof permits tracking only.

Deliveries owns code assistance. The signed channel must independently equal the retained
delivery recipient, and a current verified Parcel binding must also exist. Resend shares
the existing 60-second cooldown, three-resend limit, live-challenge, lock, pending-send and
Parcel-state checks. Its result contains no code. A tracking rebind cannot redirect the
delivery recipient. The signed-inbox command principal authorizes only resend; it grants
no staff operation or membership.

STOP/START take priority over every question. Revoked consent prevents tools and new
replies. HUMAN takes priority over tools and pauses self-service until RESUME or expiry.
The message asks the customer to contact the franchise and explicitly says no automatic
case has been created. Staff case creation belongs to #50.

## Persistence and recovery

`customer_conversations` stores keyed channel selection and pause state. Immutable
`customer_conversation_turns` stores inbox identity, closed intent/outcome, resource
versions and correlation ID. History reads return at most 20 safe receipts, without raw
transcripts, tokens, codes or answer bodies. Durable deduplication receipts are retained;
deletion/retention policy remains #72. Existing inbox/outbound payload encryption remains
the only place message content is retained.

The fixed database scheduler serializes each installation's inbound order. One transaction
uses indexed completed-source and installation-order lookups. It
commits turn, selection, resend reservation and encrypted reply. Tool errors roll back to
a savepoint before a generic retry-once/contact-franchise response. Statement, lock and
transaction limits are 3, 1 and 15 seconds. If the fallback itself cannot commit, no turn
or provider send occurs; existing worker polling retries the durable source.

The existing outbound worker sends after commit and rechecks current owner/installation,
consent, bindings, contact generation, Parcel version and 15-minute source freshness.
Provider uncertainty retains the existing no-blind-resend policy. Reply destination comes
only from the signed source. Qualified code delivery uses the existing authentication
template; the conversation answer never includes its protected variables.

## Setup and rollout

Apply migration `1791392400000-trusted-conversation-tools.cjs` and the
[#47 runtime grants](../../packages/db/README.md#issue-47-runtime-privileges) first.
Add `conversation_enabled: true` to the server-only WhatsApp catalog after existing
`customer_access_enabled`, `outbound_enabled`, webhook configuration and authentication
keys are enabled. The flag defaults false. Resend additionally requires the existing
delivery-proof secret configuration and deployment-qualified template. No new environment
variable, dependency, browser configuration or staff role is introduced.

The existing API runtime hosts inbox, consent, conversation and outbound loops. The
separate `start:worker` retains its configured domain-notification responsibilities.
Disable the flag to stop routing;
compatible outbound workers suppress queued conversation replies when disabled. Drain or
suppress these intents before replacing workers with pre-#47 code. Schema rollback is
forward repair; preserve receipts and protected delivery evidence.
Before starting pre-#47 code, remove the `conversation_enabled` catalog key entirely;
older strict configuration parsers do not recognize it even when false.

See [ADR 0032](../adr/0032-trusted-conversation-tools.md) for recovered decisions,
research, alternatives and implementation plan, and [verification](issue-47-verification.md)
for acceptance evidence. [Quotes](customer-quotes.md) are implemented in #48;
pickups, staff cases, languages/AI and outcome metrics remain #49–#52.
Live Meta qualification and production rollout are separate work.

The #48 review repairs make exact docket selection case insensitive, report recorded
delay minutes while still relevant, and defer replies while consent processing is
pending. Deferral retains the encrypted payload without consuming a send attempt;
revocation and expiry still suppress it.

## Reproducible fictional verification

Use the repository-pinned toolchain and Docker Desktop:

```sh
pnpm test:api
pnpm db:local exec node scripts/test-conversations.mjs
pnpm db:local quality
pnpm check:migrations
```

The focused runner installs fictional owned customers, Booking/Route/delivery and signed
WhatsApp fixtures, starts Fastify and workers, records safe synthetic sends, closes/reopens
pools, and removes its registered database resources/container. It includes #46 and fresh
migration regressions. The full quality suite also checks all earlier service/UI behavior
and private object-store contracts. No real provider credentials or customer data are needed.
