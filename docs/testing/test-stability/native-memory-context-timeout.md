# BUG-20261015-161: Native Memory context exceeded its whole-test deadline

- **Status:** Investigating; no production fix established.
- **Scope:** `packages/apexo/test/v2/memory-context.test.ts`, the selection and authority-withdrawal case.
- **Observed:** In the first combined CLI/Memory integration gate, the case exceeded Bun's five-second deadline at 5008.94 ms. Cleanup reported one dangling process. The run also had a separate missing workspace dependency, documented in [BUG160](../test-fixtures/native-terminal-workspace-install.md).
- **Expected:** Saved selection, revoked authority, mode disable, forgotten-note withdrawal and their cleanup complete within the existing test bound.
- **Reproduction:** Run the six Memory test files together with the five native terminal/CLI regression files from `packages/apexo`. Only one failing timing observation is established. A workspace typecheck was also active, but no phase timing or evidence establishes contention as the cause.
- **Root cause:** Unknown. The timeout and cleanup message do not identify which operation was delayed. The separate terminal dependency installation does not explain or repair this case.
- **Investigation:** The unchanged `bun test test/v2/memory-context.test.ts` passed alone: one test, 13 assertions, 1472.61 ms for the case. No timeout, assertion, or production implementation was changed. A passing rerun does not establish a fix or justify combining this record with another timing symptom.

The subsequent unchanged eleven-file combined gate passed 96 tests / 371 assertions in 12.04 seconds, including this Memory-context case. The first failure remains an unresolved timing observation; no production repair is inferred from the aggregate pass.
