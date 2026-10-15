# BUG-20261014-150: Compatibility hook controls blocked cancellation

- Scope: Compatibility Session runner explicit hook reload control lane.
- Observed: The new regression for interrupting a claimed control during final drain settlement timed out at its unchanged five-second limit.
- Expected: Cancellation interrupts the action, waits for its cleanup, and settles every queued or claimed caller. An idle control must not start a provider turn or publish busy status.
- Reproduction: From `packages/apexo`, run `bun test test/effect/runner.test.ts`; the initial implementation held the runner state mutex while executing final controls.
- Root cause: Final control execution held the same mutex needed by `cancel`, so cancellation could not reach the owning fiber. Removing the entire queued batch before executing it could also strand later receipts if the first action was interrupted.
- Fix: Hand final control execution out of the state mutex while retaining the runner identity. Publish claimed action exits under an interruption mask, keep actions explicitly interruptible even during finalization, and retain the captured batch identities so interruption cancels its remaining receipts without touching replacement work. Provider-boundary flushing is bounded to the controls already queued at that boundary.
- Verification: Runner, snapshot service, and adapter batch passed 34 tests and 104 assertions after the final receipt-cancellation hardening. The real CLI snapshot fixture passed nine scenarios, including a reload queued during an active provider request.
- Occurrences: One reproduced mutex deadlock; no recurring constraint promoted.
