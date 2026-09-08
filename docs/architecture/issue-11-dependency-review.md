# Issue #11 dependency review

Reviewed 2026-09-08 before installation using npm version metadata, published README
compatibility tables, GitHub source/release history and OSV version queries.

| Package | Stable version | Published | Purpose / direct dependency footprint |
| --- | --- | --- | --- |
| fastify | 5.12.3 | 2026-09-04 | HTTP framework; 15 direct dependencies |
| @fastify/cors | 11.3.0 | 2026-07-08 | Official exact-origin CORS; 2 direct dependencies |
| @fastify/rate-limit | 11.2.0 | 2026-07-29 | Official bounded abuse mitigation; 4 direct dependencies |

All three belong to the maintained Fastify organization. npm publishers are
matteo.collina (Fastify/rate-limit) and eomm (CORS), established upstream maintainers.
The registry latest stable Fastify is 5.12.3; GitHub's latest release listing remains
5.12.2. The published 5.12.3 gitHead `1c991c40f9615e8d33f8004c8f8cbe35d4be7f4f`
exists upstream with the signed-off version bump. The nearby 5.12.2 security release
fixes GHSA-9q9j-q6p8-xq58, GHSA-hwr6-493r-vm6h, GHSA-p68q-wchp-6fh7 and
GHSA-667r-xxjv-c9mm. Do not select an older patch from cached search results.

Fastify v5 supports Node >=20; both official plugin compatibility tables support
Fastify 5. The packages themselves omit engines; locked transitive engine requirements
and actual Node 22.23.2 tests are checked after resolution. Fastify 6 alpha is excluded.
No direct preinstall/install/postinstall/prepare hooks exist. Fastify's prepublishOnly
is publisher tooling. All installations disable lifecycle scripts.

OSV returned no listed advisories for each selected direct version. Registry tarballs
supply SHA512 integrity and signature metadata; the lockfile preserves integrity.
This review does not claim independent attestation verification or absence of unknown
vulnerabilities. The four-day age of Fastify's security patch is acknowledged.

Vitest 3.2.6 is the existing application runner, moved unchanged into the shared
catalog. Testkit is development-only; DB is the existing workspace implementation.
There is no additional parser, logger, validation framework, ORM, auth or provider SDK.
Strict duplicate-key detection is a bounded structural scanner followed by native
JSON.parse, with regression tests; no JSON regex parser is introduced.

Post-install evidence: `pnpm install --frozen-lockfile --ignore-scripts` passed on
Node 22.23.2 with strict engines, and `pnpm audit` reported no known vulnerabilities.
The lockfile adds 46 package versions and removes none; existing resolved package
versions remain unchanged. API Vitest gets an additional peer context using the
already-existing jiti 2.7.0, while web retains its previous jiti 1.21.7 peer context.

All new installed manifests were reviewed for engines, source repository and lifecycle
hooks. Highest explicit minimum is Node 20 (find-my-way, thread-stream, toad-cache),
compatible with 22.23.2. Packages come from the Fastify/Pino/AJV ecosystems and their
established utility repositories (lukeed, delvedor, whitequark, beaugunderson,
davidmarkclements, mcollina, kibertoad, BridgeAR, floatdrop and fent).
No new preinstall/install/postinstall hook exists. Three published manifests contain
source-only prepare hooks: ip-address 10.7.0 configures Git hooks;
pino-abstract-transport 3.0.0 invokes husky; ret 0.5.0 invokes tsc. These are reviewed
publisher/developer operations, unnecessary to the installed tarballs, and do not run
because lifecycle scripts are disabled. ajv-formats 3.0.1 uses an AJV peer-context
folder; its manifest has no install/prepare hook. The previous whatwg-encoding
warning is unchanged. No advisory is suppressed.

Source inspection found numeric-only proxy trust intentionally fails closed in this
Fastify security patch. The implementation uses an explicit IP allowlist plus hop
bound, never a function that merely recreates unsafe hop-only trust. LogController
is the supported API used instead of newly deprecated top-level logging switches.

Sources: [Fastify source](https://github.com/fastify/fastify/commit/1c991c40f9615e8d33f8004c8f8cbe35d4be7f4f),
[security release](https://github.com/fastify/fastify/releases/tag/v5.12.2),
[LTS policy](https://fastify.dev/docs/latest/Reference/LTS/),
[CORS](https://github.com/fastify/fastify-cors),
[rate-limit](https://github.com/fastify/fastify-rate-limit),
[npm registry](https://registry.npmjs.org/fastify), [OSV API](https://google.github.io/osv.dev/api/).
