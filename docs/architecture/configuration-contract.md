# Configuration and secret contract

[ADR 0008](../adr/0008-environment-secrets-and-security-baseline.md) · [Threat model](security-threat-model.md) · [Verification](security-verification.md)

## Environment isolation

| Environment | Allowed data | Database identity | Messaging identity | Storage identity | Production access |
| --- | --- | --- | --- | --- | --- |
| developer | Synthetic only | db_developer | msg_fake_developer | storage_developer | Denied |
| demo | Synthetic only | db_demo | msg_fake_demo | storage_demo | Denied |
| staging | Synthetic or approved test data | db_staging | msg_test_staging | storage_staging | Denied |
| production | Approved production data | db_production | msg_production | storage_production | Allowed only to production workloads |

These identities, databases, provider installations, buckets, encryption scopes, and audit
streams remain separate. Copying a production credential into demo or staging is a release
blocker. Production records must not be copied into lower environments.

## Configuration classes

| Class | May reach browser | Examples | Source |
| --- | --- | --- | --- |
| Browser public | Yes | `VITE_API_BASE_URL`, `VITE_APP_VERSION` | Build/deployment configuration |
| Server config | No | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `ALLOWED_ORIGINS`, `TRUSTED_PROXY_HOPS` | Runtime configuration |
| Secret reference | No | `DATABASE_SECRET_REF`, `SESSION_SIGNING_KEY_REF`, `OTP_PEPPER_REF`, `WHATSAPP_ACCESS_TOKEN_REF`, `WHATSAPP_APP_SECRET_REF`, `WHATSAPP_VERIFY_TOKEN_REF`, `STORAGE_CREDENTIAL_REF`, `CARRIER_CREDENTIAL_REF` | Managed secret store reference |

`VITE_` means public because Vite can place the value in browser code. A browser-public value
must never contain a credential, private endpoint with embedded authentication, customer data,
or authorization policy. Shared packages may contain public DTOs and pure rules only.

## Startup and ownership

Issue #11 owns one future server configuration module, planned as `apps/api/src/env.ts`. It
will parse the process environment once, return immutable typed configuration, reject unknown
deployment modes, and stop startup on invalid input. Feature modules receive only the values
they need. Tests may inject a complete synthetic configuration object.

Issue #10 supplies the server-only `@shippingco/db` configuration boundary. Its caller
injects an explicit resolved PostgreSQL credential, deployment mode and TLS policy;
the library does not resolve `DATABASE_SECRET_REF` or read application environment
variables. Host, database, username and nonempty password are required. URL query
strings/fragments cannot override configuration. Driver fields are explicit, so ambient
`PG*` settings cannot replace authentication, TLS, timeouts, search path or replication
mode. Staging/production require verified TLS; an optional trusted PEM CA is injected
through typed configuration. See the [DB operating reference](../../packages/db/README.md)
for bounded pool settings and shutdown behavior.

The separate operator migration command consumes `SHIPIT_ENVIRONMENT`,
`MIGRATION_DATABASE_URL`, `DATABASE_TLS_MODE` and optional `DATABASE_CA_FILE`. The
migration URL is a resolved secret supplied by the operator's secret mechanism, never
a browser-public variable or command-line argument. It has no runtime/test URL
fallback. The migration identity owns schema changes; the runtime identity is a
non-owner with minimum required grants. #68 provisions deployment identities and
network isolation; #11 wires runtime secret resolution and lifecycle.

The example file contains names and empty values only. Local `.env` files stay ignored.
Production uses version-pinned managed references and workload identity. Secret values do not
belong in source, images, command arguments, CI output, deployment manifests, tickets, or chat.

The application owner for each secret is the downstream issue named in the synthetic fixture.
The deployment owner (#68) controls runtime access, and the security owner (#73) controls
scanning, audit, and incident drills. During an incident, the service owner revokes the
credential while the repository security administrator coordinates the private report,
evidence, recovery, and follow-up. Named on-call people and escalation times belong to the
deployment runbook before production launch.

## Rotation and failed rollout

Every credential owner documents this order:

1. Create a new version with no wider privilege.
2. Allow an old/new overlap window when the provider supports it.
3. Send a small canary workload through the new version.
4. Verify authentication, business result, audit signal, and error rate.
5. Roll out gradually.
6. Disable the old version and observe.
7. Revoke the old version, then destroy it after the recovery window.

If verification fails, stop rollout, route traffic back to the still-valid old version,
investigate without logging either value, and retry with a new version. A compromised version
is never restored; revoke it immediately and use the provider's recovery process.

## Exposure response

For the synthetic leaked WhatsApp credential drill: privately alert the incident owner;
revoke the exposed provider token; pause affected sends if safe identity cannot be proved;
issue and canary a replacement; inspect access/audit/provider delivery records using safe IDs;
remove the value from every reachable source and history where appropriate; notify affected
owners; and add a control that would have prevented or detected the leak. Rotation alone does
not finish the incident.

## Engineering basis

This contract follows [Google Secret Manager best practices](https://docs.cloud.google.com/secret-manager/docs/best-practices)
for environment separation, least privilege, runtime access, version pinning, and auditing;
[Google's rotation guidance](https://docs.cloud.google.com/secret-manager/docs/rotation-recommendations)
for gradual rollout, rollback, disable-before-destroy, and repeatable rotation; and
[GitHub's OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers)
for short-lived deployment identity. The selected deployment platform must demonstrate
equivalent controls; these links do not select a vendor.

## Dedicated test process configuration — Issues #9–#10

The [testing contract](testing-contract.md#fail-closed-database-configuration) adds test-only
`NODE_ENV=test`, `TEST_DATABASE_URL` and `TEST_DATABASE_IDENTITY` (`db_test` or worker suffix).
This is isolated disposable test infrastructure, separate from the four application modes
and identities above. No application `DATABASE_SECRET_REF`/`DATABASE_URL` fallback is permitted.
A pure guard requires a test name, approved host and test identity, with production/staging
host/identity denials taking precedence. #10's active runner uses a trusted static policy
for localhost/loopback and the reviewed `postgres` service hostname; no host is inferred
from the URL. Bootstrap credentials provision exact registered disposable databases
and separate generated migration/runtime roles. Guards also cover connection, fixture
setup, migration and exact cleanup. Credentials are absent from resource registries;
cleanup failures fail the run. There is no broad database-name deletion.

`pnpm db:local test:db` provisions the pinned disposable PostgreSQL service with generated
credentials and a random loopback port, then removes its owned container and volumes.
The full `quality` command requires DB tests, while `test:web` remains independent.
#68 maintains production inventory/network separation; a syntactically allowed hostname
alone cannot prove DNS destination or authorize access to a deployment database.
Never log the URL, resolved configuration, raw SQL error or generated credential.
