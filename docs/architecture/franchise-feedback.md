# Franchise staff feedback verification (#186)

Inspected main `ea74131` and related open/closed issues before implementation.
The named `ShipIT-Feedback.txt` was not available in the checkout; the user's full
15-item transcription is the scope. Production (`operations/`, `booking/`) and the
explicit fictional demo (`pages/business/`) have different implementations. A demo
observation is not evidence of the same production defect.

## Findings and changes

| Feedback | Verified outcome |
| --- | --- |
| 1. Booked today | Demo card incorrectly opened booking entry. It now opens today's package list. Production workspace adds the equivalent scoped link using the existing parcel read API. This lists parcels from bookings confirmed today; it is not a new franchise-wide booking count. |
| 2. Delivered actions | Demo lot selector was unconditional; hide it for delivered/RTO parcels and guard the demo mutation/bulk action. Production lot service already rejects terminal entry even for dispatchers (`lots/validation.ts:stateGuard`). Paid demo parcels already hide Record payment. Production has no mark-paid shortcut: receipt allocation checks current payment versions and outstanding balance. |
| 3. Payment at delivery | Delivery already leaves outstanding debt untouched, tested in `database/deliveries.test.ts`. Add a visible route from Deliveries to existing Money receipts for authorized staff and to agent handovers/statements for agents. Receipt recording now requires explicit actual-collection confirmation; demo payment also asks confirmation. No delivery command records payment. |
| 4. Return position | Packages retain their loaded list while detail selection uses URL history. Close or browser Back returns focus and ancestor/window scroll position. Lot detail close does the same. Memory-only positions disappear on scope remount; cross-page reloads are not a persistent list cache. |
| 5. Week | Demo chart labelled This week was a rolling seven days. Use Monday–Sunday calendar columns in Asia/Kolkata, matching owner-summary Monday weeks; highlight today independently. Operational report presets run Monday through today. |
| 6. Recent bookings | Keep: the latest records across days remain useful when today is empty. Explain this beside the demo heading. Production uses bounded operational cards and the separately captured daily sales dashboard; neither has a redundant recent-bookings widget. |
| 7. Queued messages | Production has durable producer/outbox jobs, policy activation, outbound leasing/provider calls, signed callback ingestion and uncertain-outcome recovery. Demo queue has no provider. No live deployment or provider account was supplied, so the reason for an individual real queued message is unverified. See setup below. No state is relabelled as sent. Demo booking toast now says demo message queued. |
| 8. Multiple packages | Backend already accepts 1–50 ordered parcels, verifies summed weight against pricing and creates dockets/obligation atomically. The independent counter PR exposes add/edit/remove, summed pricing and immutable retry. Each parcel retains independent lot/delivery lifecycle; one booking owns charges/payment. |
| 9. Accidental confirmation | Shared segmented choices lacked type=button. Counter PR fixes that. Production and demo booking entry require activation of Save booking, including keyboard activation on that button. Enter elsewhere does not confirm. |
| 10. Cancellation | Existing Financial approvals supports requests and admin-reviewed whole-booking charge cancellation; it does not cancel physical movement or record a refund. Package detail links to that existing workflow with the booking reference and explains the limitation. No individual-parcel cancellation or new physical cancellation state is introduced. Existing dispatch/RTO guards remain authoritative. |
| 11. Cities | Production persists a destination routing key, not structured origin/destination city fields. Add an exact destination city/routing-key filter over the frozen booking input, with current franchise as origin context. Do not infer city from addresses or expose sibling-franchise records. |
| 12. Lot dates | Add paginated ungrouped package selection with booking-confirmation dates, destination and booked/checked-in status. Server filters precede pagination. The existing mutation rechecks membership, terminal state, destination, role, route lock and versions. Advanced dispatcher movements by ID remain available. |
| 13. Report presets | Today and This week on sales/GST, booking snapshots, delivery performance, accountant register and contribution. Custom date controls remain. Clicking a preset only edits the draft; capture remains explicit and saved evidence stays immutable. Fixed UTC weekly messaging-effectiveness reports retain ADR 0037's distinct analytics contract. |
| 14. Temporary agents | #143/#144 already implement identity-bound temporary access, custody acknowledgements, daily cash/parcel statement evidence, review and corrections. Use the workflow below; no uncertain reinterpretation or new employment/payment policy is added. |
| 15. Daily cash | #138/#140/#145 already implement manual money receipts, expenses, linked cash transfers, physical opening/counts, discrepancy review and append-only closing corrections. Use these existing authorities; do not create a parallel register, bank integration or automatic reconciliation. |

## Dates, filtering and rollout

Operational days use **Asia/Kolkata**, independent of browser/device timezone.
From is local midnight inclusive; Through is next local midnight exclusive. Monday
is the first day of the operational week. Destination keys use the existing pricing
alphabet and 32-character limit. `GET /api/v1/parcels` now accepts
`destination_key=<exact key>` and `ungrouped=true`; all filters bind the opaque
cursor and tenant scope. Changing filters requires a fresh first page.

The optional ungrouped query reads `lot_memberships` using the same composite
organization/franchise/parcel ownership join. Deploy the existing Lots schema and
runtime SELECT grant before using it. Ordinary parcel reads do not acquire this
additional table dependency. No schema migration, financial backfill or new role
is required. Roll back compatible code to remove these controls; existing records
and audit evidence remain unchanged. Release the API filter support before the
new UI. Old filter cursors may be rejected safely; refresh the list.

## Daily staff workflow

1. **Temporary agent:** franchise admin opens Parcel custody, invites the intended
   verified account and manages its franchise delivery-agent access. Dispatcher
   assigns work. Prepare the manifest and have the named agent acknowledge the
   exact parcels. Revoke access when engagement ends; historical evidence remains.
2. **At delivery:** assigned agent completes recipient proof in Deliveries. If money
   was collected, give the operator/admin the actual amount, bill, method, time and
   receiving agent. They use Money receipts to select the customer/current bill,
   receiving account and actual receiver/custodian, allocate actual freight funds,
   check the collection confirmation and confirm the receipt. This manual entry
   is not bank verification. Already settled bills cannot receive another
   allocation; genuine extra funds are explicitly unapplied advances.
3. **End of agent day:** Agent settlements → daily count captures the selected IST
   day, physical cash counted and source evidence for parcels/cash/COD/fees. Submit
   that capture for the existing independent administrator review. Cash handovers
   move custody only after acknowledgement; they never settle the customer again.
   Seller COD and agent fees retain separate ownership. Corrections create linked
   revisions instead of editing an earlier day's evidence.
4. **Shop cash in/out:** Money receipts records actual customer inflows; Expenses
   and cashbook records approved expense/outflow evidence and acknowledged
   transfers between named locations/custodians. Cash counts/closing uses recorded
   opening + attributable inflows − outflows versus an actual physical count.
   Review shortages/excess and approve using current rules; reopening appends a
   reasoned revision. Never invent an opening balance or erase discrepancies.
5. **Cancellation:** open a package → Review whole-booking cancellation, load the
   authorized booking context, propose the remaining whole charge with supporting
   evidence, then have an authorized administrator review/apply it. Refund actual
   returned money separately. Ask dispatch staff to handle physical custody/RTO
   under the existing movement rules. Financial cancellation is not a stop-delivery
   command.

The user confirmed the existing temporary-agent custody, cash handover and daily
statement workflow is the intended scope. No attendance, payroll or wage management
is introduced.

Existing regression evidence was inspected in `apps/api/test/database/`:
`custody.test.ts` covers identity-bound invitation acceptance, franchise-only context,
revocation/reactivation and assignment/custody controls; `deliveries.test.ts` covers
assignment-only proof and foreign/other-agent hiding; `agent-cash-custody.test.ts`
covers participant-only handovers, exact acknowledgement and recovery after revocation;
`agent-parcel-statements.test.ts` covers cutoff-bound parcel evidence;
`agent-statement-review.test.ts` covers own-agent statements, independent review,
versioned corrections and no synthetic money effects. Temporary access activates the
same franchise delivery-agent membership these services authorize; there is no
separate temporary-agent bypass. No additional functional gap was established.

Deployment must already have the released schemas/runtime grants and the explicitly
enabled server flags `CUSTODY_ENABLED`, `AGENT_MONEY_ENABLED`,
`MONEY_RECEIPTS_ENABLED` and `CASHBOOK_ENABLED` for the respective writes. These
default off and reject demo activation. Follow the existing
[financial operations deployment instructions](financial-operations.md), using
independent reviewers and verified accounts; do not broaden roles to work around a
disabled feature. This task did not change a deployment.

These are existing ratified workflows, not new assumptions about temporary wages,
expense categories, opening balances, self-approval or reconciliation. If “temporary
agent daily data” means attendance, shifts or wages beyond these parcel/cash statements,
that remains outside the confirmed scope.

## Queued message setup and diagnosis

Use Automation & Messages to inspect the scoped intent state, reason, attempts and
age. A queue row alone proves neither provider acceptance nor customer delivery.

1. Verify whether the user is in the explicitly fictional demo. Demo `queueMsg`
   only persists a local outbox; it cannot contact WhatsApp. Use the production API
   composition for real sends; never import demo outbox/customer data.
2. Provision/migrate PostgreSQL and the documented application/worker grants.
   Run the API and the separate durable event worker. For development the entry
   points are `pnpm --filter @shippingco/api start` and
   `pnpm --filter @shippingco/api start:worker`. Hosted deployments use the approved
   managed-secret composition; the local CLI is not a hosted production launcher.
3. Configure server-only `AUTH_SECRET_REF` and `WHATSAPP_CONFIG_REF`. Follow
   [installation configuration](whatsapp.md#configuration-and-onboarding): explicitly
   pinned Graph version, registered WABA/phone identity, exact organization/franchise
   binding and `whatsapp:` credential reference. Tokens stay in the secret manager.
   Development-only `local:whatsapp`/`LOCAL_WHATSAPP_JSON` is for an isolated sandbox;
   the CLI does not automatically load `.env`.
4. Configure the signed webhook using [webhook operations](whatsapp-webhooks.md):
   app secret, verification token, approved WABA IDs, distinct encryption/fingerprint
   keys and key version, and the reachable callback. Keep the encryption key for
   pending messages. Install/verify the binding and synchronize the exact approved
   template name/language through the existing installation endpoints.
5. Configure exact `automation.policies` bindings and run the notification consumer.
   [Policy activation](notification-automation.md) is immutable/versioned; it does
   not replay pre-activation historical messages. Missing bindings are blocked,
   not successful sends. Use a new synthetic event after staging activation.
6. Set `outbound_enabled: true` explicitly in the resolved WhatsApp configuration
   only after the above setup. It defaults off and requires webhook configuration.
   The API's `onReady` hook starts the one-intent-per-cycle outbound poller; the
   separate outbox worker alone does not send to the provider.
7. Verify consent and current template capability. Inspect redacted
   `whatsapp_outbound_failed` / `whatsapp_outbound_attention` events, job health,
   retry times and provider availability. Worker calls are bounded; acceptance
   requires a provider message ID, and delivered/read requires a verified callback.
   For uncertain acceptance, reconcile provider evidence through the approved
   [outbound recovery](whatsapp-outbound.md) flow; do not clear reservations or
   create new identities to force a resend.

Remaining external evidence: environment/deployed revision, API and outbox-worker
readiness, non-secret enablement flags, a scoped message ID/state/reason/attempt count,
redacted worker errors, and provider-side acceptance/callback status. A deployment
owner must provision the provider identity, credentials, template approvals and
reachable infrastructure. No production configuration was changed and no real
customer sends were performed during this task. Synthetic tests cannot establish
that a particular deployment is configured or that its live provider works.
