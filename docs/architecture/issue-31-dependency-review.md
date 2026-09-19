# Issue #31 dependency review

Reviewed before installation into ShipIT on 2026-09-19.

| Package | Exact version | Purpose | Node / module | License |
| --- | --- | --- | --- | --- |
| @aws-sdk/client-s3 | 3.1136.0 | Official S3 signing, conditional Put/Head/Get/Delete and checksum protocol | engines >=20, compatible Node 22.23.2; CJS and ES exports callable from ESM | Apache-2.0 |
| file-type | 22.1.1 | Byte-based media detection, independent of extension/MIME hints | engines >=22; native ESM | MIT |

Registry metadata and the isolated resolved package manifests were inspected. Together
these resolve 36 package versions (including the two direct packages), with MIT,
Apache-2.0, BSD-3-Clause and 0BSD licenses. No resolved package declares preinstall,
install, postinstall or prepare lifecycle scripts. `pnpm install --ignore-scripts`
was used in the isolated review tree. Its `pnpm audit --json` completed with zero
listed advisories (36 dependencies); final repository audit is recorded separately
in verification and may contain pre-existing findings.

Node crypto/fetch could reproduce SigV4 but would require maintaining canonical signing,
provider errors, stream/checksum and conditional-write semantics. A custom header sniffer
would miss supported-format nuances. These maintained protocol libraries are chosen over
hand-written replacements or a full multipart-upload manager. No scanner dependency is
needed: Node net/tls implements clamd's small bounded INSTREAM protocol. SDK retries are
disabled; service-level reconciliation owns uncertainty. Direct versions are pinned and
all transitive versions/integrity hashes are committed in the lockfile.

Primary references: [S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html),
[file-type source](https://github.com/sindresorhus/file-type),
[ClamD protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).

The provider contract uses a digest-pinned MinIO test image. It is test infrastructure
only (AGPLv3 upstream), never production provider selection. Exact digest, startup,
privacy/conditional-write checks and teardown evidence are recorded in verification.
A deterministic clamd wire fixture requires no Docker image/signature download and
makes no claim of antivirus engine efficacy. Deployment must qualify its real scanner.

## Final repository audit

`pnpm install --frozen-lockfile --ignore-scripts` passed. The two direct packages add 33 resolved package versions to the existing lockfile (36 in isolation, with shared versions deduplicated). `pnpm audit --json` exited 1: 595 reported dependencies, 4 moderate path findings, 0 high/critical. Both advisory entries are GHSA-82fw-gwwq-j7x9 / CVE-2026-84373, affecting existing Vitest 3.2.6 and @vitest/mocker 3.2.6 in API/web paths. Those versions were already in starting main and are unchanged here. No finding names the new SDK/content-detection dependency graph. The advisory concerns redirect-mock file access through development/browser mock servers; this repository runs Node/jsdom Vitest without a public mock-server route. Remediation requires a separately tested Vitest major upgrade (fixed >=4.1.11); no audit suppression or false clean claim is introduced.

`pnpm audit --prod --json` also passed: 216 production dependencies, zero vulnerabilities. This does not erase the full-audit development-tool findings above.
