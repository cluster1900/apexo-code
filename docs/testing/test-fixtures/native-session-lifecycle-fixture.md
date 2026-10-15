# BUG-20261015-003: Native deletion draft fixture setup

- **Scope:** Native Session removal, Memory and Scheduler restoration fixtures. These were fixture setup defects; no shipped deletion behavior is claimed.
- **Observed:** The first isolated run failed while constructing the unbound `SessionExecution` service. After binding it, removal returned `SessionLifecycle.Failure`; the underlying cause was `ENOENT` from `GoalReports.owners` resolving the fixture's nonexistent custom `Global.data` directory.
- **Expected:** The fixture must construct the concrete process-local execution graph and supply a real existing data directory before exercising required Goal report cleanup.
- **Root causes:** Including `SessionExecutionLocal.node` in a public group does not replace the separate unbound `SessionExecution.node`. The fixture also replaced Global paths without creating its replacement data directory. These are two setup defects in one fixture development episode, not independent recurrences.
- **Fix:** Add the explicit `[SessionExecution.node, SessionExecutionLocal.node]` replacement and create the custom data directory. Keep real removal, execution, storage, hooks, Goal cleanup and filesystem services.
- **Reproduction:** In an isolated checkout containing the deletion draft, run `bun test test/session/native-removal-lifecycle.test.ts` from `packages/apexo` with either earlier fixture setup.
- **Verification:** The corrected isolated fixture passed one test and eight assertions, including recursive deletion, unrelated Session preservation, idempotency, exact ID reuse and rejection of a previously bound prompt. Core and Apexo package typechecks subsequently passed in the isolated draft.
- **Occurrences:** Three independent missing-concrete-execution-binding fixture episodes; three independent missing-custom-data-directory episodes, counted separately below.
- **Status:** Original integrated verification is recorded below. The latest restoration fixture correction is verified privately; its shared integration remains pending.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).

## Native Memory fixture: missing concrete execution replacement

The independently authored native Memory fixture exposed `SessionExecutionLocal.node` in its public group but omitted the concrete replacement for `SessionExecution.node`. All three tests failed during graph construction with `Unbound layer node: @apexo/v2/SessionExecution`, before provider or Memory assertions. This repeats only the explicit replacement defect from the original deletion episode; it is not another missing Global directory or transitive-public-output occurrence.

The fixture now uses `[SessionExecution.node, SessionExecutionLocal.node]`, retaining the actual runner and stores. The corrected run reached a distinct Memory cancellation settlement defect (recorded in BUG-20261014-132); after that controller correction, `bun test test/v2/memory-lifecycle-native.test.ts` from `packages/apexo` passed three tests / 21 assertions. No production service binding was changed for the fixture.

## Scheduler restoration fixture: missing concrete execution replacement

The independently authored cold HTTP restoration fixture added a real `SessionV2` application graph to prepare a historically managed child. That new graph omitted the concrete replacement for the unbound `SessionExecution.node`. The first run failed before child restoration with `Unbound layer node: @apexo/v2/SessionExecution`: zero passes, one failure and seven assertions.

Adding `[SessionExecution.node, SessionExecutionLocal.node]` allowed the fixture to reach its actual HTTP assertion. It then exposed the separate empty-managed-Session restoration defect, returning 400 instead of 200 (zero passes, one failure and nine assertions). After that product correction, the five-file restoration suite passed 18 tests and 181 assertions, and `bun typecheck` from `packages/apexo` passed. The initial reproduction command was `bun test test/e2e/v2-session-restore.e2e.test.ts` from `packages/apexo`.

This repeats the explicit concrete replacement omission, not the original missing directory or the transitive public-output mistake in BUG134. No production execution binding was changed for this fixture.

[Rule001](../../rules/fixture-appnode-public-services.md) now includes the explicit abstract-node replacement check alongside its existing public-output check. The two source bugs retain separate counts and causes.

## Native MCP attachment fixture: custom data directory

The first attachment service suite passed normal preparation and permission cases,
but Session deletion failed with `SessionLifecycle.Failure` caused by
`GoalReports.owners` calling `lstat` on its missing custom `Global.data` directory.
The fixture now creates that directory before constructing its real application.
The corrected six-test suite passed 31 assertions, including deletion during a
held read, pending permission cleanup and same-ID recreation. Reproduce with
`bun test test/v2/session-mcp-attachment.test.ts` from `packages/apexo`.

This is a second independent missing-custom-data-directory fixture episode. At that checkpoint it
did not increase the separate concrete-execution-binding count and was below
the threshold for a new recurring rule.

## Native Stop cancellation fixture: custom data directory

The independently authored Stop cancellation fixture reproduced the same
missing-custom-data-directory defect: interruption passed, but deletion failed
with `SessionLifecycle.Failure`. The captured retirement cause was `ENOENT` from
`lstat` on its replacement `Global.data` directory. Creating that directory before
application construction fixed fixture initialization without changing deletion.

The corrected three-file Stop suite passed eight tests and 41 assertions, including
joined process termination for deletion and Session-ID reuse. Reproduce from
`packages/apexo` with `bun test test/session/native-stop-hook-cancellation.test.ts`.
This is the third independent missing-custom-data-directory episode (original
deletion, MCP attachment, Stop cancellation). It does not increase the separate
execution-binding count. [RULE-20261015-019](../../rules/fixture-global-data-directory.md)
now requires fixtures that override Global paths to create their data directory.
