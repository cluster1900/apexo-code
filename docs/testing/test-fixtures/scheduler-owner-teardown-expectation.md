# Scheduler Acceptance Expected a Deleted Timer to Remain Saved

- **Bug ID:** BUG-20261015-020
- **Scope:** Scheduler CLI/Desktop acceptance fixture; no observed product defect.
- **Status:** Fixture corrected and verified in CLI and packaged Desktop.
- **Independent occurrences:** 1 authoring episode.

## Observed and expected behavior

The first CLI run failed at `old durable record must remain unopened for this recovery scenario`. After an actual Session deletion and exact-ID recreation, the old saved timer was already absent. No old timer executed. The fixture incorrectly expected the saved record to survive deletion before prompt recovery initialized the scheduler.

## Reproduction and root cause

Create a durable timer through the actual `scheduler_create` tool, restart the backend, delete its owner, recreate the Session ID, then inspect the real SchedulerStore. Deletion correctly removed the timer; the test assumed an incomplete teardown behavior instead of inspecting the actual lifecycle contract.

## Fix

The fixture now asserts that actual deletion removes the old saved timer. With the backend stopped, it then restores the captured old record through `SchedulerStore.save` as an explicitly synthetic stale historical record. This separately exercises restart ownership validation after Session-ID reuse. The output labels this restoration, accelerated deadlines, the downgraded legacy record, and the unmatched historical record. It does not claim these variants were captured from a historical installation. No production code changed.

## Verification

From `packages/apexo`, `bun script/grok-scheduler-owner.mjs cli` passed six checks. Exactly the valid current timer and the legacy timer with an exact completed creation receipt reached the provider once each. The restored stale timer was removed with zero executions; unknown ownership stayed saved and inactive across a further restart. `bun script/grok-scheduler-owner.mjs desktop` passed the same six checks against the coordinated packaged backend. Both commands exited zero; all backend and isolated store worker processes were reaped.
