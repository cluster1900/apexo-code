# Native Shell fixtures referenced a private migration

- **ID:** BUG-20261015-145.
- **Status:** Corrected; shared real-process verification and all 21 typechecks passed.
- **Occurrences:** One integration episode affecting three fixtures, not three independent recurrences.
- **Scope:** Native process store, execution, and runner tests.

## Observed and expected behavior

The shared type gate reported TS2307 and the focused test command failed to load three files because they imported the private proposed migration `20261015220000_native-shell-process`. The production migration was correctly generated centrally as `20261014222602_native-shell-process`. Fixtures should initialize the actual production schema and execute their behavior assertions.

## Reproduction and root cause

Run `bun typecheck` from `packages/apexo`, or run `bun test test/v2/process-store.test.ts test/v2/process-execution.test.ts test/v2/process-runner.test.ts` there after integrating the native Shell draft and generating its canonical migration. The draft fixtures explicitly called `DatabaseMigration.applyOnly` against a draft timestamp instead of relying on the production Database layer. That layer already applies the complete generated migration registry.

## Fix

Remove the three draft migration imports and redundant manual migration calls. Remove the execution/runner fixtures’ unused direct Database bindings; retain the store fixture’s actual database binding for restart and persistence assertions. Keep the centrally generated production migration unchanged.

## Verification

The first combined run had three module-load errors and one separately tracked media timeout. Neither blocked fixture is claimed verified. Focused real-process tests and the shared type gate are pending after this correction.

After the correction, the shared native Shell/media/Plan command passed 68 tests / 623 assertions across twelve files in 52.78 seconds, with exit zero. The process store, actual worker and provider runner files all loaded and completed their real behavior assertions using normal production migration initialization. The complete shared type gate passed all 21 tasks, with exit zero.
