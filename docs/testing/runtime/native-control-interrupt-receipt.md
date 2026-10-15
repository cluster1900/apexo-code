# BUG-20261014-132: Native control lane settlement

- Scope: Process-local Session coordinator control lane.
- Observed: A caller still awaiting a claimed control never received settlement after the action was interrupted; the deterministic test timed out at its normal five-second deadline.
- Expected: Claimed controls settle after cleanup, and pending drains receive ownership without an unbounded sequence of intervening control batches.
- Root cause: Interruption remained enabled between capturing the action Exit and completing the caller Deferred, allowing cancellation to skip receipt publication.
- Fix: Keep the action interruptible, then publish its captured Exit under an interruption mask after action finalizers complete.
- Reproduction: Run `bun test test/session/control-coordinator.test.ts` from packages/apexo against the earlier implementation.
- Verification: Deterministic red reproduced, then the focused coordinator and Workflow ownership gate passed 12 tests and 37 assertions. The original five-second deadline was unchanged.
- Occurrences: Two independent interrupted-settlement failures, with their separate verification below.

## Native Memory operation settlement

A new private native Memory controller correctly joined cancellation of a held real HTTP extraction, but its operation receipt remained `running`. The first behavior run passed the concurrent admission and held mode-disable cases, then failed cancellation with `Memory cancellation settled but its receipt could not be persisted`. The failure receipt was published inside an interruptible `catchCause`, so the pending interruption skipped that write.

The controller now observes the owned work's Exit in `Effect.onExit` and persists the terminal receipt in that uninterruptible finalizer, after extraction/store cleanup has joined. Cancellation never restarts extraction. The immutable receipt token and original Session Created proof constrain the update, so late settlement cannot overwrite a replacement receipt.

From `packages/apexo`, `bun test test/v2/memory-lifecycle-native.test.ts` passed three tests and 21 assertions in the private draft. The unchanged cancellation test observes `cancelled` after the join and proves exact retry does not send another provider request. The expanded private gate passed twelve tests / 83 assertions, including Session deletion, same-ID replacement and real controller-scope shutdown. A real CLI crash/restart scenario also passed five checks with two ordinary and three extraction requests; passive recovery starts no work, and explicit retry uses the exact persisted lease proof. Shared integration and packaged Desktop remain pending. This is the second independent occurrence of the interruptible receipt-publication mistake; it does not combine broader Instance initialization failures from BUG-20261014-214.
