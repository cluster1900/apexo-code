# BUG-20261014-206: Fixture migration replaced an explicit bootstrap

- **Scope:** `packages/apexo/test/e2e/features.e2e.test.ts`.
- **Status:** Verified by the focused feature and feedback fixture run.
- **Observed:** After migrating the raw graph compiler to `AppNodeBuilderV1`, the
  provider catalog test returned an empty catalog instead of its configured provider.
- **Expected:** This fixture's explicit no-op bootstrap remains authoritative, so
  its configuration written inside the test body is loaded on first service use.
- **Reproduction:** Run `bun test --timeout 30000 test/e2e/features.e2e.test.ts` from
  `packages/apexo` with `AppNodeBuilderV1.build` and the fixture's explicit
  `InstanceStore.bootstrapNode` replacement.
- **Root cause:** The compatibility builder appends its default bootstrap after
  caller replacements. The final replacement wins, so real bootstrap initialized
  configuration and provider state before the test wrote its configuration.
- **Fix:** Use `AppNodeBuilder.build` for this explicitly bootstrapped fixture.
  It binds the required native Location map while preserving the supplied bootstrap
  replacement. Ordinary compatibility fixtures retain `AppNodeBuilderV1`.
  No production builder behavior was changed.
- **Verification:** `bun test --timeout 30000 test/e2e/features.e2e.test.ts test/server/httpapi-feedback.test.ts`
  from `packages/apexo`: 15 passed, 56 assertions, no failures. The provider catalog
  test resolves the configured provider after the explicit bootstrap is preserved.

