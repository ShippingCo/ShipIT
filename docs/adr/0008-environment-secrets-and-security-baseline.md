# ADR 0008: Environment, secrets and security baseline

Status: proposed for acceptance through the Issue #6 PR.
Date: 2026-09-08. Owner: #6 / security.

[Architecture](../architecture/README.md) · [Configuration](../architecture/configuration-contract.md) · [Threat model](../architecture/security-threat-model.md) · [Verification](../architecture/security-verification.md)

## Context

The accepted architecture keeps business authority in a Fastify server, stores facts in
PostgreSQL, and sends provider work through a worker. The domain contract requires explicit
organization and franchise access. The API contract requires safe errors, current
authorization on replay, and reference-only events. Those boundaries need one security
contract before authentication, storage, messaging, and deployment are implemented.

This ADR is a documentary contract. It does not claim that authentication, a secret store,
webhook verification, tenant-scoped SQL, or production infrastructure exists today.

## Decision

- Developer, demo, staging, and production use separate database, messaging, and storage
  identities. Demo accepts fictional data and fake providers only. It has no production access.
- Every `VITE_` value is public. Browser values contain presentation configuration only.
  Database credentials, signing material, OTP secrets, provider credentials, and storage
  credentials are server-only managed-secret references.
- The future API validates all configuration once at startup. A missing, malformed, or
  environment-inconsistent value stops startup. Application modules receive typed config and
  do not read environment variables directly.
- Production obtains secrets at runtime from a managed store with least-privilege workload
  identity. CI uses short-lived identity federation where the chosen platform supports it.
  The deployment issue selects the vendor; this ADR does not.
- Secret rotation supports old/new overlap, a small canary, verification, rollback, disabling
  the old version, observation, revocation, and later destruction. A suspected leak starts
  with revocation; deleting a value from Git is not remediation.
- The threat register maps every in-scope threat to prevention, detection, a synthetic or
  future integration test, an owner issue, residual risk, and a release-blocker decision.
- Logs and events exclude credentials, session material, OTPs/verifiers, full addresses, raw
  provider payloads, attachment bodies, and signing keys. Safe identifiers and controlled
  reason codes support investigation.
- Security reports use the private channel in `SECURITY.md`. Public issues must not contain
  exploit details, credentials, OTPs, or customer data.

## Consequences

Issues #9, #11, #13, #15, #31, #36, #42, #68, #72, and #73 receive explicit implementation
and verification gates. Provider and cloud choices stay open. Release is blocked when a
required control or test for an exposed path is missing, when environments share identities,
or when prohibited data can enter logs.

The contract is validated with fictional identifiers. Its model cannot prove real isolation,
cryptography, provider signatures, SQL parameterization, or incident response. Downstream
owners must supply those integration and operational tests before their paths handle real data.

