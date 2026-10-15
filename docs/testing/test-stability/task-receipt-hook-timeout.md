# BUG-20261015-363: Task receipt client package hook exceeded its deadline

- Scope: integrated operator Task receipt client focused test; one observed timing episode.
- Observed: all four test bodies passed 29 assertions, followed by an unnamed package hook timeout at 5938.25 ms. The complete command reported four passes and one failure and exited 1 in 8.44 seconds.
- Reproduction: `bun test test/cli/run/task-message.test.ts` from `packages/apexo`, pinned Bun 1.3.14. Combined Desktop build and package typechecks were running concurrently; this is context, not a proven cause.
- Expected: test bodies and package teardown both settle within the existing command deadline.
- Investigation: this test file defines no hooks. The package preload defines an `afterAll` that dynamically imports AppRuntime, disposes it, then performs GC, a short delay, and filesystem cleanup. The original log does not identify the suspended phase. The package test script specifies a 30-second timeout; this direct focused command used Bun's default deadline. Neither observation proves the cause.
- Root cause: unknown. No runtime defect, load attribution, or cleanup fix is claimed. Similar unnamed-hook symptoms in BUG-20261015-165 and BUG-20261015-338 do not establish an identical root cause or another recurring-rule occurrence.
- Follow-up: the repository-canonical command `bun test test/cli/run/task-message.test.ts --timeout 30000` passed four tests and 29 assertions in 1.78 seconds. No source or assertion changed; the command used the package CI timeout instead of the earlier default.
- Status: unresolved original timing observation, with a subsequent canonical-command pass. That pass does not identify the original cleanup phase or establish a product fix.
