# @shippingco/testkit

Test-only TypeScript builders, fake clock/provider, commit failure injection and database
configuration guard. See the [testing contract](../../docs/architecture/testing-contract.md)
and [Issue #9 evidence](../../docs/architecture/issue-9-verification.md).

No runtime dependencies. Uses existing catalog TypeScript/Node types and the repository's
Node built-in tooling runner, with type stripping on pinned Node 22.23.2; typechecking is
separate and mandatory. The web suite keeps Vitest/Testing Library. Future API/domain
TypeScript suites should reuse Vitest when its injection/mocking facilities are useful,
reviewing the existing pinned version before adding its workspace dependency. No Jest.

Consumers add this workspace as a **devDependency** only. Import from test files or their
`test/` helpers; production modules must never import fixtures, directly or indirectly.
This package imports no application workspace, so the dependency graph stays acyclic.
Models are deliberately small references, not production schemas. To create another
resource, override its ID explicitly; defaults mean the same logical fictional resource.

```sh
pnpm test:unit
pnpm --filter @shippingco/testkit typecheck
```

All exports are in `src/index.ts`. Add tests beside helpers as `src/*.test.ts` so the
explicit test command discovers them. Do not use non-erasable TypeScript features in
Node-run helpers; no enum, parameter properties, path alias loader or transpiler is needed.
