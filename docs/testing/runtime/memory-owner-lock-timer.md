# BUG-20261015-209: Native Memory lock heartbeat overflow

- **Scope:** Private native Memory operation controller draft; no shipped regression is claimed.
- **Observed:** The first real operation test emitted `TimeoutOverflowWarning` because the controller passed `Number.MAX_SAFE_INTEGER` as the stale-lock interval. The lock derives its heartbeat interval from that value; the runtime replaced the oversized timer with a one-millisecond timer.
- **Expected:** Owned Memory extraction must never steal a live or unverified owner by elapsed time, while using ordinary bounded heartbeat intervals.
- **Cause:** A huge timeout sentinel was incorrectly used to express an ownership policy.
- **Fix:** Add opt-in `Flock.deadOwnerOnly`. It recovers only a positively verified dead local PID, refuses unknown/foreign/permission-denied owners regardless of age, preserves the atomic breaker/recheck path, and keeps normal heartbeat timing. Existing callers retain their original elapsed-age policy. The Memory controller selects this explicit policy.
- **Verification:** From `packages/apexo`, `bun test test/util/flock-dead-owner.test.ts` passed three tests / 13 assertions. Tests exercise actual stale metadata, a real exited lock-owning child, three concurrent contenders, ordinary default recovery, and an actual macOS PID 1 probe returning `EPERM`. The Memory three-test / 21-assertion gate passed without the overflow warning after the change.
- **Limitations:** An unknown/foreign owner or abandoned breaker is preserved rather than guessed dead. This is conservative unavailability requiring explicit external investigation; there is no timestamp-based takeover.
- **Occurrences:** One confirmed timer-policy mistake.
