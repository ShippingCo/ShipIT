# Operator authentication API — issue #13

[Decision and limits](../adr/0011-operator-otp-authentication.md)

## In plain language

The API checks who an operator is. It sends a code through the selected delivery adapter, checks that code once, and stores the login in PostgreSQL. Logging out cancels that login immediately. A logged-in person still needs separately checked membership before accessing any courier data.

Live WhatsApp and email setup is deferred to milestone 3 at the project owner's request. No Meta token, phone number or email domain is needed to run automated tests. No public sign-up, default administrator, password reset, production persona switch or staff code-reveal endpoint exists.

## Browser contract

Use `credentials: 'include'` on requests. First GET `/auth/bootstrap`; keep `csrf_token` in memory. The server sets the browser binding cookie. Send `X-CSRF-Token` and JSON on mutations, from an allowed Origin. The browser-state cookie lasts ten minutes: refresh bootstrap when it expires and start a new code challenge if necessary. Never put session cookies or codes in localStorage, URLs, analytics or logs.

| Method and path | JSON input | Successful output |
| --- | --- | --- |
| GET /auth/bootstrap | none | `{csrf_token}` plus HttpOnly binding cookie |
| POST /auth/challenges | `{channel: "email" or "whatsapp", address}` | `{challenge_id, expires_in:600, resend_after:60}` |
| POST /auth/challenges/resend | `{challenge_id}` | `{resend_after:60}` |
| POST /auth/challenges/verify | `{challenge_id, code}`; code is an 8-digit string | `{authenticated:true}`; login sets fresh session cookie; contact proof only links contact |
| GET /auth/session | none | `{user_id, expires_at, idle_expires_at}`; no session secret |
| POST /auth/activity | `{}` | `{ok:true}`; extends idle deadline, never absolute deadline |
| POST /auth/logout | `{}` | `{ok:true}`; revokes current session and clears cookie |
| POST /auth/logout-all | `{}` | `{ok:true}`; recent login required, revokes every session/code |
| GET /auth/contacts | none | `{contacts:[{id,channel,address}]}` for this user only |
| POST /auth/contacts | `{channel,address}` | challenge response; recent login and new contact OTP required |
| POST /auth/contacts/remove | `{id}` | `{ok:true}`; recent login, own contact, at least one contact remains; revokes all sessions |

All auth responses are `Cache-Control: no-store`. Errors use the existing safe envelope with correlation ID: 401 unauthenticated/invalid code, 403 invalid origin/CSRF/recent proof/forbidden contact change, 422 malformed fields, 429 shared rate budget exhausted, 503 database dependency unavailable. Unknown or disabled account requests have the same challenge response as known accounts. The UI should say “If this contact can sign in, a code will arrive.” Do not infer delivery from HTTP 200.

Addresses: email is bounded ASCII and case-insensitive by this product's policy; no dot/plus alias rewriting. Phone input must include the country code in E.164 syntax. Syntax validation does not prove a number exists; successful OTP proves control. Contacts are never automatically merged between accounts.

The same verification endpoint completes contact linking, but link challenges are bound to the initiating session and cannot become login challenges. Verify a second contact before relying on it for recovery. If both contacts are lost, no self-service recovery bypass exists.

## Runtime and secrets

Apply migrations first using the existing migration-owner command. Give the runtime non-owner USAGE on shipit; SELECT/INSERT/UPDATE on auth_users; SELECT/INSERT/DELETE on auth_identifiers; SELECT/INSERT/UPDATE/DELETE on auth_sessions, auth_challenges, auth_delivery_jobs and auth_rate_limits; INSERT only on auth_security_events. No membership/tenancy grants are implied. Keep maintenance privileges with the narrowly scoped auth workload. Test harness grants are separate synthetic roles.

Set `AUTH_SECRET_REF` to a managed secret reference. Local development alone accepts `local:auth` resolved from ignored `LOCAL_AUTH_JSON`. The CLI does not load `.env` automatically; use the existing environment injection mechanism or Node's `--env-file` with an ignored file. Nothing prefixed `VITE_` may contain these values.

Secret JSON shape (placeholders are deliberately invalid; generate independent keys):

```json
{
  "keys": {
    "version": "v1",
    "verifier": "64 lowercase hex characters",
    "encryption": "64 different lowercase hex characters",
    "browser": "64 other lowercase hex characters"
  },
  "testRecipients": []
}
```

This local configuration enables the API without sending messages. Unconfigured delivery fails closed; tests inject an in-memory sender and inspect synthetic messages without exposing a debug API. Hosted enabled auth requires both provider configurations. A missing AUTH_SECRET_REF leaves auth routes unregistered and private business routes still unexposed.

## M3 handoff — live setup intentionally deferred

Add `whatsapp: {token, phoneNumberId, apiVersion, template, language}` to the server secret. Use an approved authentication template with Copy Code; configured version must be one supported by the actual Meta account at rollout. Add `email: {apiKey, from}` for Resend or replace the SendCode adapter deliberately. Production email needs a verified sending domain; Resend's test sender only reaches the account's own email. Local live testing additionally requires an exact normalized testRecipients allowlist, at most ten contacts. Keep lower-environment and production provider accounts/keys separate.

Optional `webhook: {verifyToken, appSecret}` enables GET/POST `/auth/whatsapp/webhook`. The public HTTPS URL is deployment-specific. GET echoes Meta's numeric challenge only after matching verifyToken. POST requires the exact raw-body HMAC signature. It acknowledges validated receipts without persisting provider payloads or processing business messages; M3 adds status reconciliation/observability. It never treats a delivery/read receipt as a successful login.

M3 must verify account/app readiness, approved template, actual test recipient, credential permissions/rotation, public HTTPS callback, real delivery and operational monitoring. The full Meta dashboard walkthrough belongs there; no app has been published or configured by this implementation.

## Testing and operations

The only added package is `@fastify/cookie` 11.1.2, pinned with lockfile integrity and installed with lifecycle scripts disabled. Its [official compatibility table](https://github.com/fastify/fastify-cookie#compatibility) supports Fastify 5. Cryptography uses Node crypto; delivery uses bounded fetch without provider SDKs. Run `pnpm audit --prod` when reviewing dependency updates.

Use the pinned toolchain in [quality checks](../QUALITY_CHECKS.md): `pnpm db:local quality` and `pnpm check:migrations`. API tests include crypto tampering, CSRF/cookies, raw webhook signatures and synthetic provider payload/failure behavior. Real PostgreSQL tests exercise concurrent code consumption, wrong-code limits, restart, revocation, linked-contact ownership, HTTP cookie rotation, expiry and queue uncertainty. No tests send actual email/WhatsApp messages.

The test harness supports Windows and POSIX platforms: database reporters use file URLs, synthetic command fixtures run through Node, and Windows shutdown tests use a test-only IPC bridge to invoke the real registered handlers. POSIX runs exercise native signals. Keep run-specific test results in PR evidence, not in the API contract.

The worker commits claims before sending. A crash or ambiguous provider response becomes `uncertain`; there is no blind retry loop. Operator queries may report counts by state and oldest pending creation time, never payload/address/code. Authentication owner investigates failed/uncertain backlog; users may request a bounded resend. `accepted` means provider accepted, not recipient received. Maintenance removes short-lived secrets; verify its backlog and delivery latency before rollout. The minimal audit table is insert-only to runtime and awaits #16/#72 retention/access integration.

Code disable/rollback: remove AUTH_SECRET_REF and redeploy compatible code; keep additive schema. Do not roll back an applied migration. For account compromise use trusted `changeAccount(userId,'disabled')` or epoch revocation via the internal service; a tenant franchise_admin is not a global identity administrator. #14 must supply authorization before any administrative HTTP surface is added.
