# BUG-20261015-012: Delayed cancellation targeted a replacement background job

- **Scope:** Core `BackgroundJob.cancel`, used by Session deletion owner settlement and ordinary cancellation.
- **Observed:** A deterministic isolated test held the original job's `onCancel`, completed that job, started another job with the same ID, then released cancellation. The replacement became `cancelled` instead of remaining `running` (two tests passed, one failed).
- **Expected:** Cancellation must settle only the concrete job captured when cancellation began.
- **Root cause:** After awaiting `onCancel`, cancellation looked up the job by ID again without checking its existing immutable token. Completion settlement already checked that token, but cancellation did not.
- **Fix:** Compare the current job token with the originally captured token before changing status, resolving its waiter or closing its scope. The Session-aware registry also rejects cancellation inherited from a different Session incarnation.
- **Reproduction:** From `packages/apexo` in the deletion draft checkout, run `bun test test/session/lifecycle-background.test.ts`; the test named “delayed cancellation of a completed background job cannot cancel a replacement with the same job ID” reproduces the ordering without timers.
- **Verification:** The corrected test passed in the 54-test, 165-assertion isolated lifecycle/Runner batch. The subsequent expanded batch also passed this test and the existing background registry cases; that batch's two unrelated Memory rollover failures are recorded separately.
- **Status:** Fix verified off-tree; not yet integrated into the accepted production source.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
