# BUG-20261014-121: Coordinator fixture announced readiness before installing cleanup

- Scope: The delayed conditional interruption regression fixture.
- Observed: After the production ownership fix preserved the successor drain, the fixture expected its cleanup flag to be true after an unconditional interrupt, but received false.
- Expected: The fixture must install the cleanup it intends to assert before announcing that the drain is ready to be interrupted.
- Reproduction: Run `bun test test/workflow/coordinator-ownership.test.ts` from `packages/apexo` with the earlier fixture that signalled readiness before reaching its finalizer registration.
- Root cause: The test's readiness signal allowed interruption before the tested cleanup handler was installed. This was a fixture ordering mistake, separate from the production stale-ownership bug.
- Fix: Use an explicit scope and register its finalizer before completing the readiness Deferred.
- Verification: The corrected coordinator regression passed all four assertions. `bun test test/workflow/ test/e2e/v2-session.e2e.test.ts` passed 15 tests and 88 assertions. The test checks both preservation of the successor and cleanup on a subsequent unconditional interrupt.
- Occurrences: One observed fixture failure. No production recurrence is inferred.
