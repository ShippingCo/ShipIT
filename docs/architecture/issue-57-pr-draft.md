# Issue #57 delivery draft

Commit message: `docs(carriers): research Maruti access and recommend manual pilot`

PR title: `Research Maruti access and recommend a manual pilot path`

## Ready-to-use description

ShipIT needs a supported Maruti path without assuming a franchise has authorized API access.
Add dated carrier/product evidence and public Innofulfill v2 documentation findings, six
separate capabilities, format/reconciliation limits, owner-assigned access unknowns and an
explicit `api_unverified` / live NO-GO / `manual` pilot decision. Public API existence is
confirmed as an offering; ShipIT-authorized test access and legacy branch-docket coverage
remain unverified.

Reuse merged #53–#56 contracts/research and #54's scoped manual API; distinguish #55's
generic CSV implementation from a verified carrier export. Compare manual/file/live and
intermediary options, show missing/refused-access recovery, and review all four completion
outcomes. Adopt existing AWS safe-retry and PostgreSQL ownership patterns; adapt Microsoft's
translation boundary so carrier claims cannot complete delivery or alter money. A documented
reference ID is not proof of safe external booking retries.

No runtime/schema/config/UI/LLM/provider change, outreach, account creation, portal scraping
or deployment. Public docs read in a browser where text retrieval was empty; partner-index
leads and the developer-root 401 are bounded. No live integration/pilot is claimed.

Validation: complete local `pnpm db:local quality` passed (35 tooling/security, 22 testkit,
12 DB unit, 638 API, 189 web, three storage, 69 schema/DB and 399 API database tests),
plus planning, lint, all five workspace typechecks and both builds. Disposable services
were removed. Also passed 48 focused carrier tests, the 38-file migration-history check,
and final documentation/whitespace checks. The initial restricted Docker attempt failed;
the retry with local service access passed completely. Existing React `act(...)` warnings
remain visible. See [acceptance and exact results](https://github.com/ShippingCo/ShipIT/blob/issue-57-maruti-research/docs/architecture/issue-57-verification.md)
after the separately authorized branch push.
No new branch CI or independent approval is claimed. No setup/migration required.

After evidence review, this satisfies #57's research prerequisite for #60; #58/#59/#60 and
their milestone exit gates remain required. Future authorized API access is a separate
revisit condition, not an indefinite research blocker.

Closes #57 after review and the separately authorized GitHub workflow.

## Review package

- [Research and fallback](../integrations/maruti-research.md)
- [Acceptance, base, checks and self-test](issue-57-verification.md)
- [Carrier contract](carrier-contract.md)
- [Existing manual workflow](manual-carriers.md)

Local work only; nothing committed/pushed/published/merged by this request.
