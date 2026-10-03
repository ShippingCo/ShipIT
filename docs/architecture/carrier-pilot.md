# Akash Ganga manual carrier pilot and recovery runbook

Issue [#60](https://github.com/ShippingCo/ShipIT/issues/60), 2026-10-03.
[Decision and research](../adr/0043-manual-carrier-qualification.md) ·
[Acceptance evidence](issue-60-verification.md).

## Selected path and owner

**Carrier: Akash Ganga Courier Limited. Mode: `manual`.** Authorized shop staff
obtain the external docket and observation through their legitimate human carrier
relationship. The pilot franchise admin checks the source and records it in ShipIT.
The customer still gets a separate ShipIT docket. Human-entered information is always
manual, never carrier-verified API information.

Operational owner: **pilot franchise admin**, the existing W26 role. The maintainer
assigns the actual duty holder in the franchise's private onboarding record before
real use; this repository cannot invent that person's identity. A dispatcher supplies
canonical movement authority. If one person holds both roles, both grants are checked.
ShipIT maintainer owns application/database failures and any later access review.
Do not share accounts, cookies or credentials to obtain another role.

The dated [AGC](../integrations/akash-ganga-research.md) and
[Maruti](../integrations/maruti-research.md) research reports are merged prerequisites.
They recommend manual fallback and do not verify API/export availability. AGC is chosen
as one bounded pilot, not because it has a verified technical interface. No second
carrier is implemented here. No outreach or real shipment testing was performed.

| Capability | Pilot selection / qualification |
| --- | --- |
| Manual reference, observation and correction | Enabled through #53/#54 and #58 review |
| Tracking/booking/rate API, webhooks | False; **N/A — live API capability not selected** |
| Tracking/shipment/rate file imports | False; **N/A — file capability not selected**; no reliable authorized carrier file source verified |
| Carrier HTTP errors, credential rotation, polling cursor | N/A — no external network operation |
| Local booking, pricing, proof, payments, messages, tracking, pickup and franchise operations | Existing domains remain available; their own permissions, consent, configuration and provider dependencies still apply |

## Setup and reproducible fictional demonstration

Use pinned Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and running Docker from
[quality setup](../QUALITY_CHECKS.md). No carrier credentials, files or customer data.

```sh
pnpm db:local demo:carrier
pnpm db:local quality
pnpm check:migrations
```

The focused command runs the actual Fastify/service/PostgreSQL path with fictional
users and parcels, all carrier machine capabilities disabled, and a provider that
throws if invoked. It creates and removes disposable test data. It checks booking,
external mapping, manual observation, review, canonical event, notification-policy
outcome, audit, response-loss retry, restart, scope denial and existing-schema upgrade.
It does not prove a live carrier API, actual parcel movement or real WhatsApp delivery.
The broad gate covers the remaining local workflows and #59 regressions.

For a development installation, migrate through
`1792256400000-manual-carrier-qualification.cjs` before running this code. Existing
carrier runtime table grants already cover the added column and read projection;
no new secret or grant is required. Authenticate normally with a permitted franchise
admin account; every request selects `organization_id` and `franchise_id`. POST needs
the normal session cookie, CSRF token and one fresh `Idempotency-Key` per intent.
Do not paste those values into committed examples or incident reports.

Create with `POST /api/v1/carriers/installations`:

```json
{"label":"AGC-MANUAL","file_import":false}
```

Save the installation ID returned by ShipIT. Confirm GET installations advertises only
`manual_observations.enabled=true`. `file_import` must be a boolean. Omission retains
the existing generic-file behavior for backward compatibility; use explicit false
for this pilot. An installation label is not verified carrier identity or entitlement.

## Daily workflow and API contract

1. Book locally using the existing counter workflow; ShipIT saves price, taxes,
   payment obligation and its own docket independently of a carrier connection.
2. Check the authorized carrier source and exact external docket. Using
   [manual carrier commands](manual-carriers.md), save service/location mappings and
   link the external reference to the correct local parcel. Unknown codes stay unmapped.
3. Append an observation with the current reference ID and parcel version. Example:

   ```json
   {"reference_id":"<saved-reference-uuid>","expected_parcel_version":3,"status_code":"MOVING","status":"in_transit_claim","occurred_at":{"state":"known","at":"2026-10-03T10:00:00Z"}}
   ```

   Replace the example timestamp with the actual sourced time. If unknown, send
   `{"state":"unknown","reason":"unknown_timezone"}` or `missing`; do not guess.
4. GET `/api/v1/carriers/installations/:id/reconciliation`. Follow its cursor for all
   records. Review reasons and use [reconciliation commands](carrier-reconciliation.md).
   Only an eligible dispatched parcel can receive the reviewed in-transit transition.
   It requires franchise-admin and dispatcher permissions. Claims cannot dispatch,
   deliver, create OTP proof, return a parcel, or settle a payment.
5. Check the canonical parcel timeline and audit. Carrier transit does not send a new
   message under the existing notification policy; route/delivery notifications retain
   their own rules. Never promise the customer an update that was not queued/sent.

GET `/api/v1/carriers/installations/:id/health` accepts only the selected scope;
it has no pagination or mutation. R19 applies; delivery agents cannot read an
installation-wide summary. Foreign and missing installation IDs return the same 404.
No response is publicly accessible.

| Health field | Meaning / operator action |
| --- | --- |
| `mode`, `capability_version`, `capabilities` | Actual immutable installation selection |
| `api.state=not_applicable` | No API expected; do not ask for a key or report an outage |
| `manual.source=manual`, `carrier_verified=false` | Staff-entered evidence, regardless of status wording |
| `last_observation` | Latest received manual record ID, source actor UUID, receipt time, source time/reason; no name, phone, address or full payload |
| `received_age_seconds` | Time since entry, not time since parcel movement |
| `source_time_state`, `source_age_seconds` | Missing/unknown/future/known; no age is invented for invalid time |
| `review.unresolved`, `review.unmapped`, `oldest_received_at` | All open nonduplicate manual records; unmapped is a subset, not another total |
| `manual.state` | `no_observations`, `needs_review`, or `last_known`; never a claim of carrier availability |

Counts include claims that require rejection or proof review; they are not a count of
safe-to-apply movements. Latest means receipt time then ID for ties; a receipt can
describe older movement. Rejected history remains the latest received record until a
new entry arrives, so consult its decision in the review queue. No arbitrary stale SLA
is imposed: compare source age with the actual service/customer promise. The duty
admin checks open cases during the shop's operational review and escalates missed
promises. A consumer should show loading, no-observations, last-known time and retryable
error distinctly; a failed health read must not display zero reviews or fresh data.

## Failure, correction and fallback drill

| Condition | Recovery owned by pilot franchise admin |
| --- | --- |
| Observation/approval response lost or 503 | Retain key and exact body. Retry the same authenticated command; durable receipt returns the prior outcome. Never change a key to force a retry. If unavailable, retain last-known information and escalate ShipIT service failure. |
| 409 version conflict | Reload reference, parcel and review state. Decide if new intent is necessary; submit a new key only for that newly reviewed intent. |
| Wrong observation/status/time | Reject with `incorrect_report` or `insufficient_evidence`, then append corrected evidence with a new key. Prior actor/time and rejection audit remain. |
| Wrong reference | Use current reference version and `reference_correction`; use the returned new reference ID for later observations. Old observations stay linked to old history. A docket reserved to a different parcel cannot be reassigned; escalate for review. |
| Unknown, stale, future, contradictory evidence | Do not force an apply or invent a source time. Obtain human evidence, reject incorrect claims, append a correction. Delivery claims require the existing delivery-proof process. |
| Carrier information unavailable | Continue local operations; preserve last-known evidence and visible age. Ask the authorized human carrier contact when available. Do not make a fake observation just to refresh health. |
| Import attempted on manual-only installation | 403 `ACTION_FORBIDDEN` before parsing or storing input. Continue manual entry; a new API/export opportunity requires separate qualification. |
| 401/403/404 | Reauthenticate/check assigned scope or ask the admin for the proper role. Do not share a login or probe another franchise. |
| Malformed input | 422; correct the identified structured field. No partial mutation. Keep arbitrary notes, addresses and secrets out of codes. |

Re-run `pnpm db:local demo:carrier` to exercise this drill, including fault after COMMIT
and a fresh runtime pool reading the saved results. Existing cross-channel tests feed
generic file/poll evidence through #58 and prove one canonical transition; this is
regression evidence only, not an enabled capability for the manual pilot. Changing
source cannot bypass the canonical state/version gate. Repeated independent claims
may remain separate review evidence but cannot reapply a completed transition.

## Rollout, limitations and later work

Apply schema, then compatible API code, then create the explicitly manual-only pilot
installation. The additive default preserves old installations and historical rate,
booking and receipt snapshots. Selection is immutable; no general mode-switch API is
introduced. Do not recreate installations/references to erase deduplication history.
For this manual-only path no switch is needed when carrier access disappears.

Old binaries do not enforce `file_import:false`. A rollback must retain this enforcement
or disable carrier import/rate write routes before restoring older code. Retain the
column/history; repair schema forward. The rest of the local application can continue.

Before real use the maintainer verifies the human carrier agreement/branch and assigns
the duty admin. This is operational onboarding, not missing API qualification. Future
live access requires official permission, a documented bounded interface and legitimate
test success. Add it through #53/#58 with its own health/retry/cursor/webhook gates,
preserving identities/history. No scraping or unofficial endpoint substitution.
Future actual courier costs (#147), negotiated rates (#141), M7 security/load audits
and pilot release approval are not implemented by #60.
