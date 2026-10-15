# Background Task repeated-file fixture reused removed XDG storage

- **Bug ID:** BUG-20261015-098
- **Scope:** Native background Task HTTP diagnostic repetition.
- **Status:** Fixture repetition corrected; no product repair inferred.
- **Independent occurrences:** 1.

## Observation and cause

A seven-case HTTP run passed 7 tests / 57 assertions. Repeating that file three times inside one Bun process with `--rerun-each 3` produced 19 passes and two deletion failures. Retained Effect cause showed `SessionGoalCleanup.prepareSession` reaching `SessionGoalReports.owners`, whose `realpath` failed with ENOENT for the process-wide XDG data directory.

The package preload's `afterAll` disposes its application runtime and removes that process-wide directory. Repeating the test file did not rerun initialization of that preload environment. Later iterations therefore reused an environment already retired by the first iteration. This is not evidence of a product deletion or background Task ownership bug.

## Correction and verification

Use a fresh package test process for each independent repetition. Do not recreate missing production directories or relax lifecycle errors to mask fixture teardown. From `packages/apexo`, pinned Bun 1.3.14:

`bun test test/v2/task-completion.test.ts test/v2/task-background-ownership.test.ts test/e2e/v2-task-background.e2e.test.ts test/e2e/v2-task.e2e.test.ts --timeout 30000`

The corrected fresh-process run passed 15 tests / 153 assertions, including parent deletion and application-scope joined cancellation. The separate unexplained SOAP-shaped HTTP 500 observation is not assigned this cause or claimed fixed by this pass.
