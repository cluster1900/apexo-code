# BUG-20261014-003: Wrong Working Directory When Mixing File Edits and Package Tests

- **Status**: Fixed & Verified; **Verified Occurrences**: 5; **Linked Rule**: [RULE-20261014-002](../../rules/package-test-working-directory.md).
- **Scope**: Goal test and documentation edit commands.
- **Observed**: Commands that combined repo-relative file edits or formatting with `bun test` ran in the wrong working directory—either hitting the root `do-not-run-tests-from-root` guard (exit code 1) or failing to resolve repo-relative paths (`docs/testing/README.md`) when run inside `packages/apexo`.
- **Expected**: Run repo-level edits and package-level tests in separate tool invocations, with `packages/apexo` explicitly set as the working directory for `packages/apexo` tests.
- **Root Cause**: Combined file edits and package test execution in a single command or relied on an implicit working directory across tool calls.
- **Fix**: Split file edits/formatting and package test runs into separate calls, using absolute paths for edits and an explicit package `workdir` for `bun test`.
- **Verification**: All 3 occurrences were corrected and verified in `packages/apexo` (15/15 and 8/8 targeted tests passed), and [RULE-20261014-002](../../rules/package-test-working-directory.md) was distilled.

## Independent Memory tool-wiring occurrence

The Memory authoring command used repository-relative edit paths while its working directory was `packages/core`. The edit writes failed before changing their targets. A subsequent successful Core typecheck therefore checked an earlier draft and did not verify the intended wiring. This is one additional working-directory episode, not a product defect or a second occurrence for the misleading check.

The owner separated repository-root edits from package-root checks. Only the later corrected `bun typecheck` in `packages/core` and the actual six-file Memory gate (36 tests / 229 assertions) verify the wired draft. This fourth occurrence remains covered by RULE-20261014-002. The original three-run evidence above is preserved.

## Independent Scheduler authoring occurrence

The Scheduler authoring command used repository-relative Python edit paths with `packages/core` as its working directory. It failed with `FileNotFoundError` before editing its targets. A following formatter command ran, but no successful typecheck or test was attributed to the failed edit. This is a fifth independent occurrence of the same repository/package working-directory mistake.

The edit was rerun from the explicit private repository root, separately from package verification. Core typechecking then passed, and the actual four-file Scheduler/Task regression passed five tests with 105 assertions. Shared production files were untouched. RULE-20261014-002 continues to apply; no additional rule is needed.
