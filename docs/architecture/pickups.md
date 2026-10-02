# Pickup requests (#49)

Pickup is a franchise-owned request from a verified WhatsApp channel. The signed
installation/contact pair is its principal, as for #48 quotes; a typed phone number
or guessed reference grants nothing. No existing parcel relationship is required to
request a new shipment. This does not grant tracking access to any parcel.

## Customer flow

1. Complete `QUOTE`, including dimensions, even when the result requires staff review.
2. Send `PICKUP <own quote reference>`, then a pickup address (12–500 characters).
3. Send `start | end` as ISO timestamps with timezone, such as
   `2026-10-03T10:00:00+05:30 | 2026-10-03T12:00:00+05:30`.
4. Send the displayed `SUBMIT PICKUP <request key>`. Repeating this key, including
   after reconnect/restart, returns the original request, not a second request.
5. `PICKUPS` shows the latest ten owned requests. `PICKUP STATUS <reference>` checks
   any owned request. `CANCEL PICKUP <reference> <version>` cancels a submitted request.

The requested start is future, within 30 days, with a positive window of at most
24 hours. These are bounded implementation inputs, not available slots. Addresses
are structurally checked, not geocoded or promised serviceable. Invalid input leaves
the current step intact and gives a short correction prompt. STOP and HUMAN retain
their existing precedence and clear the pickup draft. The draft expires after the
existing 15-minute conversation interval. Worker ticks remove expired address drafts
in batches of 100, including when no inbound work remains. No customer PII is stored
in browser storage, events, audit, or application logs.

There is a durable limit of ten submissions per installation/contact per rolling
24 hours. Exact confirmation retries are checked before that limit. The existing
signed inbox deduplication and installation ordering serialize concurrent workers.
Retained submitted requests and immutable quote evidence remain subject to #72's
reviewed retention/deletion work; disabling a worker also stops draft cleanup.

## Staff and concurrency

The production **Pickups** page lists scoped summaries; opening a request loads its
private address, verified WhatsApp contact and shipment inputs. R22 permits org-admin reads in a selected own
franchise, plus franchise admins and operators. W28 permits franchise admins and
operators to accept/decline. Dispatchers, delivery agents, accountants and read_only
have no pickup authority. Org-admin read access does not imply write permission.

Acceptance assigns the acting staff member and requires a future agreed window and
explicit confirmation that capacity was checked and the customer agreed. Heavy,
large, unsupported, dimensional, missing-policy or expired estimates require manual
review confirmation. All pickups require a staff decision. An estimate is never a
pickup price, booking, invoice, or capacity reservation.

Only `submitted -> accepted | declined | canceled` is allowed. Each command checks
the expected version under a row lock. Whichever accept/cancel transaction wins
commits; the other receives a controlled conflict. Accepted requests require staff
contact for subsequent changes; #49 does not cancel bookings or schedule dispatch.
Foreign and unknown IDs both return `RESOURCE_NOT_FOUND`. Staff command replays
recheck current membership before returning their fingerprint-bound result.

## API

Cookie/CSRF and scope handling use the existing operator transport. Each staff route
requires `organization_id` and `franchise_id` query parameters.

| Route | Contract |
| --- | --- |
| GET `/api/v1/pickups` | Up to 50 safe summaries; opaque UUID `after` boundary and `next`; no global counts. |
| GET `/api/v1/pickups/:id` | Owned address, verified WhatsApp contact, shipment inputs, decision, assignment and safe notification state/attempts. |
| POST `/api/v1/pickups/:id/decision` | `Idempotency-Key`; `expected_version`, `decision` accepted/declined. Acceptance also requires `agreed_start`, `agreed_end`, `capacity_checked: true`, and `manual_reviewed: true` when flagged. |

Validation, stale state, conflicting retry and dependency failures use existing
`VALIDATION_FAILED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, and
`TEMPORARILY_UNAVAILABLE` responses. Unknown body/ownership fields are rejected.
UI keeps an uncertain command's exact key/body for retry and clears private state
when the selected franchise or session changes. Native form labels/controls, dialog
focus return, loading/empty/error states and live status text support keyboard/mobile use.

## Durable decisions and recovery

`pickup_events` is the append-only domain journal, with `pickup.requested`,
`pickup.accepted`, `pickup.declined`, and `pickup.canceled`, aggregate version,
tenant, actor, correlation and timestamp. It is also the durable source for pickup
decision message intents; no new broker or polling worker is added. The service
commits state, event, command result and encrypted outbound intent atomically.
The existing sender performs provider I/O only after that transaction commits.

Dispatch rechecks installation, tenant lifecycle, source event/version, contact,
STOP, pending consent processing and the current 24-hour customer-service window.
Pending consent defers without consuming a send attempt. A closed window records
`failed/customer_window_closed`, retains the rendering for bounded recovery, and
does not send an unapproved template. Staff must ask the customer to message again
and use existing franchise-admin messaging recovery while the rendering is live.
There is no promise that staff decisions outside that window can be sent proactively.
The customer can always send PICKUPS to read the persisted outcome.

Provider rejection/unavailability leaves the pickup decided and its failed job
visible. Existing redrive requires expected notification version and repaired
dependency. Ambiguous provider acceptance remains `uncertain` and requires the
existing investigation/confirmed recovery path. No blind retry of uncertain sends.
The existing outbound health API exposes state counts and oldest age; pickup detail
exposes message creation time and attempts. Recovery owner: franchise administrator.

## Migration and rollout

Apply additive migration 33 before compatible API/workers. Grant the runtime role
SELECT/INSERT on `pickup_requests`, `pickup_events`, `pickup_commands`, UPDATE only
on pickup `state,version,assigned_staff_id,agreed_start,agreed_end,updated_at`, and
UPDATE on conversation `pickup_draft`, in addition to #48/#39 grants. The replaced
conversation scheduler keeps its existing signature and EXECUTE grant. Events and
commands are immutable; no released migration is edited. See `preparePickups` in
the test fixture for the executable grants.

Enable the default-off server WhatsApp configuration `pickup_enabled: true` only
with `customer_quotes_enabled`, conversation, customer access, outbound and webhook
configuration. Existing #48 quote policies supply review thresholds. No new secrets,
libraries, paid checkout, AI, external carrier booking or dispatch optimizer.
Disable the flag to stop customer pickup creation and staff decisions. Retain the
compatible sender to suppress queued pickup messages; keep compatible conversation
workers running for draft cleanup. Do not roll old workers back over queued pickup
intents. Repair schema forward. #50 owns human support cases, #51 language/AI,
#52 milestone outcome reporting, and #72 broader retention.

Research and rationale: [ADR 0034](../adr/0034-pickup-requests.md).
Verification: [issue #49](issue-49-verification.md).
