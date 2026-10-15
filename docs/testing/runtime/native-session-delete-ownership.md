# BUG-20261014-140: Session deletion outpaced native execution cleanup

- Scope: Compatibility Session deletion of Sessions with native execution or controls.
- Observed: A deterministic test held a real coordinator control and its scoped finalizer. Session removal completed before that finalizer even entered, deleting the persisted Session and invalidating its hook snapshot while native work remained owned.
- Expected: Deletion interrupts and awaits native ownership cleanup before removing rows or snapshots. Cleanup can still observe the Session and captured registry; neither remains after deletion completes.
- Root cause: Compatibility removal cancelled its V1 run manager and background jobs, but did not interrupt the process-global native SessionExecution owner.
- Fix: Compatibility removal now awaits process-global native SessionExecution interruption before cleanup, recursive deletion, persisted event removal, and snapshot invalidation.
- Reproduction: Run `bun test test/session/native-delete.test.ts` from packages/apexo against the earlier implementation. Expected first boundary `closing`, observed `removed`.
- Verification: Deterministic red reproduced, then the deletion, coordinator, and existing Session test gate passed 20 tests and 68 assertions. The deletion test verifies rows and snapshots remain visible during delayed cleanup and are absent afterward. No timing deadline increase or automatic provider recovery is involved.
- Occurrences: One reproduced deletion race.

This fix covers ownership already active when deletion begins. It does not introduce a deletion tombstone or claim to fence new admission between interruption and durable removal.
