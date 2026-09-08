# Issue 6 verification

[Configuration](configuration-contract.md) · [Threat model](security-threat-model.md) · [Fixture](fixtures/security-contract.json)

## Acceptance map

- The configuration matrix separates public, server-only, and managed-secret references.
- Developer, demo, staging, and production use distinct fictional identities; demo cannot reach
  production database, messaging, or storage.
- T01–T10 each name a STRIDE class, control, detection, test, downstream owner, residual risk,
  and release-blocker decision in the machine-readable fixture.
- Rotation covers overlap, canary, verification, rollback, disable, revocation, and destruction.
- The prohibited-log list explicitly covers OTPs, full addresses, credentials, signing material,
  raw provider payloads, and attachments.
- `SECURITY.md` provides a private reporting route and the artifacts claim contracts only.

## Tabletop results

- **Foreign franchise request:** a valid A1 operator supplies B1 or A2 identifiers. The API
  ignores claimed tenant authority, resolves membership, scopes the query, returns uniform 404,
  and writes a safe denied-access audit without customer fields.
- **Forged webhook:** signature verification uses the exact raw bytes before business parsing.
  An invalid signature has no database/outbox effect and emits only a controlled failure signal.
- **Replayed webhook:** a fresh valid duplicate races two requests. Atomic provider-event
  deduplication permits one effect. The other is recorded as a safe duplicate outcome.
- **Fake leaked WhatsApp token:** the incident owner revokes it, pauses unsafe sends, canaries a
  replacement, investigates safe audit records, removes exposure, and adds prevention evidence.

## Automated evidence

Run `pnpm check:planning`. `scripts/validate_security_contract.py` parses the fixture with
duplicate-key rejection, checks document/fixture agreement, and runs negative controls for
shared environment identities, production-connected demo, browser secrets, missing threat
evidence, incomplete redaction, and unsafe rotation/incident steps.

This validation is a bounded synthetic model. It does not prove deployed access policies,
cryptography, database isolation, provider behavior, or response speed. The owner issues in
the threat register must add integration and operational evidence before release.

