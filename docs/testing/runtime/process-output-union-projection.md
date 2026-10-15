# BUG-20261015-158: A broad Bash output union erased process identity

- Status: integrated; the shared 21-file regression passed 141 tests / 803 assertions. All 21 workspace typechecks and shared CLI/rebuilt Desktop Monitor acceptance passed ten checks / 57 calls each, including model process wait/cancel.
- Scope: Bash output encoding after the additive Shell/Monitor process kind union. One occurrence.
- Observed: existing native Shell wait/cancel provider tests failed. The real Bash tool result became `Command exited with code undefined` and omitted the process ID, so the provider fixture could not invoke the intended process control.
- Expected: opted-in background Bash retains its complete process receipt; omitted background options retain the existing foreground result.
- Cause: adding a second process-kind literal changed Effect Schema's union selection. The broad foreground output arm came first and accepted the shared output/truncated fields, stripping process fields before model projection.
- Fix: put the specific required Process detail and structured-output arms before the broad foreground arms. Foreground results fail the required process fields and continue through their existing branch.
- Verification: both previously failing Shell modes passed after the change; all eight existing Shell provider modes and ten Monitor provider modes passed. The full scoped union passed 28 tests and 332 assertions. Actual foreground sandbox Bash passed one test and 25 assertions, preserving command execution, output and sandbox confirmation. Core and Apexo typechecks passed.

Commands: `bun test test/v2/process-runner.test.ts test/v2/monitor-runner.test.ts` and `bun test test/session/command-sandbox-bash.test.ts`, from `packages/apexo` with pinned Bun 1.3.14.
