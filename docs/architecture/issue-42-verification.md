# Issue #42 verification

Run with the pinned repository toolchain:

```text
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
git diff --check
```

Focused evidence is in `deliveries/crypto.test.ts`, `deliveries/validation.test.ts`,
`whatsapp.test.ts`, web operational/data-access tests,
`packages/db/test/integration/delivery-proof.test.ts`, and
`apps/api/test/database/deliveries.test.ts`.

The real-PostgreSQL suite covers populated upgrade, rollback/retry/repeat, composite tenant
FKs, runtime privileges, exact replay, five-failure lock, resend/replacement budgets,
restart, independent-connection completion races, OTP/exception race, OTP/T07 race,
post-proof injected rollback, sibling/foreign/other-agent isolation, protected evidence,
permanent proof method, immutable Parcel-recipient routing distinct from the booking sender,
and unchanged To-Pay obligation. Synthetic secret sentinels assert
that plaintext proof and private markers do not enter command results, events or browser
state. Provider tests use a synthetic transport only. The final run passed 30 static
quality tests, 34 package unit tests, 481 API tests, 157 web tests, 3 object-store contract
tests, and 366 real-PostgreSQL tests (67 database + 299 API); both production builds passed. `verify:gates` passed
the clean/restored quality runs and every expected negative drill.

Manual review searches `OTP|challenge|verifier|secret|token|phone|address|payload|console.log|
request.log|JSON.stringify|DTO|shared|localStorage|sessionStorage|provider|exception evidence`
and confirms production has no import of `data/store`, `revealOTP`, `verifyDeliveryOTP`,
`confirmDelivered`, or a generic delivered command.

Live Meta authentication-template approval/send behavior is intentionally not certified by
synthetic tests. Production enablement requires the exact approved template, language,
credential revision, fresh provider metadata and explicit server-side
`template.meta_send_qualified: true`. Office collection awaits its owning
lifecycle/calendar commands. These fail-closed limits do not weaken doorstep delivery proof.
