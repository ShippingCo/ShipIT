# Issue 10 dependency review

Reviewed 2026-09-08 before installation. These dependencies implement the already
selected `pg` / raw SQL / `node-pg-migrate` architecture. This review covers registry
metadata, published migration-runner source, compatibility and known advisories;
the issue verification document records the final installed lockfile and test results.

## Exact package selection

| Package | Exact version / registry publication UTC | Compatibility and supply-chain evidence |
| --- | --- | --- |
| [`pg`](https://registry.npmjs.org/pg/8.23.0) | `8.23.0` / `2026-08-08T19:27:05.108Z` | Node `>=16.0.0`; MIT; published and maintained by `brianc`; ESM import and CommonJS require exports. |
| [`node-pg-migrate`](https://registry.npmjs.org/node-pg-migrate/9.0.0) | `9.0.0` / `2026-07-17T08:50:59.857Z` | Node `>=20.11.0`; MIT; ESM with bundled TypeScript declarations; GitHub Actions trusted publishing; registry maintainers `shinigami92`, `salsita-npm`, `theo`. |
| [`@types/pg`](https://registry.npmjs.org/@types%2Fpg/8.23.1) | `8.23.1` / `2026-08-17T20:10:18.296Z` | MIT; DefinitelyTyped publisher/maintainer `types`; ESM and CommonJS declaration exports for pg 8. |

These were the latest stable registry versions at review time; migrate's
`10.0.0-alpha.2` was a prerelease and was not selected. The
[node-postgres repository](https://github.com/brianc/node-postgres),
[migration repository](https://github.com/salsita/node-pg-migrate) and
[DefinitelyTyped repository](https://github.com/DefinitelyTyped/DefinitelyTyped)
were active, enabled and unarchived. Their last pushes observed through the GitHub
API were September 2, September 8 and September 8 respectively. This establishes
current maintenance evidence, not a guarantee of future maintenance.

The existing catalog remains TypeScript `5.9.3` and `@types/node` `20.19.43`.
`@types/pg` accepts any Node type version; the catalog override resolves that edge
to `20.19.43` and `undici-types` `6.21.0`. The runtime remains Node `22.23.2`;
the older Node declarations are the repository's existing compile-time baseline.
Actual TypeScript compatibility is verified by workspace typechecking.

Use `import { Pool, Client } from 'pg'` and
`import { runner } from 'node-pg-migrate'` in the ESM DB workspace. The migration
runner loads TypeScript through its existing `jiti` dependency; no separate runtime
loader or ORM is required. See [pg ESM support](https://node-postgres.com/features/esm)
and the [v9 release](https://github.com/salsita/node-pg-migrate/releases/tag/v9.0.0).

## Transitive and advisory review

Recursively resolved ordinary and optional dependencies using registry version
ranges and the existing Node types override. The candidate graph contains 39 exact
package versions, including the three selected packages and existing Node types;
this is not a claim that all 39 are new lockfile entries. Key resolutions are
`glob@13.0.6`, `jiti@2.7.0`, `yargs@18.0.0`, `pg-pool@3.14.0`,
`pg-protocol@1.16.0`, `pg-connection-string@2.14.0`, `pg-types@2.2.0`,
`pgpass@1.0.5` and optional `pg-cloudflare@1.4.0`.

Every declared engine range accepts Node `22.23.2`, including yargs/parser's
`^20.19.0 || ^22.12.0 || >=23`. None of the 39 versions was marked deprecated or
declared a `preinstall`, `install` or `postinstall` script. Some upstream packages
declare maintainer build/publish scripts; those are distinct from registry install
hooks. `pg-native` is an optional peer and is not selected; no native PostgreSQL
client build is required. Preserve the repository's `--ignore-scripts` install policy.

An exact-version request to the
[npm advisory bulk endpoint](https://registry.npmjs.org/-/npm/v1/security/advisories/bulk)
returned HTTP 200 and `{}` on 2026-09-08: no matching known advisories for this
candidate graph. This is a point-in-time advisory result, not a full source audit.
Run `pnpm audit --json` against the installed lockfile as part of final verification.

The installed lockfile adds 33 package versions and removes none. Existing shared
versions remain fixed; the new migrate dependency makes pnpm resolve ESLint's optional
`jiti` peer to 2.7.0 while retaining 1.21.7 for the existing frontend tooling. ESLint's
version is unchanged. `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm audit`
both passed against that lockfile; audit reported no known vulnerabilities.

## PostgreSQL image

Selected official image, verified against its registry manifest:

```text
postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af
```

This is the multiarchitecture OCI index digest, with both Linux amd64 and arm64
manifests. The [official image listing](https://github.com/docker-library/official-images/blob/master/library/postgres)
maps `18.6-bookworm` to Dockerfile commit
`e00e1bd34ec5c8a8e7ad89b273b3d42efaf6d5bc`. PostgreSQL's
[version policy](https://www.postgresql.org/support/versioning/) identifies `18.6`
as the current stable minor and supports major 18 through November 14, 2030.
The image's database version is not an image-wide operating-system vulnerability scan.
PostgreSQL 18 image storage uses `/var/lib/postgresql`; disposable tests need no
persistent production volume. See the [official image documentation](https://hub.docker.com/_/postgres).

## Pinned migration-runner behavior

Reviewed the published v9 tarball and matching
[runner](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts),
[DB adapter](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/db.ts) and
[migration implementation](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/migration.ts).
Set `singleTransaction: true`, `checkOrder: true`, `noLock: false` and
`advisoryLockMode: 'fail'` explicitly. Native session advisory lock
`7241865325823964` is acquired before schema/tracking initialization; contention
fails immediately. An already-current database returns an empty migration array.

Inject a silent logger and emit only application-owned sanitized results: upstream
error logging can include SQL, database error details and connection errors.
Externally supplied clients remain caller-owned, so the wrapper must always await
their closure, including failure and no-op paths. Recognize the pinned contention
message only for safe error classification; do not forward arbitrary upstream text.

Do not use v9 `dryRun` as a read-only status command: it can still initialize migration
tracking. Current online documentation follows a newer alpha and describes different
dry-run behavior. The installed v9 source governs this implementation.
