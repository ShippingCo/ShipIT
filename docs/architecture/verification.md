# Issue #2 review and verification

[Architecture index](README.md) · [Open decisions](open-decisions.md)

## Baseline and inspection

Date: 2026-09-06. Starting main: `91dde097307a1558ca0c27474b546189985def82`.
Branch: `issue-2-production-architecture`. The initial project directory contained only
the planning pack, so ShipIT was cloned into its own subfolder without altering those
files. Within the clean clone, ran `git status --short --branch`, `git checkout main`,
`git pull origin main`, `git rev-parse HEAD`, a second status check, then created the
branch. No unrelated local work existed in the clone.

Inspected every tracked path and package manifest; API/DB/shared exports and TypeScript
configurations; `.github` CI/templates; existing documentation and agent/workflow rules;
store/types/message/bot exports, business screen callers, receipt/image utilities,
AppContext and frontend tests. Existing UI-library paths were inventoried, not certified
by a line-by-line security audit. No new production security/integration tests are claimed.

Read issue #2 and #3/#4/#6/#7/#10/#53/#56/#57 using `gh issue view <number> --comments`.
All nine commands succeeded; their comment lists were empty. Read live issue bodies for
the domain contracts and all M0–M8 milestone descriptions via GitHub CLI/API. Evidence
links are the [issue index](../ISSUE_INDEX.md),
[issue #2](https://github.com/ShippingCo/ShipIT/issues/2) and
[milestones](https://github.com/ShippingCo/ShipIT/milestones).

## Reproducible tabletop review

These are artifact/contract checks using fictional labels, not a claim that future
production journeys have run successfully.

| Scenario | Reviewer procedure | Expected evidence / result |
| --- | --- | --- |
| Counter booking | Follow sequence A and each ownership-table step; stop at commit, simulate DB rollback, then provider outage and lost HTTP response | [Runtime sequences](runtime-sequences.md): one transaction for owners/result/outbox; rollback publishes nothing; commit survives provider failure; retry same authorized key returns original result |
| Two independent franchises | Use Org A/A1/A2 and independently created Org B/B1; try own-org admin, A1 staff reading A2/B1 by ID/search/count/export, and read_only mutation | [Tenancy table](system-context.md) and onboarding sequence D: explicit server grants only, sibling denial without scope, cross-org denial, no global directory; each module owns its signup write |
| Provider unavailable | Walk all five outage steps; consider explicitly rejected send, uncertain acceptance and duplicate callback | [Outage scenario](runtime-sequences.md) and [ADR 0005](../adr/0005-external-provider-adapter-interfaces.md): local booking persists, retry/uncertain/terminal state is visible, #54/#55 own authorized manual/file fallback; no claimed live API success |
| Route delay | Include one parcel through both lot/direct paths, one terminal parcel, a repeated cause and a stale route version | Sequence B: Routes owns typed cause/frozen set; Parcels owns eligible ETA/timeline; all required operational writes atomic; fanout deduplicated and separately resumable; no repeated ETA addition |
| Delivery | Try generic delivered write, wrong/expired proof, concurrent success, crash before commit, and provider failure after commit | Sequence C: Deliveries approves proof; restricted Parcels mutation shares consumption transaction; no reveal path; wrong attempts bounded; one completion; Payments remains separate |

Author walkthrough result: all five are traceable through the artifacts with explicit
owners, transaction/failure boundaries and future implementation issue references.
Independent peer approval and runtime verification remain future evidence, not checked
as completed here.

## Issue #2 acceptance criteria

| Exact issue criterion | Status | Repository evidence |
| --- | --- | --- |
| ADRs preserve Fastify and raw SQL unless a reviewed replacement decision records migration cost | PASS | [ADR 0001](../adr/0001-raw-sql-and-postgresql-access.md), decision and revisit requirements |
| Architecture shows an independent franchise onboarding into its own organization | PASS | [Sequence D](runtime-sequences.md), Org B/B1 and per-module signup authority |
| Diagrams show operational transaction → outbox → worker → provider with failure boundaries | PASS | [Sequence A/B/C](runtime-sequences.md) and [ADR 0004](../adr/0004-durable-events-and-transactional-outbox.md) |
| MVP explicitly excludes subscriptions, white labeling and corporate analytics expansion | PASS | [Pilot/commercial boundaries](pilot-boundaries.md) |
| Each unresolved decision identifies the issue it blocks and cannot silently become an implementer assumption | PASS | [D01–D14 register](open-decisions.md), owner/gate/blocked issues on every row |
| A booking, route delay and delivery walkthrough names the authoritative service for every state change | PASS | [Sequences A–C and corresponding authority tables](runtime-sequences.md) |
| The deliverable identifies decisions, evidence and remaining blockers without claiming production features are already implemented | PASS | [Architecture index](README.md), ADR status, open register and this evidence report |
| Repository paths and commands are checked against current main; older prototype notes do not override the agreed issue workflow | PASS | Baseline inspection here; corrected API/shared/root README links and [transition map](../PROTOTYPE_TO_PRODUCTION.md) |

PASS above means the documentary acceptance artifact is present and checked by its author;
it does not imply independent ratification, production implementation or issue closure.

Additional requested controls: the [trust/tenancy tables](system-context.md) explicitly
cover all six requested permission scenarios, sensitive categories, server authorization,
shared restrictions and LLM/provider boundaries. [ADR 0004](../adr/0004-durable-events-and-transactional-outbox.md)
covers versioning, retries and idempotency; [open decisions](open-decisions.md) prevent
unapproved financial/legal/vendor values from becoming implementation assumptions.

## Validation results

Validation completed locally with Node `v24.16.0` and pnpm `10.34.5`.
The current repository has no `lint` script; #5 owns it. Its absence is **not a pass**
and this PR does not add unrelated quality tooling. The existing planning validator is
extended only to include architecture/ADR Markdown in its fence and relative-link checks.

| Command | Exit | Outcome |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Locked dependencies installed; pnpm ignored esbuild lifecycle script. No manifest/lockfile changes |
| `pnpm test` | 0 | 23 tests passed. Existing React `act(...)` warnings remain |
| `pnpm typecheck` | 0 | All four workspace packages passed |
| `pnpm lint` | 254 | Command missing; unavailable, owned by #5, **not passing** |
| `pnpm build` | 0 | Vite 6.4.3 build passed; single HTML 539.56 kB, 156.00 kB gzip |
| `python3 scripts/validate_planning.py` | 0 | Required files, workflow, nine milestones, 82 issue rows, Markdown fences and relative links including all new architecture/ADR documents passed |
| `node /tmp/shipit-issue2/check-mermaid.mjs "$PWD"` | 0 | All five Mermaid diagrams parsed using temporary Mermaid 11.12.0 and the repository's existing jsdom. Initial semicolon syntax errors were corrected and the complete parse rerun |
| `rg -n 'TODO|TBD|FIXME|XXX|to be decided|unknown' docs README.md` | 0 | Matches reviewed: no unresolved placeholders; “unknown” describes explicit denial/failure semantics or registered D04/D06/D10 policy cases |
| `git diff --check` | 0 | No whitespace errors |

The tests/typechecks/build exercise the unchanged prototype/scaffolds, not the future
architecture. CI currently uses Node 22 while the local supported runtime is Node 24;
#5 owns consistent pinning. The current PR-head CI result is reported in GitHub rather
than pre-claimed here. Missing lint and pending independent review prevent claiming
all issue Definition-of-Done/merge gates complete. No merge or post-merge cleanup is performed.

### Repeat Mermaid syntax validation

The syntax checker was a temporary local utility, not an application dependency or
new repository toolchain. Reproduce from the repository root (requires npm access):

```sh
mkdir -p /tmp/shipit-issue2
npm install --prefix /tmp/shipit-issue2/mermaid --ignore-scripts --no-package-lock mermaid@11.12.0
# Save the JavaScript below as /tmp/shipit-issue2/check-mermaid.mjs
node /tmp/shipit-issue2/check-mermaid.mjs "$PWD"
```

```javascript
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const require = createRequire(join(root, 'apps/web/package.json'));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { default: mermaid } = await import('./mermaid/node_modules/mermaid/dist/mermaid.esm.mjs');
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
let count = 0;
for (const dir of ['docs/architecture', 'docs/adr']) {
  for (const file of readdirSync(join(root, dir)).filter(f => f.endsWith('.md'))) {
    const content = readFileSync(join(root, dir, file), 'utf8');
    // Fences are assembled so the documentation's own example is not a diagram.
    const fence = String.fromCharCode(96).repeat(3);
    const pattern = new RegExp(fence + 'mermaid\\n([\\s\\S]*?)' + fence, 'g');
    for (const match of content.matchAll(pattern)) {
      await mermaid.parse(match[1]);
      console.log(`PASS ${dir}/${file} diagram ${++count}`);
    }
  }
}
if (count !== 5) throw new Error(`Expected 5 diagrams, got ${count}`);
```

Mermaid parsing validates syntax; the five tabletop walkthroughs validate meaning.
No live provider calls, real customer fixtures or production database were used.
