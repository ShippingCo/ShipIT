# Security threat model

[ADR 0008](../adr/0008-environment-secrets-and-security-baseline.md) · [Configuration](configuration-contract.md) · [Authorization](authorization-contract.md) · [API](api-contract.md)

## Assets and trust boundaries

Protect tenant business records, customer contact/address data, sessions, delivery challenges,
attachments, provider accounts, signing material, database access, audit facts, and message
reputation. Data crosses these boundaries: browser to API, API to PostgreSQL, API transaction
to outbox, worker to provider, provider webhook to API, and staff/CI workload to deployment.
The browser, public network, uploaded bytes, provider callbacks, and user-supplied identifiers
are untrusted. The server decides authorization and business state.

## Required threat controls

| ID | STRIDE | Threat | Required prevention | Detection and verification | Owner | Release blocker |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Elevation | Tenant IDOR reads or changes another franchise | Derive organization/franchise from authenticated membership; scope SQL; never trust body/query tenant IDs; uniform 404 | Cross-org and sibling-franchise integration tests plus safe denied-access audit | #15, #14 | Yes |
| T02 | Spoofing | Forged provider webhook creates trusted work | Verify signature over exact raw body, expected provider/install, timestamp and secret version before parsing business fields | Valid/invalid signature tests and safe verification-failure metric | #36 | Yes |
| T03 | Tampering | A valid webhook is replayed | Enforce bounded freshness; atomically deduplicate provider event identity within tenant/provider scope | Same event concurrently and after restart causes one effect; replay metric | #36, #40 | Yes |
| T04 | Spoofing | OTP is stolen, guessed, replayed, or exposed to staff | Generate securely; store keyed verifier only; short lifetime; attempt/cooldown limits; one-time atomic consume; no staff reveal | Wrong/expired/replayed/concurrent challenge tests and rate-limit audit | #42, #13 | Yes |
| T05 | Tampering | SQL injection changes query meaning | Parameterized SQL values; allowlists for identifiers/order; no user-built SQL fragments; least-privilege DB role | Injection corpus and query-layer review/test | #11, #15 | Yes |
| T06 | Denial of service | Messaging endpoint is abused or loops | Authenticated scoped commands; per-tenant/recipient limits; consent/template policy; durable idempotency; spend and failure circuit breakers | Burst/replay tests, queue-depth and provider-error alerts | #36, #38, #39 | Yes |
| T07 | Spoofing | Session is stolen, fixed, or remains after revocation | Secure HttpOnly same-site cookies; rotate on privilege change; bounded idle/absolute life; server revocation; CSRF/origin controls | Stolen/expired/revoked session and CSRF integration tests | #13 | Yes |
| T08 | Information disclosure | Secret appears in code, logs, CI, build, or browser | Managed references; workload identity; secret scanning/push protection; redaction; `VITE_` classification | Seeded fake-secret test, built-bundle scan, access audit, leak drill | #11, #68, #73 | Yes |
| T09 | Information disclosure | Private upload is public, unsafe, or remains after revocation | Private object identity; authorized reference lookup; type/size/content validation; quarantine; short-lived access; retention deletion | Foreign-tenant, malicious-file, expired-link, deletion and revocation tests | #31, #72 | Yes |
| T10 | Repudiation | Sensitive action cannot be investigated safely | Append-only safe audit facts with actor, tenant, action, target reference, result, correlation and time | Audit completeness/tamper tests; incident tabletop | #13, #15, #73 | Yes |

## Prohibited logs and telemetry

Never record: passwords; access/refresh/provider tokens; cookies; authorization headers; OTPs;
OTP verifiers or peppers; database URLs; signing/private keys; full street addresses; raw provider
payloads; attachment bodies; carrier credentials; or secret-store values. Do not place these in
event payloads, error responses, traces, analytics, snapshots, fixtures, or test failure output.

Logs may contain controlled action/result codes, synthetic or opaque resource IDs, correlation
IDs, actor references, tenant references, secret version references, and redacted provider
delivery IDs when needed. Access to logs is least privilege and retention follows #72.

## Residual risk and change rule

Third-party compromise, authorized insider abuse, new dependency flaws, phone-number takeover,
and denial beyond configured capacity remain possible. Issues #69, #73, and #74 cover recovery,
supply-chain review, and capacity evidence. New external entry points, sensitive assets, roles,
providers, or data flows require a threat-model update in the same reviewed change.

## Engineering basis

The model uses Microsoft's [STRIDE threat-model method](https://www.microsoft.com/en-us/security/blog/2012/08/16/threat-modeling-from-the-front-lines/),
OWASP guidance for [object-level authorization testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References),
[secret management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html),
and [safe logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
Meta's published [Private Processing threat-model approach](https://engineering.fb.com/2025/04/29/security/whatsapp-private-processing-ai-tools/)
supports defining assets and trust boundaries before implementation and requiring independent
security scrutiny. ShipIT adopts that process principle, not Meta's system design.

## Issue 8 policy refinement

[ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md) and the
[policy contract](money-tax-proof-privacy-contract.md) refine T01/T04/T06/T10: tax
configuration/resolution is own-franchise W27/W37; challenge replacement cannot reset
lineage budgets; W40 proof approval requires independent identity, current custody and
protected evidence. No employee retrieval or OTP/verifier telemetry is permitted.
Field-scoped holds cannot become cross-tenant access or indefinite profile retention.
The [Issue #8 planning evidence](issue-8-verification.md) checks synthetic boundaries only;
#14/#15/#21/#31/#42/#72 must verify real authorization, races and cleanup before production.

## Issue #11 HTTP infrastructure boundary

Public entry points now include liveness/readiness and Fastify request parsing. They
expose no tenant records or identity authority. T08 controls are implemented with
field/code-only startup errors, safe public error envelopes, explicit log serializers
and synthetic credential/PII exclusion assertions. JSON syntax, decoded duplicate keys,
UTF-8, nesting, schema and byte limits reject input before test command handlers.
Malformed URL/HTTP parser errors also receive redacted correlated responses.

Exact-origin CORS, explicit trusted proxy addresses plus bounded hops, and the official
per-process rate limiter constrain the boundary. None grants authentication or tenant
scope. Health is rate-exempt; #68/#74 must supply edge/network controls and tune capacity,
including traffic rejected before framework hooks. T05 retains the existing parameterized
DB interface; #11 introduces no domain SQL. T01/T04/T07/T10's real authorization, session,
OTP and audit implementations remain downstream. The developer-only secret resolver
cannot activate in hosted modes; #68 still owns managed-store workload identity.
