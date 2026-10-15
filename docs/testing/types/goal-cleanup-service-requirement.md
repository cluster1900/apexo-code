# BUG-20261014-028: Cleanup backfill leaked an Effect service requirement

- Status: Fixed and verified. One observed implementation failure; no recurring constraint.
- Scope: `SessionGoalRun.open` and compatibility prompt loop typing.
- Observed: Apexo type checking reported `Effect<WithParts, never, Service>` was not assignable to the prompt loop's service-free effect signature. Expected: the loop closes over services already acquired by its layer.
- Reproduction: Add a direct `yield* SessionGoalCleanup.Service` inside the exported Goal runner and run package `bun typecheck`.
- Root cause: Adding an unprovided service requirement to the runner propagated that requirement into the prompt loop.
- Fix: Pass the cleanup interface already acquired by the prompt layer into `SessionGoalRun.open`.
- Verification: `bun typecheck` passed in both `packages/core` and `packages/apexo` after the correction.
