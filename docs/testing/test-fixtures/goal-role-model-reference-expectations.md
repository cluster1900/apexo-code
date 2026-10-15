# BUG-20261014-251: Role-selection expectations omitted the schema-normalized model reference

- **Scope:** `test/session/goal-role-selection.test.ts`.
- **Status:** Verified by the focused regression and both package typechecks.
- **Observed:** Nine fallback cases failed because the current Session model
  correctly retained `variant: "default"`, while the expected object omitted it.
  Typechecking also rejected raw string expectations for branded model, provider
  and agent IDs in the same reference assertions.
- **Expected:** Fallback preserves the complete current model reference. Fixture
  expectations use the schema's ID constructors and the Session's actual variant.
- **Reproduction:** Run `bun test --timeout 30000 test/session/goal-role-selection.test.ts`
  and `bun typecheck` from `packages/apexo` with the initial literal expectations.
- **Root cause:** The fixture manually reconstructed an incomplete, untyped model
  reference instead of matching the native schema-normalized reference.
- **Fix:** Assert the preserved Session variant and construct branded IDs with
  `ModelV2.ID`, `ProviderV2.ID` and `AgentV2.ID`. Product fallback behavior is retained.
- **Verification:** All eleven selection cases passed within the six-file native
  Goal gate (104 tests, 713 assertions). Core and Apexo typechecks passed.
