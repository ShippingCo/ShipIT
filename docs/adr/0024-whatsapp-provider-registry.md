# ADR 0024: Scoped WhatsApp installations and template registry

Status: implemented for issue #36 review. Date: 2026-09-20.

## Context and scope

Issue #35 merged as PR #119 (`89b6559`). Its durable database-effect worker deliberately
has no business consumer or provider send. The recovered #35 conversation corrected its
historical reference from #27 to #28 and emphasized live grants, immutable evidence,
additive schema, real PostgreSQL races and honest reporting of failure drills. These
lessons apply here. #27's frozen manifests and #28's event producers remain unchanged.

#36 owns configuration and provider contracts. #37 owns signed operational callbacks,
#38 consent/window/purpose checks, #39 durable outbound attempts and reconciliation.
The existing #13 authentication transport remains separately owned. No customer send
HTTP route, business subscription, broadcast or automatic template creation is added.

## Decision

Use direct Meta Cloud API through native fetch, behind a server-only application port.
No SDK, broker, ORM or framework is introduced. Runtime resolves a configuration catalog
through the existing SecretResolver. Each immutable catalog alias binds one organization,
franchise, WABA, phone-number ID and versioned credential reference. A browser can select
only an alias registered for its authorized franchise; it cannot submit IDs, tokens,
secret references, endpoints or an approval assertion. Catalog provisioning requires an
operator with deployment/secret-manager authority. Token access alone is not tenant proof.

R29 supplies safe reads. W45 explicitly assigns connect/rotate/disable/sync to the existing
franchise_admin role. Organization administrators get R29 reads through an explicitly
selected own-organization franchise, without implicit writes. This is a matrix amendment
for review, not an invented integration-admin role.

One installation per franchise and a globally unique phone-number ID make future inbound
resolution unambiguous. The phone/WABA/owner tuple cannot be reassigned by an API command.
Changing it requires a separately reviewed migration. Validate WABA phone membership,
VERIFIED status and CLOUD_API platform with Meta before connect or rotation. This is
credential/identity validation, not a promise of deliverability or a completed provider
onboarding. Disabled installations retain their identity reservation.

Commands use two short authorized transactions separated by bounded provider reads.
The first verifies live authorization, expected version and replay. The second repeats
authorization/root checks and expected version, then atomically saves state, command
receipt and canonical audit. Franchise-row locking serializes same-owner writers and
protects empty-installation creation. Foreign selectors fail before secret resolution.
The durable receipt resolves a lost COMMIT response; repeating a provider GET before
a command commits is harmless. Provider POST is never part of these transactions.

Templates are exact-name/exact-language append-only local revisions. Only provider
responses supply approval/category. Local revision is not a Meta version identifier.
Store content hash and positional variable types, not message text or examples. This
first adapter supports utility templates with positional BODY text variables and optional
static text header/footer. Named parameters, media, buttons and other categories report
unavailable. Text variables must be strings; no implicit numeric coercion. Missing or
deleted language is recorded as MISSING, invalidating an earlier approved revision.
Rotation increments credential revision and invalidates prior template checks. A local
15-minute freshness bound is a conservative product rule, not a Meta policy guarantee.
The future sender must recheck current installation, exact template shape and policy;
the capability endpoint is advisory and never a send authorization token.

The provider port sends at most once per call. It normalizes acceptance, configuration
failure, explicit HTTP rate rejection, permanent rejection and uncertain acceptance.
There is no automatic resend on timeout, 5xx or malformed acceptance. Acceptance does
not mean delivery. The send port has synthetic contract tests but is not wired to a
runtime sender until #38/#39. No unsupported exactly-once claim is made.

## Research and alternatives

- [Meta's official Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
  supplies request shapes and bearer-token boundaries. The older official management
  collection points to this collection. The deployed Graph API version is explicit;
  verify its supported lifecycle and permissions during staging onboarding.
- [Meta's template examples](https://www.postman.com/meta/whatsapp-business-platform/documentation/3kru5r6/moved-whatsapp-business-management-api)
  demonstrate name, language, category, status and components. Old examples and category
  names are not used as current pricing or policy authority. Some direct developer-doc
  pages were inaccessible during research; live permission/access qualification remains
  an external verification requirement rather than an inferred success.
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/), checked
  2026-09-20: opt-in and opt-out must be respected; initiating contact and contacting
  outside the 24-hour service window require approved templates. Approval can change.
  This registry grants no consent or pricing exception; #38 owns the policy evaluator.
- [AWS: timeouts, retries and backoff](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
  supports deadlines and avoiding layered retries. Use a five-second request deadline,
  bounded response bytes and bounded pagination; leave business retry scheduling to #39.
- [Stripe: idempotency](https://stripe.com/blog/idempotency) and
  [AWS: making retries safe](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  motivate stable logical command identity and durable original results. Their provider
  guarantees are not assumed to exist for Meta sends.

A BSP-specific SDK would add dependency and vendor behavior without evidence that this
repository needs it. A generic template renderer would hide unsupported component semantics.
Unrestricted secret-reference input would let an authorized local admin probe another
tenant's credential. Long transactions around provider calls would hold shared authority
locks during outages. The selected design avoids those costs with a small explicit port.

## Compatibility and verification

Migration 23 adds three tables, ownership constraints, immutable template/command evidence,
revision guards and a safe audit union. No released migration or domain event changes.
Omitting WHATSAPP_CONFIG_REF leaves these routes absent; old code remains compatible
with the additive schema. Apply schema and documented grants before enabling configuration.
Rollback compatible code/configuration; repair applied schema forward.

See [operations](../architecture/whatsapp.md) and [verification](../architecture/issue-36-verification.md).
