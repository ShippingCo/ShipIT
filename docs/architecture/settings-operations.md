# Versioned business settings

Settings records describe organization defaults and permitted franchise overrides.
They do not change membership, move money, approve a close, send a report or activate
a collection deadline. Existing financial services retain their own permissions and
validation. Production settings never import fictional browser/demo data.

## Ownership and inheritance

Organization administrators manage their own organization defaults. Franchise
administrators manage permitted overrides for their own franchises; they cannot edit
organization defaults. Receiving-account, financial-approval-policy and agent-fee
references are franchise settings with the existing financial administration boundary.
Organization administration alone grants no financial mutation or export permission.

Each key displays its effective value and source version. An explicit local value wins
over an organization default. Clearing a local override restores inheritance; clearing
an organization value leaves it unconfigured unless a local override exists. A missing
value does not mean zero, an empty holiday list or an implied working week. A configured
empty list is distinct from a missing value where that key permits it.

Versions take effect when committed by the server. Changes retain actor, reason,
effective/recorded time and the keys changed. Updating an unrelated key does not invent
a new source version for an unchanged value. History is immutable; correction creates
another version. Existing receipts, quotes, bookings, financial evidence and saved
reports retain their original facts.

When an operator explicitly accepts a booking-service or report-scope suggestion,
the new quote or report request carries its `settings_version_id`. The owning service
validates that source against the current effective setting and retains it with the
new snapshot. Older records without this optional provenance remain unchanged; a
settings edit never supplies provenance retroactively.

## Supported configuration

| Key | Meaning and consumer boundary |
| --- | --- |
| Display identity | Operator display preference; it does not rename the legal receipt issuer. |
| Language | Declared `en`/`hi` preference. It does not translate an unsupported UI or override customer/message-language policy. |
| Operating hours | Explicit timezone and weekday intervals; configuration does not start an automated clock. |
| Booking default | A service suggestion for a new draft. It does not change an existing draft, accepted quote or booked price. |
| Collection calendar | Explicit Asia/Kolkata weekdays and holiday dates. Automatic hold expiry/RTO remains unavailable until its separate lifecycle policy is activated. |
| Receiving account | Exact owned account/revision and supported method; no receipt, account verification or transfer is created. |
| Approval policy | Exact owned policy revision accepted by the financial service; no generic self-approval or unsupported monetary threshold is introduced. |
| Agent fee policy | Exact owned agent/term revision; no entitlement, expense or payment is inferred. |
| Close cutoff | Optional explicit timezone/minute intent; it does not auto-close a drawer or change a captured source window. |
| Credit policy, overdue policy, billing terms | Explicitly unconfigured while the account-terms owner is unavailable. No placeholder financial source is fabricated. |
| Report scope | A currently authorized selection for a new report; saved report scope and cutoffs remain unchanged. |
| Reporting schedule | Explicit schedule intent; execution, recipients and sending remain with the scheduling feature. |

The API distinguishes configuration from consumer availability. A stored value may be
unavailable because its owning feature is not active or its exact referenced revision
is no longer eligible. Do not silently substitute a newer account, policy, agent term or
franchise. Refresh and choose valid evidence explicitly. Provider tokens, OTP policy
secrets, deployment flags, GST rules and raw payment evidence are not general settings.

## Save, conflict and recovery

Review the owner and current version before saving. Every update contains a reason,
expected version and stable request identity. Concurrent edits produce a conflict instead
of overwriting another administrator's change. Refresh current evidence and review the
retained draft before submitting a new intent.

After an uncertain response, retry the exact command. Do not create a new request merely
because a response was lost. Completed replay still checks current authority. Disabled
organization/franchise roots and the server write switch block new updates; compatible
historical reads and authorized completed replay remain available. Actual authority loss
clears private browser state.

An unsaved-navigation warning is separate from command recovery: review or discard a draft
deliberately, and reconcile an unresolved command before replacing it. Browser Back/Forward
and query-only report navigation must preserve the user's explicit selection. A recovered
late report must not silently replace another saved snapshot.

## Reporting scope

Options come from current server authority. A selection is bounded to 50 permitted
franchises and must satisfy the owning report's active-franchise rule. A configured scope
never grants access, and unavailable or revoked selections must not be silently expanded.
Sales and contribution retain their existing scope, snapshot and cutoff contracts.
Cash-close reports remain single-franchise/session evidence.

Read permission does not imply export permission. E03 is checked for every saved selected
franchise at download, along with actor ownership and expiry. Changing a default cannot
reinterpret an old report or alter its source versions.

## Rollout and rollback

Apply migration 51 and the narrow runtime grants documented in
[the database guide](../../packages/db/README.md), then separately authorize enabling
`SETTINGS_WRITES_ENABLED=true`. The switch defaults to `false`, accepts only boolean
strings, and is forbidden in demo mode. Merging code does not authorize production
activation or approve a real operating calendar.

Rollback disables new settings writes while retaining applied schema, immutable history
and current-authorized reads/replay. Correct forward; never delete versions or backfill
invented calendar values or historical provenance. Use only synthetic values for local
qualification and inspect the exact release's verification evidence before activation.

The [parcel lifecycle](parcel-lifecycle.md) and
[open decisions](open-decisions.md) retain the separate collection-clock activation
gate. Saving a synthetic calendar during verification does not approve production
weekdays, holidays or exceptional-day rules.
