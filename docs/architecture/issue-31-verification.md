# Issue #31 verification

## Baseline audit

2026-09-19: clean tree fetched/pruned, checked out main and pulled fast-forward before
branching. Starting SHA `35d91c2c1bb7d64a6606ea1f3e9c5adccba3df42`, PR #114.
[Main run 35121785412](https://github.com/ShippingCo/ShipIT/actions/runs/35121785412)
passed all five Quality jobs, PostgreSQL integration and Planning and prototype checks.
No open PR existed. Protection was strict/up-to-date with that required final check;
admin enforcement enabled, zero required approving reviews. Protection was not changed.

Branch `issue-31-private-attachments`. Issue #31 remains OPEN; only its execution label
moved blocked → ready → in-progress. Issue body/type/area/risk/priority/milestone untouched.
Prerequisites closed and merge ancestry independently verified:

| Issue | PR / merge SHA | Present implementation |
| --- | --- | --- |
| #6 | #89 / 36ce6d3e40d1ddfd77f44b94e3c5fe17c57893b1 | ADR 0008, configuration/threat/log contracts |
| #15 | #98 / 4d606da563348b042a2d76d9c0a186904a3b187c | TenantAccess/scopedQuery, AST gate, actual runtime role tests |
| #16 | #99 / 3cefe534b6ca23fc8ffdd5a77f2bb57f5517a361 | append-only audit, closed telemetry, safe denial projection |
| #22 | #105 / b0d4791ae936eb6d66561a547e841c739d07d44a | atomic Booking/Parcel schema, composite parents, receipts/locking |

Closed issue inventory #2–#30 and merged PRs #85–#114 were re-audited; every merge
is an ancestor of starting main. Relevant verification records, required architecture,
ADRs 0003/0006/0007/0008/0009/0013/0014/0020, API/DB composition, authorization,
prototype attachment picker and production data-access boundaries were inspected.
ADR 0021 and the attachment domain contract were written before product code.

## D09 application decision

ADR 0021 was written before code. The protocol is private S3-compatible conditional
Put/Head/Get/Delete, using an unversioned evidence bucket and an injected real SDK adapter.
Put/Delete first verify bucket versioning is absent. clamd INSTREAM is the real fail-closed
scanner adapter; a managed TLS proxy and maintained scanner signatures are #68.
Allowed types are JPEG/PNG, MP3/WAV, MP4. Limits are 8 MiB/file, 10 active or reserved
objects, 32 MiB reserved aggregate and 3 incomplete uploads per Booking. These are
conservative pilot limits independent of browser localStorage.

Upload expires at 15 minutes; cancellation/rejection cleanup eligibility is event +15
minutes, other unlinked objects expiry +15 minutes. Runtime starts cleanup after one second,
then schedules five minutes after each completed bounded tick (100 rows maximum). Healthy
no-backlog target is about 20 minutes after cancellation/expiry; processing time, outage or
backlog extends it. Failed/uncertain deletes retain quota and retry after five minutes.
Only confirmed absence tombstones. Ready evidence is immutable and excluded.

Download grants are 60-second authenticated application URLs, signed and session/resource/
version/scope-bound. Live R14 is checked before and after fetching bytes, including grant
replay; URLs do not extend authority. This deliberately avoids direct S3 URL revocation
windows. Already delivered bytes cannot be recalled. No URL/token is persisted in a receipt.
Retention classes are operational_evidence/delivery_proof; no statutory duration is invented.
#33 owns full Booking UI cutover, #42 delivery challenges, #68 vendor/provisioning/TLS/private
policy/encryption/capacity/signatures, #69 backup/recovery, #72 legal periods/holds/deletion.

## Acceptance evidence

Commands: **DB** = `pnpm db:local test:db`; **API** = `pnpm test:api`;
**WEB** = `pnpm test:web`; **S3** = `pnpm test:attachments`;
**TOOL** = `pnpm test:quality`. They also run within `pnpm db:local quality`.
All paths below are repository-relative. DB means real PostgreSQL 18.6 using generated
runtime roles, not mocked ownership/constraints. External faults alone use injected ports.
The clean-quality snapshot in verify:gates passed all acceptance tests; final run results
are recorded in the execution ledger below.

| #31 criterion | Implementation | Executable proof / command | Observed outcome |
| --- | --- | --- | --- |
| Foreign Booking/key cannot attach or download | attachments/repository.ts owner predicates/composite parent; memberships/service.ts | apps/api/test/database/attachments.test.ts: real A1/A2/B1 chains + foreign selectors; DB | Valid sibling/unrelated Booking/Parcel/Attachment IDs and unknown IDs all deny identically; no local list/count/byte disclosure; runtime composite FK rejects nested foreign Parcel. Client key input rejected. |
| Executable/MIME mismatch rejected | attachments/content.ts + service.finalize | same DB file scanner/content test; API attachments content detection | Executable bytes declared image and PNG declared JPEG never reach ready. Unsupported SVG/empty input denied; filename is not accepted as authority. |
| Over-limit upload bounded | content.boundedStream/readBounded; repository quota; migration guard | DB binary stream and concurrent/count/aggregate tests; API exact maximum/+1/partial tests; S3 truncated/aborted test | 8 MiB accepted, +1 denied, partial stream cannot link; ten-object/32 MiB/three-pending limits hold under locks; failed objects never become readable. |
| Finalize links once | service.finalize, immutable command receipts, row locks | DB concurrent finalize, rollback/lost commit and fresh-pool replay | One ready transition/object; replay adds no success audit; transaction rollback leaves quarantine; committed ready result survives lost acknowledgement. |
| Expired grant fails | grants.ts + download reauthorization | DB synthetic lifecycle; API signature bindings | Valid through 59,999 ms; at 60,000 ms returns indistinguishable 404. Session/scope tampering denied. |
| Scan failure never public | scanner.ts strict bounded socket protocol; service quarantine | API 9 scanner contract cases; DB infected/error/recovery | Clean alone links. Infection rejects; timeout/connection/protocol/engine error stays unreadable; clean retry may recover before expiry. |
| Canceled/orphan cleanup | cleanup.ts, runtime worker, scoped discovery | DB cancellation/orphan/delete-before/delete-after cases | No deletion before threshold; confirmed absence creates tombstone, retry resolves uncertain deletion; ready object remains. |
| No production Booking data URL | explicit DTO, attachment adapter/Blob helper, demo isolation | WEB public metadata/intent tests; DB privacy/Booking JSON; production build gate | Parent callback contains safe metadata only. No filename/key/grant/bytes serialize with Booking. Old data URLs remain solely in isolated fictional demo. |
| Happy path survives reload/restart | persisted metadata/receipts and API list | DB synthetic lifecycle/fresh pool; WEB durable list + explicit preview | Same ID/result reloads, no duplicate object; preview bytes require a new authorized access flow. |
| Real sibling/unrelated isolation | scopedQuery/composite FK and live membership | DB A1/A2/B1 and assigned agent tests; TOOL attachment AST negatives | Own chains succeed; valid foreign chains fail, assigned proof cannot disclose booking-wide evidence; reassignment immediately revokes grant/list/replay. |
| Controlled malformed/stale/dependency results | strict validation, state/version guards, sanitized envelopes | DB altered identity/size, unavailable Put/Get/Delete, scan, expiry, rollback/revocation; API config/stream | No unauthorized partial ready mutation; errors omit provider/SQL/scanner details; original object reservation survives uncertainty. |
| API/log/audit/browser privacy | explicit DTOs, generated filenames, safe triggers, route-template logging | DB privacy markers and synthetic lifecycle; WEB metadata/progress/unsafe/abort tests | Synthetic phone/address/token/CSRF/credential/OTP/signed-URL markers absent from durable public metadata, audit/events and logs. Blob previews are revoked on scope/logout/unmount/replacement/cancel. |

## Authorization and persistence detail

Every canonical role is exercised separately for W22 and R14: franchise_admin/operator
write/read; dispatcher read only; org_admin metadata only; accountant/read_only neither.
Agent access uses persisted current assignment, active attempt and parcel_proof; reassignment
revokes it. Revocation during external scanning is rechecked before any link/receipt commit.
C remains closed because main has no durable cross-franchise custody identity (ADR 0014).
No wildcard role or org-admin byte grant was introduced.

Migration `1790355600000-private-attachments.cjs` is additive. Twenty migrations install
fresh/repeat; populated 19-migration main upgrades without backfill or source-row changes.
Injected migration failure rolls back schema and ledger. Runtime-role tests reject owner
changes, deletes, truncate, DDL, direct audit reads/writes and unvalidated ready state;
owner triggers also reject identity/history changes. Ready and deleted rows are immutable.
PUBLIC gets no table/function grants; cleanup discovery yields one owner pair only through
a fixed-search-path definer. scopedQuery protects all subsequent object metadata queries.
The AST gate rejects raw executor, missing/single-owner predicate and capability minting;
there is no directory-wide exception. All 19 released migrations remain byte-identical.

No new general domain event. Append-only attachment/grant audit facts contain only safe
references/state/version/actor/correlation/time; denied requests use existing security.request.
Ready records retain their immutable object key and expected digest internally; tombstones
clear actual size/digest/detected type but keep reconciliation identity. #72 owns further
privacy minimization. No automatic media import or customer/legal hold is added.

## Provider and browser evidence

`pnpm test:attachments` uses MinIO RELEASE.2025-09-07T16-13-09Z, manifest-list digest
`sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` (arm64/amd64),
test-only AGPLv3 upstream. It generates local credentials, binds loopback, uses a uniquely
owned container and fails startup/test/cleanup errors. Three actual S3 tests prove anonymous
403, conditional overwrite denial, checksum/identity, Get/Delete, missing object, partial/
aborted stream and versioned-bucket refusal. SDK emits a fixed non-retryable-stream warning
on intentional rejected writes; it contains no private path/credential. No tests are skipped.
The deterministic TCP clamd fixture verifies framing/result/error/timeouts, not antivirus
engine efficacy. #68 must qualify and update its actual engine.

Vitest/jsdom is the existing frontend harness: selection, local validation, upload progress,
scan-pending, cancel/retry/network/unsafe errors, metadata-only parent state, Blob revocation,
reload, explicit preview, logout/scope/unmount and client replacement. Native labeled buttons
are focusable and async statuses announce progress. Existing flex-wrap/max-width CSS provides
narrow layout; jsdom makes no pixel/real-browser geometry claim. Existing app.test.tsx tests
remain. Image error/abort paths revoke temporary decode URLs. Download transport rejects
foreign signed URLs before credentialed fetch and bounds response bytes. No new animation.

## Synthetic reproduction

Run `pnpm db:local test:db` with the pinned toolchain and Docker. The attachment DB file
creates fictional Organization A/franchises A1/A2 and unrelated B1 with real customer,
pricing, tax and Booking chains; sessions/memberships are persisted. It initiates a valid
synthetic PNG, uploads, scans, finalizes, reloads metadata, retries finalize, creates/downloads
a 60-second grant, advances the fake clock through expiry, repeats foreign/nested IDs,
alters object identity/content, cancels another upload, advances cleanup, verifies absence/
tombstone, and replaces service/database pool before replay. It inspects state, object map,
receipts, audit and events. The separate S3 command runs the same adapter on a real provider.
No production identities, messages or credentials are used.

## Execution ledger

Toolchain: Node 22.23.2, pnpm 10.34.5, Python 3.12.14, PostgreSQL 18.6.
Local commands use the installed pinned Node PATH and PYTHON path; host defaults (Node 24 /
Python 3.14) were not accepted. The initial temporary Python installation lacked its stdlib;
a fresh official python-build-standalone 3.12.14 archive restored it before checks.

- Frozen install passed without lifecycle scripts.
- Dependency review preceded installation: @aws-sdk/client-s3 3.1136.0, file-type 22.1.1;
  33 newly resolved versions. See issue-31-dependency-review.md for licenses/alternatives.
- Audit exited 1: **four moderate findings**, zero high/critical, all existing Vitest/mocker
  3.2.6 paths for GHSA-82fw-gwwq-j7x9. No new production package advisory. Not a clean audit;
  major-version test-harness remediation remains separate, with no public mock-server use here.
  `pnpm audit --prod --json` passed: 216 dependencies and zero findings.
- Intermediate failures were fixed: cleanup tombstone CHECK; S3 connection reuse after an
  early conditional rejection; Node TS re-export typing; newly required config fixtures;
  migration upgrade counts (including legacy Lot fixture); React effect dependencies and
  one test-only lint alias. No skipped assertions, widened timeout or weakened gate.
- The first direct focused DB attempt failed its missing resource-registry guard. Subsequent
  focused runs and full commands used the guarded provision/cleanup workflow.
- `pnpm db:local quality` passed: toolchain, 25 tooling tests, planning (80 frontend
  declarations/17 negative controls), lint/tenant AST, all five package typechecks,
  `pnpm test` (22 testkit +12 DB-unit, 368 API, 115 web, 3 S3 contract), 56 DB +220
  API PostgreSQL tests, and production build. Zero failed/skipped/canceled/todo.
- `pnpm db:local verify:gates` passed all 24 drills: clean/restored aggregate quality,
  intentional tenant/demo/lockfile/lint/promise/type/unit/API/DB/build failures, and
  final CI-gate missing/failure/skipped/canceled cases. Its isolated snapshot preceded
  the last client-replacement test, token-character guard and stricter bundle guard;
  those changes separately passed full quality/API/tooling/lint/planning/build as applicable.
- Final `pnpm test:api` passed 368; final `pnpm test:quality` passed 25 after extending
  the production bundle guard; `pnpm lint`, `pnpm check:planning`,
  `pnpm check:migrations` and `git diff --check` passed. The migration check reported
  exactly 19 released files unchanged.
- Production `apps/web/dist/index.html` is 520,920 bytes; the rendered module graph
  passed the strengthened demo/server boundary. Inspection found none of 16 storage,
  secret, test-body or demo markers and no readAsDataURL/toDataURL conversion.
- Standalone final `pnpm db:local test:db` passed: **56 DB +220 API**, zero failures,
  skips, cancellation or todo; its disposable PostgreSQL container was removed.
- Current-head GitHub Actions and review state are verified after push in the PR checks
  and final delivery report. No local result is substituted for hosted CI.

The final self-review inspected public ACL/key handling, exact R14/W22, scoped queries,
scan failure, controlled MIME/size bounds, quota/replay races, durable cleanup, generated
filenames, URL/log/audit privacy, preview lifetimes and downstream boundaries. It caught
and fixed non-ASCII malformed grant handling and explicitly blocked versioned buckets.
No production deployment, merge, auto-merge, manual issue closure or branch deletion.
89 changed files cover application/shared contracts, one forward migration, tests,
tooling and owning documentation; historical migration-test count changes simply advance
the preserved upgrade expectations to twenty migrations.
