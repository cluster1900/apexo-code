# BUG-20261015-202: Scheduler deletion fixture waited for cleanup before releasing admission

- Status: Corrected and verified in the private Scheduler fixture.
- Scope: Actual native Session deletion while a scheduled child's Created event is held after atomic ownership admission and before worker registration.
- Occurrences: One fixture authoring episode; no product lifecycle failure was established.
- Observed: The added Session-delete case timed out at its unchanged five-second readiness bound. The other nine Scheduler cases passed.
- Expected: Deletion first revokes the exact Session incarnation, waits for admitted mutation leases to drain, then joins owners and deletes durable state.
- Root cause: The fixture held Created publication inside a mutation lease but waited for the Scheduler owner's persisted `paused` cleanup state before releasing that same lease. Lifecycle intentionally starts owner cleanup only after admitted writes drain.
- Fix: Wait for `lifecycle.available(claim)` to become false, assert the removal fiber is still pending, then release Created publication. Preserve the original deadline. Assert joined removal, absent parent and child Task, and exactly the one already-held parent provider request, with zero child provider requests.
- Verification: `bun test test/v2/schedule-execution.test.ts test/v2/schedule-late-authority.test.ts` from `packages/apexo` passed eight tests / 72 assertions. It includes held startup Stop/delete and Stop/Resume, held async claim Stop/Resume, and late Goal/Plan/schedule deletion after real model resolution.

During this same assertion-authoring episode, an intermediate run used the unavailable static `Fiber.poll` helper and failed before its pending-removal assertion. The installed Effect contract exposes `fiber.pollUnsafe()`; the assertion now uses that immediate observation. This is a separately identified fixture API correction within this episode, not an additional occurrence of the readiness mistake or a product failure.
