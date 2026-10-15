# BUG-20261015-013: Draft Memory rollover reused an archived capture job ID

- **Scope:** New off-tree Memory capture incarnation rollover, not shipped behavior.
- **Observed:** The expanded deletion draft batch passed 82 tests and failed both new rollover cases with `MemoryCaptureError: Capture range was already admitted with another source`.
- **Expected:** Recreating a Session must permit a new capture at range one, including reuse of the original prompt ID, while retaining previously committed observation files.
- **Root cause:** The draft moved old jobs, receipts and cursor ownership to an archive namespace, but capture job IDs still hashed only the bare Session ID and turn range. The new incarnation therefore collided with an archived job's unchanged primary key.
- **Fix:** Include the persisted incarnation in job-ID hashing for adopted Sessions. Preserve the original hash for unadopted legacy stores. Keep archived job IDs and observation references unchanged.
- **Reproduction:** In the deletion draft checkout, run `bun test test/session/memory-capture-rollover.test.ts` from `packages/apexo` with the earlier rollover implementation.
- **Verification:** `bun test test/session/memory-capture-rollover.test.ts test/tool/memory-capture.test.ts` passed 19 tests and 119 assertions. Coverage includes stale lease rejection, fresh same-prompt admission, fresh progress, retained observations, real SQLite reopen, and proven versus unproven legacy source handling.
- **Status:** Verified in the isolated draft; live integration remains pending.

## Observation publication namespace in the same draft

Peer review found that the initial rollover test used a replacement `noop` outcome, so it did not exercise publication identity. Replacing that outcome with a real observation reproduced a `capture_files.path` uniqueness failure (one pass, one fail). Observation filenames still used only the original Session ID, turn range and ordinal.

New incarnation-scoped jobs now add their immutable job ID to the observation filename. Jobs with the historical hash retain the original filename, and existing files and publication journals are never renamed. The expanded real-store and proof batch passed 22 tests and 139 assertions, including old and new observation publication, preservation through SQLite reopen, verified legacy proof surviving compaction, and explicit conflict for receipt-only historical ownership. This is a second missed identifier in the same rollout episode, not an independent recurrence.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
