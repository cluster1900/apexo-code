# BUG-20261014-021: Goal Cleanup Test Fixture Missing ChildProcessSpawner Layer

- **Status**: Fixed & Verified; **Verified Occurrences**: 4; **Linked Rule**: [RULE-20261014-003](../../rules/scoped-temp-fixture-spawner.md).
- **Scope**: Temporary directory fixture in `packages/apexo/test/session/goal-cleanup.test.ts`.
- **Observed**: Three cleanup tests failed during initialization with `Service not found: effect/process/ChildProcessSpawner`.
- **Expected**: Provide the real process spawner service required by `tmpdirScoped` during fixture setup and teardown.
- **Reproduction**: In `packages/apexo`, run `GITHUB_ACTIONS=false bun test test/session/goal-cleanup.test.ts test/session/goal-reports.test.ts`.
- **Root Cause**: Passed `Layer.empty` to a test suite using `tmpdirScoped`, omitting the process spawner dependency.
- **Fix**: Build the test layer with `AppNodeBuilder.build(CrossSpawnSpawner.node)` without introducing mocks.
- **Verification**: All 8 tests (39 assertions) passed and `bun typecheck` exited 0.

## Independent recurrence evidence

1. The original Goal cleanup fixture passed `Layer.empty` to `tmpdirScoped`, producing the missing ChildProcessSpawner error. The dependency-corrected run passed 8 tests and 39 assertions.
2. The durable Stop fixture independently omitted the same real process service. [BUG-20261014-072](hooks-stop-fixtures.md) records the initial missing-service failure and the corrected focused run (12 tests, 45 assertions). Its separate returned-path error and CLI deadline investigation are not additional occurrences of this cause.
3. The native bundle runtime fixture in `test/v2/plugin-bundle-runtime.test.ts` initially used `testEffect(Layer.empty)` with `tmpdirScoped`. The first run failed during fixture setup with the same missing ChildProcessSpawner service. Providing `AppNodeBuilder.build(CrossSpawnSpawner.node)` resolved setup; the corrected runtime and guard suite passed 7 tests with 36 assertions. That run also verifies the separate product fix [BUG-20261014-170](../runtime/plugin-embedded-skill-optional-description.md), which is not counted as a fixture recurrence.

Reproduce the third corrected fixture from `packages/apexo` with `GITHUB_ACTIONS=false bun test test/v2/plugin-runtime-guard.test.ts test/v2/plugin-bundle-runtime.test.ts`. These are three independent setup mistakes, not three references to one failing run.

4. The batch immutable-search fixture built only `Ripgrep.node`, then called `tmpdirScoped`; setup failed with the same missing ChildProcessSpawner service before either security assertion. Explicitly grouping `CrossSpawnSpawner.node` with Ripgrep restored setup. `bun test test/tool/memory-batch-search.test.ts` from `packages/apexo` passed two tests / six assertions, including changed-file and external-symlink negative controls. This fourth episode does not count either assertion as an independent recurrence.
