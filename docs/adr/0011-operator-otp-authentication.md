# ADR 0011: Operator authentication with email or WhatsApp codes

Status: proposed for issue #13 review. Live provider setup is deferred to M3.

## Decision

Own the identity and session system. Operators enter an email address or international phone number, then an eight-digit one-time code. Email and direct Meta WhatsApp adapters deliver codes; neither provider owns the user account. Use Node crypto, PostgreSQL transactions and the pinned Fastify cookie plugin. No passwords, managed identity provider, SMS fallback or browser bearer tokens.

Authentication proves control of a previously provisioned, verified contact. It grants no organization/franchise access. #14 owns memberships, #15 scope enforcement, #17 verified enrollment and #18 the real frontend. Existing prototype personas remain fictional. Trusted provisioning and account disable/re-enable are internal service capabilities, not public administration endpoints.

## Security policy

- Eight cryptographically random decimal digits; ten-minute challenge lifetime; five failed guesses; three resends at least 60 seconds apart. Resends preserve the code, original deadline and failure count. These are login challenges, entirely separate from delivery-proof challenges owned by #42.
- Each challenge is bound to signed, HttpOnly browser state and a specific purpose. Codes use keyed HMAC verification; the short-lived delivery copy uses AES-256-GCM with challenge/version AAD. Only the worker decrypts it. Consumption clears the encrypted copy; expiry maintenance clears it in bounded batches.
- Login creates a new 256-bit opaque session secret; only its SHA-256 digest is stored. Previous same-user browser session is revoked. Secure/HttpOnly/SameSite=Strict host-only cookies in hosted modes; local HTTP development uses separately named cookies without Secure.
- Server checks the primary database for active account, matching revocation epoch, idle deadline (30 minutes), absolute deadline (12 hours) and revocation on every identity check. No authorization cache. User-row locks serialize login with account revocation. Future protected writes must compose identity and authorization checks within their owning transaction.
- Mutations require an exact configured Origin and browser-bound CSRF header. SameSite cookies require app/API on the same schemeful site. Bootstrap CSRF tokens are not authentication credentials and remain in browser memory.
- Shared PostgreSQL limits: starts 3/contact/15 minutes; resends 3/contact/15 minutes; verify 10/contact/15 minutes. IP budgets are at least 20 and otherwise five times the contact limit; a 1000/minute per-action global cap bounds attacker-created bucket storage. Production capacity tuning needs measured abuse/load evidence. Trusted proxy interpretation comes from #11, never submitted forwarding headers.
- Unknown/disabled accounts receive indistinguishable challenge response shapes and wrong-code errors; only eligible accounts queue delivery. Do not claim constant network timing. No existence-check endpoint.
- A linked verified alternate contact is the recovery path. Linking/removal/revoke-all need a session authenticated within five minutes. Cannot remove the last contact; removal revokes all sessions/outstanding challenges. Losing all contacts has no automated support bypass. Verified enrollment/account recovery policy beyond alternate contacts remains with onboarding/security owners before public enrollment.

## Delivery and retention

The narrow durable authentication queue is a necessary #13 exception to #35/#39 ordering. Claim commits before network I/O; a claim older than one minute becomes uncertain. Never blindly retry ambiguous provider sends. Explicit resend is bounded and uses the same still-valid code. Provider acceptance is not proof of delivery and never authenticates a user. #13 webhook only verifies/acknowledges callbacks; M3 owns operational delivery-status processing.

Maintenance clears expired encrypted payloads, removes challenge/contact-bearing queue history after one day, then expired sessions after one day; bounded batches run approximately once per minute while worker is healthy. Monitor backlog before live rollout. Minimal append-only security facts contain internal IDs/action/time, no contact or code. #16/#72 own approved audit retention/access/holds; no arbitrary audit deletion is introduced here.

Keys are environment-specific, independently generated 32-byte verifier/encryption/browser keys and a version in one secret-manager document. Rotation requires coordinated instances, not mixed versions: stop new issuance, drain/expire challenges, deploy a new version, restart browser flows. Emergency compromise invalidates outstanding flows immediately and increments affected/all account epochs; never restore compromised keys. Existing session digests need no encryption key. Provider rotation follows ADR 0008.

## Limits and release gates

OTP is not phishing-resistant MFA. Email and WhatsApp are alternative single-factor paths. A compromised mailbox/WhatsApp account can compromise login; high-assurance step-up remains a later explicit design decision. No production access until memberships, scope enforcement, live delivery verification and managed deployment secrets are ready.

The owner deferred live Meta/email credentials, domain setup and real-message testing to milestone 3. Issue #13 tests use injected synthetic senders; simulated success must never be presented as real delivery. Authentication routes remain absent unless AUTH_SECRET_REF is configured. No provider-free production fallback.

## References

- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Meta authentication template](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Auth API and operations](../architecture/operator-authentication.md)
