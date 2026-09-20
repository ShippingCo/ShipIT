# WhatsApp installation and template operations

[ADR 0024](../adr/0024-whatsapp-provider-registry.md) · [Verification](issue-36-verification.md)

## Configuration and onboarding

Create the Meta business portfolio, WABA and registered Cloud API phone identity using
the [official onboarding documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).
Complete required account/phone verification, billing, asset assignments and any app review.
Use an appropriately scoped system-user token with `whatsapp_business_management` for
identity/templates and `whatsapp_business_messaging` for the eventual send worker.
Grant `business_management` only when the chosen onboarding flow requires it. Validate
these permissions and the pinned Graph version in staging; no live account was used here.

Store tokens in a secret manager under immutable version references, never in requests,
Git or Vite configuration. Set server-only WHATSAPP_CONFIG_REF to a secret reference
resolving to this catalog shape (all identifiers below are fictional):

```json
{
  "graph_version": "v24.0",
  "bindings": [{
    "key": "alpha_v1",
    "organization_id": "11111111-1111-4111-8111-111111111111",
    "franchise_id": "22222222-2222-4222-8222-222222222222",
    "waba_id": "100001",
    "phone_number_id": "100002",
    "credential_ref": "whatsapp:alpha/v1"
  }]
}
```

`v24.0` is an example explicit pin, not an assertion that it is the latest API version.
Catalog aliases are bounded and unique. A phone ID cannot map to different owners/WABAs.
Only `whatsapp:` credential references are accepted; the resolver maps these application
references to managed secret versions. Runtime rejects a developer-local resolver in
hosted environments. #68 owns managed-identity deployment composition.

Developer CLI only: WHATSAPP_CONFIG_REF=local:whatsapp and LOCAL_WHATSAPP_JSON resolves
`{"configuration":{...},"credentials":{"whatsapp:alpha/v1":"<local sandbox token>"}}`.
Use ignored local environment storage. The CLI does not load .env automatically. Do not
enable this with production accounts or expose this value in logs or a browser.
Demo cannot configure this module. AUTH_SECRET_REF is required when it is enabled.

For rotation, provision a new immutable reference and catalog alias for the same owner,
WABA and phone; deploy the catalog; execute `rotate` with the new alias and current
version. A failed validation leaves the old installation intact. A successful rotation
stores only the new reference and invalidates previous template checks. Revoke the old
token in the provider/secret manager after consumers transition; the API never returns
either token or reference. Disabling retains identity and audit. Removing an alias also
makes capability unavailable; disable still works when configuration has been removed.

## HTTP contract

Every endpoint selects `?organization_id=<uuid>&franchise_id=<uuid>` and requires a live
session. All POSTs enforce origin/browser CSRF. Mutation commands require Idempotency-Key.
One installation per franchise makes list/count pagination unnecessary; GET returns one
masked installation or null. It never returns full phone/WABA IDs, bindings or references.

| Method / path under `/api/v1/whatsapp` | Body / behavior |
| --- | --- |
| GET `/installation` | R29 masked configuration |
| POST `/installations` | W45 `{expected_version:0,binding_key}`; verified connection |
| POST `/installations/:id/rotate` | W45 `{expected_version,binding_key}`; validate replacement; also reconnects disabled identity |
| POST `/installations/:id/disable` | W45 `{expected_version}`; local disable with no provider call |
| POST `/installations/:id/sync` | W45 `{expected_version,name,language}`; read Meta and append exact-language metadata |
| POST `/installations/:id/capability` | R29 `{name,language,variables}`; read-only validation, no persistence of supplied variables |

R29 permits franchise_admin and org_admin's scoped reads. W45 permits franchise_admin
only. Other five roles are denied. A real foreign ID and a random unknown ID both return
RESOURCE_NOT_FOUND. Body ownership fields, provider status and raw token fields are rejected.

Same actor, owner and request key/body returns the original result, including after restart
or a later command. Different intent conflicts. Versions start at one and increment on each
mutation. A version conflict requires refreshing state and a new reviewed intent; an uncertain
response requires retrying the original request/key. Provider GET reads may repeat, state does
not. Permissions/root lifecycle are rechecked even on replay. Commands serialize by franchise,
while Meta I/O occurs between transactions. No provider POST is made by these endpoints.

Errors are closed and omit provider bodies: WHATSAPP_CREDENTIAL_INVALID,
WHATSAPP_PROVIDER_UNAVAILABLE, WHATSAPP_IDENTITY_MISMATCH, WHATSAPP_CONFIGURATION_CHANGED,
WHATSAPP_INSTALLATION_DISABLED, plus shared validation/version/idempotency errors.
Capability gives `available`, an actionable `reason`, current safe template metadata and
`customer_sends_enabled:false`. Reasons include installation_disabled,
installation_configuration_changed, owner_disabled, template_language_missing, template_not_approved,
template_shape_unavailable, template_category_unavailable, template_validation_stale and
template_variables_invalid. Correct the named condition and resynchronize; no language fallback.

## Provider and policy boundary

Provider contract: validate registered WABA/phone; retrieve exact template capability;
send an already authorized application request and return normalized outcome. Send is
currently an unwired port, tested with fictional HTTP responses only. Its caller must be
#39's durable post-commit worker after #38's consent/window evaluation and current installation/
template recheck. The #35 receipt protocol cannot make an external HTTP side effect atomic.

Only utility BODY text parameters are supported. Static text header/footer are allowed;
media, buttons, named parameters, authentication and marketing templates are explicitly
unavailable. Template schema uses typed `text` parameters, at most 20, each a nonempty
string of at most 1024 UTF-16 units without control characters. Wrong type/count blocks
before secrets or HTTP. Local revisions retain only hashes and metadata, never rendered
content or provider examples. Meta's approval is an observation; it can change immediately
after a read. Fifteen-minute freshness is not authorization or a provider guarantee.

Requests use fixed HTTPS graph.facebook.com, Authorization headers, redirect rejection,
five-second per-request deadlines, 256 KiB response limits and at most five pages of 100
items. Pagination rebuilds URLs from bounded cursors. Oversized/truncated/ambiguous data
fails closed. There is no hidden retry. HTTP 429 is an explicit retryable rejection for
the future worker; timeouts, 5xx and malformed acceptance return uncertain. Other 4xx
are controlled failures. An accepted message ID proves acceptance only. No provider rate,
free-message allowance, delivery guarantee or approval is inferred from the demo.

Follow the [current business policy](https://whatsappbusiness.com/policy/), checked
2026-09-20: obtain opt-in, respect opt-out, use approved templates outside the 24-hour
window, and provide escalation for automated replies. #38 must enforce these rules at
send time. Review policy, template categories and live pricing again before launch.

## Database rollout and recovery

Apply `1790614800000-whatsapp-registry.cjs` with the migration identity. Grant the runtime
role (replace the illustrative role with the environment's role):

```sql
GRANT SELECT, INSERT ON shipit.whatsapp_installations,
  shipit.whatsapp_templates, shipit.whatsapp_commands TO shipit_api_runtime;
GRANT UPDATE(binding_key,credential_ref,version,credential_revision,state,validated_at,command_id)
  ON shipit.whatsapp_installations TO shipit_api_runtime;
```

Retain existing membership, audit and franchise grants. Runtime has no DELETE/TRUNCATE,
template mutation or ownership mutation grant. Composite owner FKs protect every nested
reference; unique phone ID protects future callback resolution. Command and template
history is immutable, and a deferred command check requires installation/template effects
to be complete before commit. Canonical audit exposes actor, operation, ID, version and
correlation only. No producer events or business outbox subscriptions change.

No data backfill, production DB access or provider registration call occurs during migration.
Old code can run with the additive schema. Disable configuration to roll back behavior;
retain evidence and repair applied schema forward. Observe safe request codes/duration
and canonical audit; #70 owns hosted alert delivery. Use [verification](issue-36-verification.md)
for repeatable synthetic exercises.
