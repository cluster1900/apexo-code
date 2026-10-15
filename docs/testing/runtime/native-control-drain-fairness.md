# BUG-20261014-133: Native control lane settlement

- Scope: Process-local Session coordinator control lane.
- Observed: A queued model wake ran after a second control batch, despite the first batch already completing.
- Expected: Claimed controls settle after cleanup, and pending drains receive ownership without an unbounded sequence of intervening control batches.
- Root cause: Coordinator settlement always prioritized queued controls over pending drain work, allowing repeated control arrivals to defer that work indefinitely.
- Fix: After one control-worker batch, hand ownership to a pending forced or advisory drain; remaining controls are consumed at its bounded safe boundary.
- Reproduction: Run `bun test test/session/control-coordinator.test.ts` from packages/apexo against the earlier implementation.
- Verification: Deterministic red reproduced, then the focused coordinator and Workflow ownership gate passed 12 tests and 37 assertions. The original five-second deadline was unchanged.
- Occurrences: One reproduced failure.
